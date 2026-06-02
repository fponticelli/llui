import { describe, it, expect, afterEach } from 'vitest'
import { mountApp, component, span, input, button, text, branch, onMount } from '@llui/dom'
import { emulateBlurOnRemoval } from '../src/blur-on-removal'

// The inline-edit-commit surface — an <input> in the `edit` arm of a `branch`
// whose `onBlur` commits, where committing swaps the arm and removes the focused
// input — is the single most reentrancy-prone pattern in TEA view code (it is
// load-bearing in dungeonlogs' trait/fact editors). In a real browser the arm
// swap fires `blur` SYNCHRONOUSLY mid-reconcile; jsdom omits that, so the path
// went untested until `emulateBlurOnRemoval` made the browser behaviour
// reproducible. These tests drive the GENUINE path, not an onMount proxy.

describe('inline-edit-commit: reentrant blur during arm swap', () => {
  let uninstall: (() => void) | null = null
  let host: HTMLDivElement | null = null
  afterEach(() => {
    uninstall?.()
    uninstall = null
    host?.remove()
    host = null
  })

  it('queues the blur-driven reentrant send and does NOT drop the outer commit effect', () => {
    uninstall = emulateBlurOnRemoval()
    host = document.createElement('div')
    document.body.appendChild(host)

    interface S {
      editing: boolean
      draft: string
      committed: string
      log: string[]
    }
    type M = { type: 'commit' } | { type: 'blurred' }
    type E = { type: 'persist'; value: string } | { type: 'blurfx' }

    const effects: E[] = []
    const order: string[] = []

    const h = mountApp<S, M, E>(
      host,
      component<S, M, E>({
        init: () => [{ editing: true, draft: 'Gandalf', committed: '', log: [] }, []],
        update: (s, m) => {
          switch (m.type) {
            case 'commit':
              order.push('commit')
              // Leaving edit mode swaps the arm and removes the focused input.
              return [
                { ...s, editing: false, committed: s.draft },
                [{ type: 'persist', value: s.draft }],
              ]
            case 'blurred':
              order.push('blurred')
              return [{ ...s, log: [...s.log, 'blurred'] }, [{ type: 'blurfx' }]]
          }
        },
        onEffect: (e) => {
          effects.push(e)
        },
        view: ({ state, send }) => [
          branch(
            state.at('editing').map((e) => (e ? 'edit' : 'view')),
            {
              edit: () => [
                input({
                  id: 'name',
                  value: state.at('draft'),
                  // The genuine trigger: when the commit swaps this arm out, the
                  // browser fires blur on the (removed) focused input.
                  onBlur: () => send({ type: 'blurred' }),
                }),
                button({ id: 'commit', onClick: () => send({ type: 'commit' }) }, [text('Save')]),
              ],
              view: () => [span({ id: 'committed' }, [text(state.at('committed'))])],
            },
          ),
        ],
      }),
    )

    const nameInput = host.querySelector<HTMLInputElement>('#name')!
    nameInput.focus()
    expect(document.activeElement).toBe(nameInput)

    // Commit while the input holds focus — the arm swap removes it, blur fires
    // reentrantly mid-reconcile.
    expect(() => h.send({ type: 'commit' })).not.toThrow()

    // Outer commit landed: view arm shows the committed value.
    expect(host.querySelector('#committed')?.textContent).toBe('Gandalf')
    // Effect ORDER is the queue-vs-nest discriminator and the strongest single
    // assertion here: a QUEUED reentrant send drains the outer commit FULLY
    // (state + persist effect) before the blur reducer runs (blurfx). A NESTED
    // reducer would emit blurfx from inside commit's reconcile — i.e. BEFORE
    // persist — and could double-tear-down the arm. `[persist, blurfx]` proves
    // both that the outer effect was not dropped and that no nesting occurred.
    expect(effects).toEqual([{ type: 'persist', value: 'Gandalf' }, { type: 'blurfx' }])
    // The reentrant blur message was QUEUED and actually processed (not lost).
    expect(h.getState().log).toEqual(['blurred'])
    // Reducer ordering corroborates: commit completes before the queued blur.
    expect(order).toEqual(['commit', 'blurred'])
    h.dispose()
  })

  it('removeBetween survives a reentrant sibling detach mid-walk (snapshot defense)', () => {
    // Defense-in-depth distinct from the send queue: a blur handler that mutates
    // the DOM DIRECTLY (a focus-trap / tooltip library tearing down siblings on
    // blur — NOT via send, so the queue does not shield it) must not corrupt the
    // in-flight removal walk. The edit arm holds the focused input followed by
    // sibling nodes; on swap, removing the input fires blur, whose listener
    // detaches a LATER doomed sibling before removeBetween reaches it. The
    // snapshot-then-remove walk (dom.ts removeBetween) must clear the arm without
    // a NotFoundError.
    uninstall = emulateBlurOnRemoval()
    host = document.createElement('div')
    document.body.appendChild(host)

    interface S {
      editing: boolean
    }
    type M = { type: 'commit' }

    const h = mountApp<S, M>(
      host,
      component<S, M>({
        init: () => ({ editing: true }),
        update: (_s, _m) => ({ editing: false }),
        view: ({ state }) => [
          branch(
            state.at('editing').map((e) => (e ? 'edit' : 'view')),
            {
              edit: () => [
                input({ id: 'edit', value: '' }),
                span({ class: 'sib', id: 'sib1' }, [text('a')]),
                span({ class: 'sib', id: 'sib2' }, [text('b')]),
                // A library-style blur side effect: synchronously detach a later
                // sibling that removeBetween has not yet visited.
                onMount((root) => {
                  const el = root.querySelector<HTMLInputElement>('#edit')!
                  el.addEventListener('blur', () => {
                    root.querySelector('#sib2')?.remove()
                  })
                  return () => {}
                }),
              ],
              view: () => [span({ id: 'done' }, [text('done')])],
            },
          ),
        ],
      }),
    )

    const editInput = host.querySelector<HTMLInputElement>('#edit')!
    editInput.focus()
    expect(host.querySelectorAll('.sib').length).toBe(2)

    expect(() => h.send({ type: 'commit' })).not.toThrow()

    // Arm fully torn down despite the reentrant detach; new arm present.
    expect(host.querySelectorAll('.sib').length).toBe(0)
    expect(host.querySelector('#edit')).toBeNull()
    expect(host.querySelector('#done')?.textContent).toBe('done')
    h.dispose()
  })
})
