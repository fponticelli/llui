import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform'

// Regression for issue #10: the compiler's `detectArrayOp` used to
// emit `method = -1` (skip structural blocks entirely) when the
// computed `structuralMask` didn't intersect the case's `caseDirty`
// bits. That's unsafe because `computeStructuralMask` only walks the
// view function's lexical AST — it doesn't descend into helper
// function calls. A view that factors out its form body into a
// helper would have show blocks hidden from the compiler's analysis,
// leading to method -1 for cases that write fields those hidden
// show blocks depend on.
//
// The specific shape (from dicerun2/apps/web/src/ui/auth-dialog.ts):
//
//   view: () => dialog.overlay({
//     content: () => [
//       ...show({ when: s => s.mode === 'signin', render: () => [signinFormBody(send)] }),
//     ],
//   })
//
//   function signinFormBody(send) {
//     return form({...}, [
//       ...show({ when: s => s.errors.email !== undefined, render: () => [p([text(...)])] }),
//     ])
//   }
//
// With the helper, the compiler's structuralMask contains only the
// `mode` bit (from the outer show). The submit case writes `errors`
// and `submitting`. `(structuralMask & caseDirty) === 0` was true,
// so the compiler emitted method -1 for the submit handler. At
// runtime, Phase 1 skipped the inner show blocks → error paragraphs
// never rendered.
//
// The fix removes the unsafe short-circuit. Every non-empty case
// now falls through to 'general' (method 0) unless an explicit array
// op is detected.

describe('compiler — structural reconcile through helper-function shows', () => {
  it('emits method 0 (not -1) for a submit case that writes fields read by show blocks in helpers', () => {
    const source = `
      import { component, div, form, input, p, show, text } from '@llui/dom'

      type State = {
        mode: 'signin' | 'signup'
        email: string
        errors: { email?: string }
        submitting: boolean
      }
      type Msg = { type: 'submit' } | { type: 'field'; value: string }

      function signinFormBody(): Node[] {
        return [
          form({}, [
            input({ type: 'email' }),
            ...show({
              when: (s: State) => s.errors.email !== undefined,
              render: () => [p([text((s: State) => s.errors.email ?? '')])],
            }),
          ]),
        ]
      }

      export const AuthDialog = component<State, Msg, never>({
        name: 'AuthDialog',
        init: () => [{ mode: 'signin', email: '', errors: {}, submitting: false }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'submit': {
              if (!state.email) {
                return [{ ...state, errors: { email: 'required' } }, []]
              }
              return [{ ...state, submitting: true, errors: {} }, []]
            }
            case 'field':
              return [{ ...state, email: msg.value }, []]
          }
        },
        view: () => [
          div({}, [
            ...show({
              when: (s: State) => s.mode === 'signin',
              render: () => signinFormBody(),
            }),
          ]),
        ],
      })
    `

    const out = transformLlui(source, 'auth-dialog.ts')
    expect(out).not.toBeNull()
    const code = out!.output

    // The compiled output should include __handlers with a submit entry.
    // Before the fix: submit: (e, t) => w(e, t, <dirty>, -1)
    // After the fix:  submit: (e, t) => w(e, t, <dirty>, 0)
    //
    // The 4th argument of the __handleMsg delegate is the method arg.
    // Extract the submit handler and verify its last numeric argument
    // is 0, not -1.
    const submitHandlerMatch = code.match(/submit["\s:,]*\([^)]*\)\s*=>\s*__handleMsg\(([^)]+)\)/)
    expect(submitHandlerMatch, 'compiled output should have a submit handler').not.toBeNull()

    const args = submitHandlerMatch![1]!.split(',').map((s) => s.trim())
    // args: [inst, msg, caseDirty, method]
    expect(args).toHaveLength(4)
    const method = args[3]!
    expect(
      method,
      `submit case writes errors/submitting that show blocks in helpers read; method must be 0, got ${method}`,
    ).toBe('0')
  })

  it('still emits method -1 for a case that modifies nothing (tautology-safe)', () => {
    // `modifiedFields.length === 0` short-circuit is preserved — a case
    // that returns `[state, []]` unchanged has nothing to reconcile.
    const source = `
      import { component, div, show } from '@llui/dom'

      type State = { x: number }
      type Msg = { type: 'noop' } | { type: 'inc' }

      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'noop':
              return [state, []]
            case 'inc':
              return [{ ...state, x: state.x + 1 }, []]
          }
        },
        view: () => [
          div({}, [
            ...show({
              when: (s: State) => s.x > 0,
              render: () => [],
            }),
          ]),
        ],
      })
    `

    const out = transformLlui(source, 'c.ts')
    const code = out!.output

    const noopMatch = code.match(/noop["\s:,]*\([^)]*\)\s*=>\s*__handleMsg\(([^)]+)\)/)
    if (noopMatch) {
      // If the compiler generates a handler for 'noop', its method
      // should be -1 because no fields change.
      const args = noopMatch[1]!.split(',').map((s) => s.trim())
      expect(args[3]).toBe('-1')
    }
    // If no handler is emitted at all (tryBuildHandlers may skip
    // entirely-noop cases), that's also correct behavior.

    // The 'inc' case writes `x`, which the outer show reads. It must
    // emit method 0.
    const incMatch = code.match(/inc["\s:,]*\([^)]*\)\s*=>\s*__handleMsg\(([^)]+)\)/)
    expect(incMatch).not.toBeNull()
    const incArgs = incMatch![1]!.split(',').map((s) => s.trim())
    expect(incArgs[3]).toBe('0')
  })

  it('emits method 0 for a case that writes fields read by a show block whose predicate is NOT in the structuralMask directly', () => {
    // Same shape as the real AuthDialog bug but minimized: the outer
    // view's show blocks read `mode`, the helper's show blocks read
    // `errors.*`. submit writes `errors`. Before the fix, method was -1.
    const source = `
      import { component, div, show, text, p } from '@llui/dom'

      type S = {
        mode: 'a' | 'b'
        errors: { field?: string }
      }
      type M = { type: 'submit' } | { type: 'switch'; mode: 'a' | 'b' }

      function bodyHelper(): Node[] {
        return [
          ...show({
            when: (s: S) => s.errors.field !== undefined,
            render: () => [p([text((s: S) => s.errors.field ?? '')])],
          }),
        ]
      }

      export const C = component<S, M, never>({
        name: 'C',
        init: () => [{ mode: 'a', errors: {} }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'submit':
              return [{ ...state, errors: { field: 'bad' } }, []]
            case 'switch':
              return [{ ...state, mode: msg.mode, errors: {} }, []]
          }
        },
        view: () => [
          div({}, [
            ...show({
              when: (s: S) => s.mode === 'a',
              render: () => bodyHelper(),
            }),
          ]),
        ],
      })
    `

    const out = transformLlui(source, 'c.ts')
    const code = out!.output
    const submitMatch = code.match(/submit["\s:,]*\([^)]*\)\s*=>\s*__handleMsg\(([^)]+)\)/)
    expect(submitMatch).not.toBeNull()
    const args = submitMatch![1]!.split(',').map((s) => s.trim())
    expect(
      args[3],
      'helper-hidden show blocks depending on errors must still reconcile on submit',
    ).toBe('0')
  })
})
