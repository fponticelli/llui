import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import {
  tagEventHandlerSends,
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
  const tagged = tagEventHandlerSends(sf, ts.factory)
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
  return printer.printFile(tagged)
}

describe('tagEventHandlerSends — happy path', () => {
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

describe('tagEventHandlerSends — non-tagging cases', () => {
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

  it('does not tag non-event properties that happen to contain sends', () => {
    // `class: (s) => send(...)` is nonsensical but the tagger should
    // only react to keys matching /^on[A-Z]/ — accidentally tagging
    // any prop with a function value would over-register variants.
    const src = `
      const v = button({
        class: () => send({ type: 'X' }),
        title: () => send({ type: 'Y' }),
      }, [])
    `
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

// ── Pass 2: connect-pattern injector ────────────────────────────────

function emitInject(source: string): { out: string; injected: boolean } {
  const sf = ts.createSourceFile('view.ts', source, ts.ScriptTarget.Latest, true)
  const result = injectScopeVariantRegistrations(sf, ts.factory)
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
  return { out: printer.printFile(result.sf), injected: result.injected }
}

describe('injectScopeVariantRegistrations — happy path', () => {
  it('emits __registerScopeVariants adjacent to *.connect calls with literal-dispatch sendFns', () => {
    const { out, injected } = emitInject(`
      const sendPopover = (m) => {
        if (m.type === 'open') dispatch({ type: 'Editor/OpenCell' })
        else dispatch({ type: 'Editor/Close' })
      }
      const parts = popover.connect(getPopoverState, sendPopover, { id })
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
      const parts = dialog.connect(get, (m) => {
        if (m.type === 'close') dispatch({ type: 'Confirm/Close' })
      }, opts)
    `)
    expect(injected).toBe(true)
    expect(out).toContain(`__registerScopeVariants(["Confirm/Close"])`)
  })

  it('does nothing when the sendFn body has no literal dispatches', () => {
    const { injected } = emitInject(`
      const sendThru = (m) => libCall(m)
      const parts = popover.connect(get, sendThru, opts)
    `)
    expect(injected).toBe(false)
  })

  it('skips non-connect call patterns even if they look similar', () => {
    const { out, injected } = emitInject(`
      const sendPopover = (m) => dispatch({ type: 'X' })
      const result = popover.attach(get, sendPopover, opts)
    `)
    expect(injected).toBe(false)
    expect(out).not.toContain('__registerScopeVariants')
  })

  it('matches multiple connect calls in the same scope', () => {
    const { out, injected } = emitInject(`
      const sendA = (m) => dispatch({ type: 'A' })
      const sendB = (m) => dispatch({ type: 'B' })
      const a = popover.connect(get, sendA)
      const b = dialog.connect(get, sendB)
    `)
    expect(injected).toBe(true)
    expect(out).toContain('__registerScopeVariants(["A"])')
    expect(out).toContain('__registerScopeVariants(["B"])')
  })

  it('matches a connect call deep inside a render callback (each item)', () => {
    const { out, injected } = emitInject(`
      view: ({ each }) => each((s) => s.cells, (cell) => {
        const sendPopover = (m) => dispatch({ type: 'Editor/OpenCell' })
        const parts = popover.connect(get, sendPopover)
        return div(parts.trigger, [])
      })
    `)
    expect(injected).toBe(true)
    expect(out).toContain('__registerScopeVariants(["Editor/OpenCell"])')
  })

  it('skips when the sendFn identifier resolves to a non-function', () => {
    const { injected } = emitInject(`
      const notAFn = { foo: 'bar' }
      const parts = popover.connect(get, notAFn, opts)
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
      const parts = popover.connect(get, importedSend, opts)
    `)
    expect(injected).toBe(false)
  })
})
