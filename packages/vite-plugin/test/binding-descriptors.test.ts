import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import {
  tagDispatchHandlers,
  injectScopeVariantRegistrations,
} from '../src/binding-descriptors.js'

/**
 * Run the tagger pass against a source snippet and emit the
 * resulting JS so assertions can match on the textual output.
 * Snapshot-style: easier to read and resilient to whitespace
 * differences than walking the AST node-by-node.
 */
function emit(source: string): string {
  const sf = ts.createSourceFile('view.ts', source, ts.ScriptTarget.Latest, true)
  const tagged = tagDispatchHandlers(sf, ts.factory)
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
  return printer.printFile(tagged)
}

describe('tagDispatchHandlers — event-handler arrows', () => {
  it('wraps a literal-send onClick with Object.assign + __lluiVariants', () => {
    const out = emit(`
      const v = button({ onClick: () => send({ type: 'inc' }) }, [])
    `)
    // Inner send keeps the source's quote style ('inc'); the
    // compiler-emitted variant array uses double quotes from
    // ts.factory.createStringLiteral.
    expect(out).toContain(
      `onClick: Object.assign(() => send({ type: 'inc' }), { __lluiVariants: ["inc"] })`,
    )
  })

  it('discovers multiple variants in one handler (ternary, branched dispatch)', () => {
    const out = emit(`
      const v = button({
        onClick: (e) => e.shiftKey ? send({ type: 'a' }) : send({ type: 'b' })
      }, [])
    `)
    expect(out).toContain(`__lluiVariants: ["a", "b"]`)
  })

  it('de-dupes repeated variants in the same handler body', () => {
    const out = emit(`
      const v = button({
        onClick: () => {
          if (cond) send({ type: 'X' })
          else { send({ type: 'X' }); send({ type: 'Y' }) }
        }
      }, [])
    `)
    expect(out).toContain(`__lluiVariants: ["X", "Y"]`)
  })

  it('walks block-bodied arrow handlers and finds nested sends', () => {
    const out = emit(`
      const v = button({
        onClick: () => {
          const ok = compute()
          if (ok) {
            send({ type: 'commit' })
          }
        }
      }, [])
    `)
    expect(out).toContain(`__lluiVariants: ["commit"]`)
  })

  it('handles multiple event handlers on the same element independently', () => {
    const out = emit(`
      const v = input({
        onInput: (e) => send({ type: 'edit', value: e.target.value }),
        onBlur: () => send({ type: 'commit' }),
      }, [])
    `)
    expect(out).toContain(`onInput: Object.assign((e) => send({ type: 'edit'`)
    expect(out).toContain(`onBlur: Object.assign(() => send({ type: 'commit' })`)
  })

  it('tags handlers across nested elements (per-item bindings)', () => {
    const out = emit(`
      const tree = ul({}, items.map((item) =>
        li({ onClick: () => send({ type: 'pick', id: item.id }) }, [text(item.label)])
      ))
    `)
    expect(out).toContain(`__lluiVariants: ["pick"]`)
  })
})

describe('tagDispatchHandlers — non-tagging cases', () => {
  it('leaves handlers without literal sends untouched', () => {
    const src = `const v = button({ onClick: () => doSomething() }, [])`
    expect(emit(src)).not.toContain('__lluiVariants')
  })

  it('leaves event-handler keys whose value is not a function untouched', () => {
    // A handler value of `null` is a no-op listener some apps assign
    // conditionally. The tagger must skip non-function values rather
    // than throw or wrap the literal.
    const src = `const v = button({ onClick: null }, [])`
    expect(emit(src)).not.toContain('__lluiVariants')
  })

  it('skips dynamic-type sends (non-literal type field)', () => {
    const src = `
      const v = button({
        onClick: () => send({ type: msgType, payload })
      }, [])
    `
    expect(emit(src)).not.toContain('__lluiVariants')
  })

  it('treats no-substitution template literals as valid type sources', () => {
    // `X` (no interpolations) is a literal string — should tag.
    const out = emit('const v = button({ onClick: () => send({ type: `X` }) }, [])')
    expect(out).toContain(`__lluiVariants: ["X"]`)
  })

  it('skips template literals with interpolations', () => {
    const out = emit('const v = button({ onClick: () => send({ type: `cmd:${suffix}` }) }, [])')
    expect(out).not.toContain('__lluiVariants')
  })
})

describe('tagDispatchHandlers — universal coverage of non-handler arrows', () => {
  // The universal tagger replaces the original Pass 1 (event-handler
  // arrows only) with a walk over every arrow/function expression.
  // Tags placed on non-handler arrows are runtime-inert — the runtime
  // only reads `__lluiVariants` from event-handler bindings — but the
  // wider scope catches three previously-uncovered cases.

  it('tags arrows passed positionally to helper functions', () => {
    // The motivating case: helpers like `navButton(label, onClick)`
    // assign their second arg as the bound onClick. The arrow is
    // syntactically a positional argument, not an `on*` property,
    // but at runtime it ends up as the event handler.
    const out = emit(`
      const v = navButton('Sign in', () => dispatch({ type: 'Auth/OpenDialog' }))
    `)
    expect(out).toContain(`__lluiVariants: ["Auth/OpenDialog"]`)
    expect(out).toContain(
      `Object.assign(() => dispatch({ type: 'Auth/OpenDialog' }), { __lluiVariants: ["Auth/OpenDialog"] })`,
    )
  })

  it('tags arrows in non-handler property positions (runtime-inert)', () => {
    // `class:` and `title:` aren't event-handler keys, so the runtime
    // never reads the tag from them. The tagger still wraps the
    // arrow — keeping the rule "any arrow with literal dispatches
    // gets a tag" simple — and accepts the dead bytes as the cost of
    // that simplicity. No false registrations happen at runtime.
    const out = emit(`
      const v = button({
        class: () => send({ type: 'X' }),
        title: () => send({ type: 'Y' }),
      }, [])
    `)
    expect(out).toContain(`__lluiVariants: ["X"]`)
    expect(out).toContain(`__lluiVariants: ["Y"]`)
  })

  it('does NOT tag an outer arrow whose body only contains nested arrows', () => {
    // Outer arrow returns inner arrow without invoking it — the dispatch
    // doesn't fire when the outer arrow is called, so its tag would be
    // wrong. `collectLiteralSendVariants` stops at nested function
    // boundaries; the inner arrow is tagged independently when the
    // tagger's walk reaches it.
    const out = emit(`
      const factory = () => () => send({ type: 'X' })
    `)
    // Inner arrow tagged
    expect(out).toContain(`Object.assign(() => send({ type: 'X' })`)
    // Outer arrow (factory) NOT tagged — its body just returns the inner.
    expect(out).not.toMatch(
      /Object\.assign\(\(\) => Object\.assign\(\(\) => send/,
    )
  })

  it('does NOT count nested-closure dispatches against the enclosing arrow', () => {
    // `setTimeout(() => send({type:'X'}), 100)` does eventually fire
    // 'X', but the OUTER arrow doesn't dispatch directly. We tag the
    // inner arrow (which IS the dispatcher) and leave the outer
    // alone. This prevents views and helpers from accumulating tags
    // for every dispatch in every closure they construct.
    const out = emit(`
      const handler = () => setTimeout(() => send({ type: 'Inner' }), 100)
    `)
    expect(out).toContain(`__lluiVariants: ["Inner"]`)
    // Outer arrow's tag (if it existed) would be redundant — confirm
    // we don't see two stacked Object.assigns wrapping the outer.
    const objectAssignCount = (out.match(/Object\.assign/g) ?? []).length
    expect(objectAssignCount).toBe(1)
  })
})

// ── Pass 2: connect-pattern injector ────────────────────────────────

function emitInject(source: string): { out: string; injected: boolean } {
  const sf = ts.createSourceFile('view.ts', source, ts.ScriptTarget.Latest, true)
  const result = injectScopeVariantRegistrations(sf, ts.factory)
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
  return { out: printer.printFile(result.sf), injected: result.injected }
}

describe('injectScopeVariantRegistrations — happy path', () => {
  it('emits __registerScopeVariants adjacent to *.connect calls with literal-dispatch sendFns inside a function', () => {
    // Wrapped in a view function so the call is in scope; module-
    // top-level connects are intentionally skipped (no render
    // context exists when module code runs — the registration would
    // silently no-op).
    const { out, injected } = emitInject(`
      const App = component({
        view: () => {
          const sendPopover = (m) => {
            if (m.type === 'open') dispatch({ type: 'Editor/OpenCell' })
            else dispatch({ type: 'Editor/Close' })
          }
          const parts = popover.connect(getPopoverState, sendPopover, { id })
          return [div(parts.trigger, [])]
        }
      })
    `)
    expect(injected).toBe(true)
    // Comma-expression form: keeps the connect call's return value
    // (so `const parts = ...` still binds it) while ensuring the
    // registration fires before the call itself.
    expect(out).toContain(
      `(__registerScopeVariants(["Editor/OpenCell", "Editor/Close"]), popover.connect(`,
    )
  })

  it('handles inline arrow as the sendFn argument', () => {
    const { out, injected } = emitInject(`
      const App = component({
        view: () => {
          const parts = dialog.connect(get, (m) => {
            if (m.type === 'close') dispatch({ type: 'Confirm/Close' })
          }, opts)
          return [parts.root]
        }
      })
    `)
    expect(injected).toBe(true)
    expect(out).toContain(`__registerScopeVariants(["Confirm/Close"])`)
  })

  it('does nothing when the sendFn body has no literal dispatches', () => {
    const { injected } = emitInject(`
      const App = component({
        view: () => {
          const sendThru = (m) => libCall(m)
          const parts = popover.connect(get, sendThru, opts)
          return [parts.root]
        }
      })
    `)
    expect(injected).toBe(false)
  })

  it('skips non-connect call patterns even if they look similar', () => {
    const { out, injected } = emitInject(`
      const App = component({
        view: () => {
          const sendPopover = (m) => dispatch({ type: 'X' })
          const result = popover.attach(get, sendPopover, opts)
          return []
        }
      })
    `)
    expect(injected).toBe(false)
    expect(out).not.toContain('__registerScopeVariants')
  })

  it('matches multiple connect calls in the same scope', () => {
    const { out, injected } = emitInject(`
      const App = component({
        view: () => {
          const sendA = (m) => dispatch({ type: 'A' })
          const sendB = (m) => dispatch({ type: 'B' })
          const a = popover.connect(get, sendA)
          const b = dialog.connect(get, sendB)
          return [a.root, b.root]
        }
      })
    `)
    expect(injected).toBe(true)
    expect(out).toContain('__registerScopeVariants(["A"])')
    expect(out).toContain('__registerScopeVariants(["B"])')
  })

  it('matches a connect call deep inside a render callback (each item)', () => {
    const { out, injected } = emitInject(`
      const App = component({
        view: ({ each }) => each((s) => s.cells, (cell) => {
          const sendPopover = (m) => dispatch({ type: 'Editor/OpenCell' })
          const parts = popover.connect(get, sendPopover)
          return div(parts.trigger, [])
        })
      })
    `)
    expect(injected).toBe(true)
    expect(out).toContain('__registerScopeVariants(["Editor/OpenCell"])')
  })

  it('skips when the sendFn identifier resolves to a non-function', () => {
    const { injected } = emitInject(`
      const App = component({
        view: () => {
          const notAFn = { foo: 'bar' }
          const parts = popover.connect(get, notAFn, opts)
          return [parts.root]
        }
      })
    `)
    expect(injected).toBe(false)
  })

  it('skips when the sendFn identifier is not declared locally (cross-file ref)', () => {
    // `importedSend` could be a tagged function in a different
    // module. The compiler's analysis is per-file; cross-file
    // resolution is intentionally not performed here. Apps relying
    // on imported send translators declare `agentAffordances`
    // instead.
    const { injected } = emitInject(`
      const App = component({
        view: () => {
          const parts = popover.connect(get, importedSend, opts)
          return [parts.root]
        }
      })
    `)
    expect(injected).toBe(false)
  })

  it('skips connect calls at module top-level (no render context to register against)', () => {
    // Real pattern from decisive.space-2/auth-section.ts: the bag is
    // built once at module load and shared across views. There's no
    // render context active when module code runs, so emitting a
    // registration would crash. The translator tagger (Pass 3) closes
    // this gap by tagging `sendMenu` itself; library `*.connect`
    // impls then propagate the tag onto returned handlers via
    // `tagSend`, so module-scope translators surface their variants
    // when the user spreads bag keys onto an element in some view.
    const { out, injected } = emitInject(`
      const sendMenu = (m) => dispatch({ type: 'Auth/UserMenu' })
      const parts = menu.connect(get, sendMenu, { id: 'user-menu' })
    `)
    expect(injected).toBe(false)
    expect(out).not.toContain('__registerScopeVariants')
  })
})

// ── Universal tagger: const-bound translator coverage ──────────────

// These tests originally targeted a separate `tagDispatchTranslators`
// pass that only tagged variable-bound arrows. The universal tagger
// subsumes that pass — any arrow/function expression with literal
// dispatches gets wrapped, regardless of declaration context — so the
// expectations still hold.

function emitTrans(source: string): string {
  const sf = ts.createSourceFile('view.ts', source, ts.ScriptTarget.Latest, true)
  const tagged = tagDispatchHandlers(sf, ts.factory)
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
  return printer.printFile(tagged)
}

describe('tagDispatchHandlers — const-bound translator coverage', () => {
  it('tags a const-bound arrow translator at module scope', () => {
    // The motivating case: module-scope translator paired with a
    // module-scope `*.connect(...)` (decisive.space-2 auth-section).
    // Pass 2 deliberately skips this because eager registration would
    // run outside any render context. Pass 3 instead tags the
    // function so the variants ride along with the reference; the
    // library `*.connect` impl propagates them onto returned handlers
    // via `tagSend`, and the variants finally register at element
    // bind time (which is always inside a render context).
    const out = emitTrans(`const sendMenu = (m) => dispatch({ type: 'Auth/UserMenu' })`)
    expect(out).toContain(`__lluiVariants: ["Auth/UserMenu"]`)
    expect(out).toContain(`Object.assign((m) => dispatch({ type: 'Auth/UserMenu' })`)
  })

  it('tags a const-bound function expression translator', () => {
    const out = emitTrans(`const sendMenu = function (m) { dispatch({ type: 'X' }) }`)
    expect(out).toContain(`__lluiVariants: ["X"]`)
  })

  it('discovers multiple variants from branched translator dispatches', () => {
    const out = emitTrans(`
      const sendMenu = (m) => {
        if (m.type === 'open') dispatch({ type: 'Open' })
        else dispatch({ type: 'Close' })
      }
    `)
    expect(out).toContain(`__lluiVariants: ["Open", "Close"]`)
  })

  it('tags translators declared inside a view function', () => {
    // Same as Pass 2 covers via __registerScopeVariants, but Pass 3
    // produces a redundant tag on the function itself. The double
    // registration (one eager via Pass 2, one lazy via the binding)
    // refcounts cleanly: each path increments and decrements the same
    // variant key independently.
    const out = emitTrans(`
      const App = component({
        view: () => {
          const sendPopover = (m) => dispatch({ type: 'X' })
          return [div({}, [])]
        }
      })
    `)
    expect(out).toContain(`__lluiVariants: ["X"]`)
  })

  it('tags let and var declarations', () => {
    expect(emitTrans(`let sendMenu = (m) => dispatch({ type: 'X' })`)).toContain(
      `__lluiVariants: ["X"]`,
    )
    expect(emitTrans(`var sendMenu = (m) => dispatch({ type: 'Y' })`)).toContain(
      `__lluiVariants: ["Y"]`,
    )
  })
})

describe('tagDispatchHandlers — const-bound non-tagging cases', () => {
  it('skips functions whose body has no literal dispatches', () => {
    expect(emitTrans(`const sendMenu = (m) => doSomething(m)`)).not.toContain('__lluiVariants')
  })

  it('skips dispatches with non-literal type fields', () => {
    expect(emitTrans(`const sendMenu = (m) => dispatch({ type: msgType })`)).not.toContain(
      '__lluiVariants',
    )
  })

  it('still tags the inner arrow inside a user-applied Object.assign wrapper', () => {
    // The universal tagger walks every arrow regardless of context,
    // including arrows that the user manually wrapped with
    // `Object.assign(arrow, {…})`. The result is a stacked wrap:
    // `Object.assign(Object.assign(arrow, {__lluiVariants}), {extra})`.
    // Both objects merge onto the underlying function — `__lluiVariants`
    // and `extra` both end up readable. Stacking is harmless; the
    // alternative (skipping wrapped contexts) would silently disable
    // tagging for arrows the user wraps for unrelated reasons.
    const src = `const sendMenu = Object.assign((m) => dispatch({ type: 'X' }), { extra: true })`
    const out = emitTrans(src)
    expect(out).toContain(`__lluiVariants: ["X"]`)
    expect(out).toContain(`extra: true`)
  })

  it('skips destructured bindings (no plain identifier name)', () => {
    expect(emitTrans(`const { sendMenu } = createMenu()`)).not.toContain('__lluiVariants')
  })

  it('skips dispatches via property-access callee (e.g. store.dispatch)', () => {
    // collectLiteralSendVariants only matches `<id>({type:'X'})`. A
    // PropertyAccessExpression callee like `store.dispatch` is too
    // ambiguous to treat as a Msg dispatcher — could be any setter.
    expect(emitTrans(`const sendMenu = (m) => store.dispatch({ type: 'X' })`)).not.toContain(
      '__lluiVariants',
    )
  })

  it('skips non-function initializers', () => {
    expect(emitTrans(`const config = { type: 'X' }`)).not.toContain('__lluiVariants')
  })
})
