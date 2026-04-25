import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { tagEventHandlerSends } from '../src/binding-descriptors.js'

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
