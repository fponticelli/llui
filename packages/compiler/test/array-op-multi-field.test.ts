/**
 * Regression for: a case that modifies MULTIPLE fields including one
 * `field: []` (an array literal reset) gets compiled to method=2
 * (reconcileClear) — which is each-only. Show/branch blocks selected by
 * mask gating no-op on reconcileClear. Their `when`/`on` accessors
 * never re-evaluate, leaving the component structurally inert after
 * mount.
 *
 * The user's repro: a dialog with state { open, source, settings, name,
 * description, tags, tagSuggestions, visibility, nameError } whose
 * "open-with-props" case returns
 *   { ...state, open: true, source, settings, name: '', description: '',
 *     tags: [], tagSuggestions, visibility: 'private', nameError }
 * Includes `tags: []` (initialising form's tags to empty) — this single
 * incidental array literal triggers detectArrayOp's 'clear' path,
 * routing the entire case's reconcile to method=2. The outer show/dialog
 * blocks gate on `open` correctly but their reconcile method is now
 * reconcileClear (no-op on show/branch).
 *
 * Sister of show-helper-reconcile.test.ts, which fixed the same class
 * of bug on the method=-1 path.
 */
import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform'

describe('compiler — array-op detection with multi-field cases', () => {
  it('emits method 0 (general), not method 2 (clear), when a case modifies multiple fields including `field: []`', () => {
    const source = `
      import { component, show, div, text } from '@llui/dom'

      type State = { open: boolean; tags: string[]; name: string }
      type Msg =
        | { type: 'open-with-props'; tags: string[] }
        | { type: 'close' }

      export const Dialog = component<State, Msg, never>({
        name: 'Dialog',
        init: () => [{ open: false, tags: [], name: '' }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'open-with-props':
              if (state.open) return [state, []]
              return [{ ...state, open: true, name: '', tags: [] }, []]
            case 'close':
              return [{ ...state, open: false }, []]
          }
        },
        view: () => [
          ...show({
            when: (s: State) => s.open,
            render: () => [div({}, [text((s: State) => s.name)])],
          }),
        ],
      })
    `

    const out = transformLlui(source, 'dialog.ts')
    expect(out).not.toBeNull()
    const code = out!.output

    // Extract the open-with-props handler's __handleMsg invocation. The
    // 4th argument is the method. Before the fix: method=2 (clear) — the
    // tags: [] in the return triggers detectArrayOp's clear branch even
    // though the case also modifies open and name. After the fix:
    // method=0 (general), so block.reconcile fires for the outer show.
    const match = code.match(
      /["']open-with-props["'][\s:,]*\([^)]*\)\s*=>\s*__handleMsg\(([^)]+)\)/,
    )
    expect(match, 'compiled output should have an open-with-props handler').not.toBeNull()
    const args = match![1]!.split(',').map((s) => s.trim())
    expect(args).toHaveLength(4)
    const method = args[3]!
    expect(
      method,
      `case modifies multiple fields including tags:[]; method must be 0 (general) so show().when re-evaluates, got ${method}`,
    ).toBe('0')
  })

  it('still emits method 2 (clear) when the array clear is the SOLE modification', () => {
    // Preserve the optimization for its intended use case — a case that
    // exclusively clears one array field. modifiedFields=['todos'] and
    // detectArrayOp returns 'clear'.
    const source = `
      import { component, each, div, text } from '@llui/dom'

      type State = { todos: { id: string; label: string }[] }
      type Msg = { type: 'clearAll' } | { type: 'add'; item: { id: string; label: string } }

      export const Todos = component<State, Msg, never>({
        name: 'Todos',
        init: () => [{ todos: [] }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'clearAll':
              return [{ ...state, todos: [] }, []]
            case 'add':
              return [{ ...state, todos: [...state.todos, msg.item] }, []]
          }
        },
        view: () =>
          each<State, { id: string; label: string }>({
            items: (s) => s.todos,
            key: (it) => it.id,
            render: ({ item }) => [div({}, [text(item((t) => t.label))])],
          }),
      })
    `

    const out = transformLlui(source, 'todos.ts')
    const code = out!.output

    const match = code.match(/["']clearAll["'][\s:,]*\([^)]*\)\s*=>\s*__handleMsg\(([^)]+)\)/)
    expect(match, 'compiled output should have a clearAll handler').not.toBeNull()
    const args = match![1]!.split(',').map((s) => s.trim())
    const method = args[3]!
    expect(method, `single-field clear should preserve method=2 optimization`).toBe('2')
  })
})
