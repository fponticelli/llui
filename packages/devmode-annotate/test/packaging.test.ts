import { describe, expect, it } from 'vitest'
// Imported as JSON rather than read through `require`/`node:fs`: both packages
// restrict their `exports` map (so the `./package.json` subpath is unresolvable),
// and this is a browser package that deliberately carries no `@types/node`.
import self from '../package.json'
import markdownEditor from '../../markdown-editor/package.json'

const isLexical = (name: string) => name === 'lexical' || name.startsWith('@lexical/')

/**
 * `@llui/devmode-annotate` value-imports `@llui/markdown-editor` (the HUD's note
 * editor) as a hard dependency, and `@llui/markdown-editor` declares `lexical` +
 * eight `@lexical/*` packages as PEER dependencies — it value-imports them across
 * ~30 source files. A peer is the *consumer's* obligation, and devmode-annotate is
 * that consumer, so these entries are the peer-satisfaction layer, NOT dead weight.
 *
 * They look unused because devmode-annotate's own source references `lexical` exactly
 * once, in a type-only `import type { LexicalEditor }` that is erased at build. A sweep
 * of `src/` therefore "proves" they are droppable — and issue #63 was filed on exactly
 * that reading. Dropping them is invisible to every in-repo signal (build, check and all
 * 261 other tests still pass) because inside the workspace `@llui/markdown-editor`
 * satisfies its own peers from its devDependencies. The breakage only reaches a
 * consumer's install, under a package manager that does not auto-install peers (Yarn's
 * default; pnpm with `auto-install-peers=false`), as nine unmet peers and a HUD whose
 * editor cannot resolve `lexical` at runtime. Measured against a packed tarball, the
 * removal also saves nothing: pnpm/npm auto-install the peers, so the dependency
 * closure is byte-identical at 93 packages either way.
 *
 * This test is the guard that no other in-repo signal can provide.
 */
describe('packaging: Lexical peer satisfaction for @llui/markdown-editor', () => {
  it('declares every Lexical peer of @llui/markdown-editor as its own dependency', () => {
    const required = Object.keys(markdownEditor.peerDependencies).filter(isLexical).sort()
    // Guard the guard: if markdown-editor ever stops peering Lexical this test would
    // silently stop testing anything, so assert the precondition still holds.
    expect(required.length).toBeGreaterThan(0)

    const declared = Object.keys(self.dependencies).filter(isLexical).sort()
    expect(declared).toEqual(required)
  })

  it('keeps them in dependencies, not devDependencies (they must reach consumers)', () => {
    expect(Object.keys(self.devDependencies).filter(isLexical)).toEqual([])
  })

  it('does not regress @llui/dom out of peerDependencies', () => {
    // The repo-wide packaging landmine: @llui/dom as a hard dep gives a consumer two
    // physical installs, each with its own module-scoped currentContext, and every
    // provide()/structural primitive throws. It must stay a peer.
    expect(self.peerDependencies).toHaveProperty('@llui/dom')
    expect(self.dependencies).not.toHaveProperty('@llui/dom')
  })
})
