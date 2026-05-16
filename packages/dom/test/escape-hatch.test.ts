// Tests for `subApp` — the legitimate state-isolation escape hatch.
// See `docs/proposals/unified-composition-model.md` for rationale.

import { describe, it, expect } from 'vitest'
import { component, mountApp, div } from '../src/index'
import { text } from '../src/primitives/text'
import { subApp } from '../src/escape-hatch'
import type { AppHandle, ComponentDef } from '../src/types'

describe('subApp()', () => {
  // A trivial nested app with its own state + reducer + view.
  type NestedState = { count: number }
  type NestedMsg = { type: 'inc' }
  const NestedApp: ComponentDef<NestedState, NestedMsg, never> = component<
    NestedState,
    NestedMsg,
    never
  >({
    name: 'Nested',
    init: () => [{ count: 0 }, []],
    update: (s, m) => (m.type === 'inc' ? [{ count: s.count + 1 }, []] : [s, []]),
    view: () => [div({ class: 'nested' }, [text((s: NestedState) => `nested:${s.count}`)])],
  })

  it('mounts a sub-app inside the host and isolates state', () => {
    type HostState = { hostCount: number }
    type HostMsg = { type: 'hostInc' }
    const Host: ComponentDef<HostState, HostMsg, never> = {
      name: 'Host',
      init: () => [{ hostCount: 0 }, []],
      update: (s, m) => (m.type === 'hostInc' ? [{ hostCount: s.hostCount + 1 }, []] : [s, []]),
      view: () => [
        div({ class: 'host' }, [
          text((s: HostState) => `host:${s.hostCount}`),
          ...subApp({
            reason: 'unit test fixture — sub-app with its own state',
            def: NestedApp,
          }),
        ]),
      ],
    }

    const container = document.createElement('div')
    const host = mountApp(container, Host)

    // Sub-app's DOM is present and rendered with its own initial state
    const nested = container.querySelector('.nested')
    expect(nested).not.toBeNull()
    expect(nested!.textContent).toBe('nested:0')
    // Host's DOM is also present
    expect(container.querySelector('.host')!.textContent).toContain('host:0')
    // Wrapper marked with the reason attribute for tools/devtools to surface
    const wrapper = container.querySelector('[data-llui-sub-app]')
    expect(wrapper).not.toBeNull()
    expect(wrapper!.getAttribute('data-llui-sub-app-reason')).toBe(
      'unit test fixture — sub-app with its own state',
    )

    host.dispose()
  })

  it('rejects an empty reason string at runtime', () => {
    const Host: ComponentDef<{}, never, never> = {
      name: 'Host',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [
        div([
          // Runtime-empty reason; the TypeScript signature accepts any
          // string, so this string literal compiles. The check is a
          // runtime throw at view() time.
          ...subApp({ reason: '', def: NestedApp }),
        ]),
      ],
    }
    const container = document.createElement('div')
    expect(() => mountApp(container, Host)).toThrow(/non-empty 'reason' string/)
  })

  it('rejects a whitespace-only reason', () => {
    const Host: ComponentDef<{}, never, never> = {
      name: 'Host',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [div([...subApp({ reason: '   ', def: NestedApp })])],
    }
    const container = document.createElement('div')
    expect(() => mountApp(container, Host)).toThrow(/non-empty 'reason' string/)
  })

  it('disposes the sub-app when the host disposes', () => {
    let nestedHandle: AppHandle | null = null
    const Host: ComponentDef<{}, never, never> = {
      name: 'Host',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [
        div([
          ...subApp({
            reason: 'capture-handle test',
            def: NestedApp,
            onHandle: (h: AppHandle) => {
              nestedHandle = h
            },
          }),
        ]),
      ],
    }
    const container = document.createElement('div')
    const host = mountApp(container, Host)
    expect(nestedHandle).not.toBeNull()
    // Calling getState should work on a live handle
    expect((nestedHandle as unknown as AppHandle).getState()).toEqual({ count: 0 })

    host.dispose()
    // After host dispose, the sub-app handle is disposed too — getState
    // throws because the AppHandle contract is "no reads after dispose".
    expect(() => (nestedHandle as unknown as AppHandle).getState()).toThrow(/dispose/)
  })

  it('sub-app state is fully isolated from host state', () => {
    let nestedHandle: AppHandle | null = null
    const Host: ComponentDef<{ x: number }, { type: 'inc' }, never> = {
      name: 'Host',
      init: () => [{ x: 0 }, []],
      update: (s, m) => (m.type === 'inc' ? [{ x: s.x + 1 }, []] : [s, []]),
      view: () => [
        div([
          text((s: { x: number }) => `x:${s.x}`),
          ...subApp({
            reason: 'isolation test — nested state must not leak into host',
            def: NestedApp,
            onHandle: (h: AppHandle) => {
              nestedHandle = h
            },
          }),
        ]),
      ],
    }
    const container = document.createElement('div')
    const host = mountApp(container, Host)

    // Drive sub-app from outside via captured handle
    ;(nestedHandle as unknown as AppHandle).send({ type: 'inc' })
    ;(nestedHandle as unknown as AppHandle).flush()
    // Sub-app advanced
    expect(container.querySelector('.nested')!.textContent).toBe('nested:1')
    // Host did NOT receive any message (its state.x is untouched)
    expect(host.getState()).toEqual({ x: 0 })

    host.dispose()
  })
})
