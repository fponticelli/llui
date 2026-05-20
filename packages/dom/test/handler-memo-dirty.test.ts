/**
 * Regression: the single-message fast path (`__handlers`) must set
 * `currentDirtyMask` before invoking structural reconcile. The compiler
 * auto-wraps multi-field structural accessors (e.g. `each.items`,
 * `branch.on`, `show.when`) in `memo(fn, mask)`, and `memo` gates on
 * `mask & currentDirtyMask`. If the fast path doesn't update the mask,
 * memo short-circuits with the stale value left over from the previous
 * cycle and the structural block reconciles against frozen input —
 * silently freezing the rendered list/branch/conditional content.
 */
import { describe, it, expect, vi } from 'vitest'
import { mountApp } from '../src/mount'
import { _handleMsg } from '../src/update-loop'
import { each } from '../src/primitives/each'
import { show } from '../src/primitives/show'
import { div } from '../src/elements'
import { text } from '../src/primitives/text'
import { memo } from '../src/primitives/memo'
import type { ComponentDef } from '../src/types'

describe('__handlers fast path keeps memo() dirty mask in sync', () => {
  it("memo'd each.items re-runs on per-msg fast path", () => {
    type S = { items: number[]; filter: number }
    type M = { type: 'set-filter'; value: number }

    const itemsFn = vi.fn((s: S) => s.items.filter((i) => i > s.filter))
    // mask = filter bit (2) | items bit (1) — reads both fields
    const memoizedItems = memo(itemsFn, 0b11)

    let sendFn!: (msg: M) => void
    const def: ComponentDef<S, M, never> = {
      name: 'FastPathMemo',
      init: () => [{ items: [1, 2, 3], filter: 0 }, []],
      update: (s, m) => (m.type === 'set-filter' ? [{ ...s, filter: m.value }, []] : [s, []]),
      view: ({ send }) => {
        sendFn = send
        return each<S, number, M>({
          items: memoizedItems,
          key: (i) => i,
          render: ({ item }) => [div({}, [text(item((i) => String(i)))])],
        })
      },
      // items = bit 0, filter = bit 1
      __compilerVersion: '__test__',
      __prefixes: [(s) => s.items, (s) => s.filter],
      __handlers: {
        // set-filter dirties the `filter` bit (0b10), method=0 (general reconcile)
        'set-filter': ((inst: unknown, msg: unknown) =>
          _handleMsg(inst as never, msg, 0b10, 0)) as never,
      },
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)
    expect(container.querySelectorAll('div').length).toBe(3)
    itemsFn.mockClear()

    sendFn({ type: 'set-filter', value: 1 })
    handle.flush()

    // memo() must have re-evaluated because filter bit overlaps memo mask 0b11.
    // Without setCurrentDirtyMask in _handleMsg, the bitmask check inside memo
    // sees currentDirtyMask=0 (leftover from last cycle) and returns the
    // cached array — the list stays frozen at 3 items.
    expect(itemsFn).toHaveBeenCalled()
    expect(container.querySelectorAll('div').length).toBe(2)
  })

  it("memo'd show.when re-runs on per-msg fast path", () => {
    type S = { open: boolean; theme: string }
    type M = { type: 'toggle' }

    const whenFn = vi.fn((s: S) => s.open && s.theme !== 'hidden')
    // mask reads both fields → compiler would emit memo with mask=0b11
    const memoizedWhen = memo(whenFn, 0b11)

    let sendFn!: (msg: M) => void
    const def: ComponentDef<S, M, never> = {
      name: 'FastPathShow',
      init: () => [{ open: false, theme: 'light' }, []],
      update: (s, _m) => [{ ...s, open: !s.open }, []],
      view: ({ send }) => {
        sendFn = send
        return show({
          when: memoizedWhen,
          render: () => [div({}, [text((_s: S) => 'visible')])],
        })
      },
      __compilerVersion: '__test__',
      __prefixes: [(s) => s.open, (s) => s.theme],
      __handlers: {
        toggle: ((inst: unknown, msg: unknown) => _handleMsg(inst as never, msg, 0b01, 0)) as never,
      },
    }

    const container = document.createElement('div')
    const handle = mountApp(container, def)
    expect(container.textContent).toBe('')
    whenFn.mockClear()

    sendFn({ type: 'toggle' })
    handle.flush()

    expect(whenFn).toHaveBeenCalled()
    expect(container.textContent).toContain('visible')
  })
})
