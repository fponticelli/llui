import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform'

// REPRO: Bug 1 revised — when a reactive attribute value is a local
// `const <name> = (s) => ...` identifier reference instead of an inline
// arrow, the compiler was emitting `__e.className = <name>` in the static
// setup fn. At runtime this coerces the function to its source string,
// producing `<a class="(s) => ...">` in the DOM and no binding at all.
//
// The compiler must resolve the identifier to its const-bound arrow and
// emit a real reactive binding tuple, exactly as if the arrow had been
// inlined in the element helper call.

describe('compiler — hoisted arrow accessor identifier', () => {
  it('resolves `const cls = (s) => ...` and emits a binding, not a static assignment', () => {
    const src = `
      import { component, a, text } from '@llui/dom'
      type State = { pathname: string }
      type Item = { href: string; label: string }
      const ITEMS: Item[] = [{ href: '/one', label: 'One' }, { href: '/two', label: 'Two' }]
      export const C = component<State, never, never>({
        name: 'Repro',
        init: () => [{ pathname: '/one' }, []],
        update: (s) => [s, []],
        view: ({ text: t }) =>
          ITEMS.map((navItem) => {
            const cls = (s: State): string =>
              \`const-\${navItem.href === s.pathname ? 'on' : 'off'}\`
            return a({ href: navItem.href, class: cls }, [t(navItem.label)])
          }),
      })
    `
    const out = transformLlui(src, 'test.ts')?.output ?? ''
    // The broken path would emit a static assignment:
    //   __e.className = cls
    // The fixed path resolves `cls` to its arrow and emits a binding tuple
    // whose accessor body references `s.pathname`.
    expect(out).not.toMatch(/\.className\s*=\s*cls\b/)
    expect(out).not.toMatch(/setAttribute\(\s*['"]class['"]\s*,\s*cls\s*\)/)
    // The arrow body (or its equivalent after compilation) should be
    // reachable in the emitted output — proof that the const's initializer
    // made it into a binding accessor.
    expect(out).toMatch(/s\.pathname/)
  })

  it('inline arrow form still works (regression guard)', () => {
    const src = `
      import { component, a, text } from '@llui/dom'
      type State = { pathname: string }
      export const C = component<State, never, never>({
        name: 'Inline',
        init: () => [{ pathname: '/' }, []],
        update: (s) => [s, []],
        view: ({ text: t }) => [
          a({ class: (s) => s.pathname === '/' ? 'on' : 'off' }, [t('home')]),
        ],
      })
    `
    const out = transformLlui(src, 'test.ts')?.output ?? ''
    expect(out).toMatch(/s\.pathname/)
    expect(out).not.toMatch(/\.className\s*=\s*\(/)
  })

  it('does NOT resolve `let` bindings (reassignment would invalidate the resolution)', () => {
    const src = `
      import { component, a, text } from '@llui/dom'
      type State = { pathname: string }
      export const C = component<State, never, never>({
        name: 'LetBinding',
        init: () => [{ pathname: '/' }, []],
        update: (s) => [s, []],
        view: ({ text: t }) => {
          let cls = (s: State) => s.pathname
          return [a({ class: cls }, [t('x')])]
        },
      })
    `
    // For let, we bail out of resolution — the emit path for a plain
    // identifier falls through. We don't assert a specific emit shape
    // here; we just ensure the compiler doesn't crash.
    expect(() => transformLlui(src, 'test.ts')).not.toThrow()
  })
})
