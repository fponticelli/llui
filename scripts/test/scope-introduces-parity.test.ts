import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { scopeIntroduces as portedScopeIntroduces } from '../lib/registry-classes.mjs'
import { scopeIntroduces as compilerScopeIntroduces } from '../../packages/compiler/src/signals/helper-bindings.ts'

/**
 * #264 review follow-up (review-264h LOW): `registry-classes.mjs` cannot
 * IMPORT `@llui/compiler`'s real `scopeIntroduces` — it is exported from
 * `packages/compiler/src/signals/helper-bindings.ts` but deliberately not
 * re-exported from that package's public barrel (`isShadowed`/
 * `scopeIntroduces` "appear in no public signature" by design, per
 * `packages/compiler/src/index.ts`) — so its SEMANTICS were ported by hand
 * instead. A hand port can drift from its source of truth silently; this
 * file runs a SHARED fixture corpus through both implementations and fails
 * the build the moment they disagree, rather than trusting the port's own
 * comment that it matches.
 *
 * The compiler's own file is reached by a direct relative import into its
 * SOURCE (not the published `@llui/compiler` package, whose barrel does not
 * expose this function) — legitimate here because both files live in the
 * same monorepo checkout and this test's only job is to compare the two
 * IMPLEMENTATIONS, not to exercise the published package boundary.
 */

interface Case {
  readonly label: string
  readonly code: string
  readonly name: string
}

const CASES: readonly Case[] = [
  {
    label: 'arrow function parameter',
    code: 'const f = (foo) => { return foo }',
    name: 'foo',
  },
  {
    label: 'function declaration parameter',
    code: 'function f(foo) { return foo }',
    name: 'foo',
  },
  {
    label: 'destructured arrow parameter',
    code: 'const f = ({ foo }) => foo',
    name: 'foo',
  },
  {
    label: 'block-scoped const, nested block',
    code: 'function f() { { const foo = 1; return foo } }',
    name: 'foo',
  },
  {
    label: 'switch-case const shared across clauses (no per-case block scope)',
    code: `
      function f(x) {
        switch (x) {
          case 1:
            const foo = 1
            return foo
          default:
            return foo
        }
      }
    `,
    name: 'foo',
  },
  {
    label: 'function expression self-name (self-recursive call)',
    code: 'const g = function send(m) { return send(m) }',
    name: 'send',
  },
  {
    label: 'class expression self-name, read from a nested method',
    code: 'const C = class Named { static m() { return Named } }',
    name: 'Named',
  },
  {
    label: 'for-of loop initializer',
    code: 'function f(xs) { for (const foo of xs) { return foo } }',
    name: 'foo',
  },
  {
    label: 'destructured for-of loop initializer',
    code: 'function f(xs) { for (const { foo } of xs) { return foo } }',
    name: 'foo',
  },
  {
    label: 'for-in loop initializer',
    code: 'function f(obj) { for (const foo in obj) { return foo } }',
    name: 'foo',
  },
  {
    label: 'plain for loop initializer',
    code: 'function f() { for (let foo = 0; foo < 10; foo++) { return foo } }',
    name: 'foo',
  },
  {
    label: 'catch clause binding',
    code: 'function f() { try { } catch (foo) { return foo } }',
    name: 'foo',
  },
  {
    label: 'hoisted function declaration inside a nested block',
    code: 'function f() { { function foo() {} return foo } }',
    name: 'foo',
  },
  {
    label: 'hoisted class declaration inside a nested block',
    code: 'function f() { { class Foo {} return Foo } }',
    name: 'Foo',
  },
  {
    label: 'free reference bound nowhere (module-level global)',
    code: 'function f() { return foo }',
    name: 'foo',
  },
]

/**
 * Every identifier in `sf` whose text is `name`, in ANY position (binding or
 * read) — deliberately over-inclusive, since `scopeIntroduces` does not care
 * which position it is asked about, and checking both strengthens the
 * parity comparison rather than narrowing it.
 */
function findIdentifiers(sf: ts.SourceFile, name: string): ts.Identifier[] {
  const out: ts.Identifier[] = []
  const walk = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && n.text === name) out.push(n)
    ts.forEachChild(n, walk)
  }
  walk(sf)
  return out
}

describe('scopeIntroduces parity: registry-classes.mjs port vs @llui/compiler', () => {
  for (const { label, code, name } of CASES) {
    it(label, () => {
      const sf = ts.createSourceFile(
        'fixture.ts',
        code,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      )
      const ids = findIdentifiers(sf, name)
      expect(ids.length).toBeGreaterThan(0)
      for (const id of ids) {
        let current: ts.Node | undefined = id.parent
        while (current !== undefined && !ts.isSourceFile(current)) {
          const ported = portedScopeIntroduces(current, name)
          const real = compilerScopeIntroduces(current, name)
          expect(
            ported,
            `mismatch for "${name}" at a ${ts.SyntaxKind[current.kind]} node in case "${label}": ` +
              `ported=${ported} real=${real}`,
          ).toBe(real)
          current = current.parent
        }
      }
    })
  }
})
