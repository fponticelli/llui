import { describe, it, expect } from 'vitest'
import {
  findTypeSource,
  extractMsgAnnotationsCrossFile,
  extractDiscriminatedUnionSchemaCrossFile,
  type ResolveContext,
} from '../src/cross-file-resolver.js'
import path from 'node:path'

/**
 * In-memory ResolveContext for tests. `files` keys are absolute paths;
 * relative imports are resolved against the importer's directory and
 * tried with `.ts` and `/index.ts` suffixes.
 */
function memoryCtx(files: Record<string, string>): ResolveContext {
  return {
    resolveModule: async (spec, importerPath) => {
      // Bare specifier: not relative — we don't try to resolve packages
      // in tests; returning null exercises the fallback path.
      if (!spec.startsWith('.')) return null
      const dir = path.dirname(importerPath)
      const base = path.resolve(dir, spec)
      if (files[base]) return base
      if (files[`${base}.ts`]) return `${base}.ts`
      if (files[`${base}/index.ts`]) return `${base}/index.ts`
      return null
    },
    readSource: async (p) => {
      const v = files[p]
      if (v === undefined) throw new Error(`memoryCtx: no source for ${p}`)
      return v
    },
  }
}

describe('findTypeSource', () => {
  it('finds a locally-declared type alias', async () => {
    const files = {
      '/proj/app.ts': `
        type Msg = { type: 'inc' }
        const x = 1
      `,
    }
    const ctx = memoryCtx(files)
    const result = await findTypeSource('Msg', files['/proj/app.ts']!, '/proj/app.ts', ctx)
    expect(result).not.toBeNull()
    expect(result?.localName).toBe('Msg')
    expect(result?.filePath).toBe('/proj/app.ts')
  })

  it('follows a named import to the file declaring the type', async () => {
    const files = {
      '/proj/app.ts': `
        import { Msg } from './msg'
        export const App = component<State, Msg, never>({})
      `,
      '/proj/msg.ts': `
        export type Msg = { type: 'inc' } | { type: 'dec' }
      `,
    }
    const ctx = memoryCtx(files)
    const result = await findTypeSource('Msg', files['/proj/app.ts']!, '/proj/app.ts', ctx)
    expect(result?.filePath).toBe('/proj/msg.ts')
    expect(result?.localName).toBe('Msg')
  })

  it('follows an import with a rename (import { X as Y })', async () => {
    const files = {
      '/proj/app.ts': `
        import { Msg as M } from './msg'
        export const App = component<S, M, never>({})
      `,
      '/proj/msg.ts': `
        export type Msg = { type: 'inc' }
      `,
    }
    const ctx = memoryCtx(files)
    // We're looking for the local name `M`, which resolves through to
    // `Msg` in msg.ts.
    const result = await findTypeSource('M', files['/proj/app.ts']!, '/proj/app.ts', ctx)
    expect(result?.filePath).toBe('/proj/msg.ts')
    expect(result?.localName).toBe('Msg')
  })

  it('follows a one-level re-export (export { X } from)', async () => {
    const files = {
      '/proj/app.ts': `
        import { Msg } from './state'
        const x = 1
      `,
      '/proj/state.ts': `
        export { Msg } from './msg'
      `,
      '/proj/msg.ts': `
        export type Msg = { type: 'inc' }
      `,
    }
    const ctx = memoryCtx(files)
    const result = await findTypeSource('Msg', files['/proj/app.ts']!, '/proj/app.ts', ctx)
    expect(result?.filePath).toBe('/proj/msg.ts')
    expect(result?.localName).toBe('Msg')
  })

  it('follows a renamed re-export (export { X as Y } from)', async () => {
    const files = {
      '/proj/app.ts': `
        import { PublicMsg } from './state'
      `,
      '/proj/state.ts': `
        export { Msg as PublicMsg } from './msg'
      `,
      '/proj/msg.ts': `
        export type Msg = { type: 'inc' }
      `,
    }
    const ctx = memoryCtx(files)
    const result = await findTypeSource('PublicMsg', files['/proj/app.ts']!, '/proj/app.ts', ctx)
    expect(result?.filePath).toBe('/proj/msg.ts')
    expect(result?.localName).toBe('Msg')
  })

  it('returns null when the type is not declared locally and not imported', async () => {
    const files = {
      '/proj/app.ts': `
        const x = 1
      `,
    }
    const ctx = memoryCtx(files)
    const result = await findTypeSource('Msg', files['/proj/app.ts']!, '/proj/app.ts', ctx)
    expect(result).toBeNull()
  })

  it('returns null when the import resolves to nothing (bare specifier in test ctx)', async () => {
    const files = {
      '/proj/app.ts': `
        import { Msg } from 'some-package'
      `,
    }
    const ctx = memoryCtx(files)
    const result = await findTypeSource('Msg', files['/proj/app.ts']!, '/proj/app.ts', ctx)
    expect(result).toBeNull()
  })

  it("returns null when there's a cycle in re-exports", async () => {
    // Pathological: a.ts re-exports from b.ts which re-exports from a.ts.
    // The visited set bails out instead of stack-overflowing.
    const files = {
      '/proj/a.ts': `export { X } from './b'`,
      '/proj/b.ts': `export { X } from './a'`,
    }
    const ctx = memoryCtx(files)
    const result = await findTypeSource('X', files['/proj/a.ts']!, '/proj/a.ts', ctx)
    expect(result).toBeNull()
  })

  it('finds an interface declaration (not just type alias)', async () => {
    const files = {
      '/proj/app.ts': `
        interface Foo { x: number }
      `,
    }
    const ctx = memoryCtx(files)
    const result = await findTypeSource('Foo', files['/proj/app.ts']!, '/proj/app.ts', ctx)
    expect(result?.localName).toBe('Foo')
  })

  it("follows `export * from './y'` to find the type in the barrel target", async () => {
    const files = {
      '/proj/app.ts': `
        import { Msg } from './state'
      `,
      '/proj/state.ts': `
        export * from './msg'
      `,
      '/proj/msg.ts': `
        export type Msg = { type: 'inc' }
      `,
    }
    const ctx = memoryCtx(files)
    const result = await findTypeSource('Msg', files['/proj/app.ts']!, '/proj/app.ts', ctx)
    expect(result?.filePath).toBe('/proj/msg.ts')
    expect(result?.localName).toBe('Msg')
  })

  it('walks multiple `export *` declarations in the same barrel', async () => {
    // `state.ts` has two `export *` declarations; `Msg` only lives in
    // the second one. The resolver tries each in order until it finds
    // the type — silently giving up on the first miss would mask the
    // common monorepo barrel-with-multiple-modules pattern.
    const files = {
      '/proj/app.ts': `
        import { Msg } from './state'
      `,
      '/proj/state.ts': `
        export * from './effects'
        export * from './msg'
      `,
      '/proj/effects.ts': `
        export type Effect = { type: 'http' }
      `,
      '/proj/msg.ts': `
        export type Msg = { type: 'go' }
      `,
    }
    const ctx = memoryCtx(files)
    const result = await findTypeSource('Msg', files['/proj/app.ts']!, '/proj/app.ts', ctx)
    expect(result?.filePath).toBe('/proj/msg.ts')
  })

  it('follows nested `export *` chains (barrel → barrel → leaf)', async () => {
    const files = {
      '/proj/app.ts': `
        import { Msg } from './a'
      `,
      '/proj/a.ts': `
        export * from './b'
      `,
      '/proj/b.ts': `
        export * from './msg'
      `,
      '/proj/msg.ts': `
        export type Msg = { type: 'deep' }
      `,
    }
    const ctx = memoryCtx(files)
    const result = await findTypeSource('Msg', files['/proj/app.ts']!, '/proj/app.ts', ctx)
    expect(result?.filePath).toBe('/proj/msg.ts')
  })

  it('named re-export wins over `export *` when both reach the same name', async () => {
    // `state.ts` has both an explicit `export { Msg }` from one path
    // AND a barrel `export *` from another. The named re-export comes
    // first in the resolver's order — that's what TypeScript itself
    // does for symbol resolution.
    const files = {
      '/proj/app.ts': `
        import { Msg } from './state'
      `,
      '/proj/state.ts': `
        export { Msg } from './explicit'
        export * from './barrel'
      `,
      '/proj/explicit.ts': `
        export type Msg = { type: 'explicit' }
      `,
      '/proj/barrel.ts': `
        export type Msg = { type: 'barrel' }
      `,
    }
    const ctx = memoryCtx(files)
    const result = await findTypeSource('Msg', files['/proj/app.ts']!, '/proj/app.ts', ctx)
    expect(result?.filePath).toBe('/proj/explicit.ts')
  })
})

describe('extractMsgAnnotationsCrossFile — composition', () => {
  it('walks an inline + imported composed union', async () => {
    const files = {
      '/proj/msg.ts': `
        export type CounterMsg =
          /** @intent("Increment") */
          | { type: 'inc' }
          /** @intent("Decrement") */
          | { type: 'dec' }
      `,
      '/proj/app.ts': `
        import { CounterMsg } from './msg'
        type Msg =
          | CounterMsg
          /** @intent("Reset") @requiresConfirm */
          | { type: 'reset' }
      `,
    }
    const ctx = memoryCtx(files)
    const result = await extractMsgAnnotationsCrossFile(
      files['/proj/app.ts']!,
      'Msg',
      '/proj/app.ts',
      ctx,
    )
    expect(result).not.toBeNull()
    // All three variants present — inline and imported.
    expect(Object.keys(result!).sort()).toEqual(['dec', 'inc', 'reset'])
    expect(result!.inc?.intent).toBe('Increment')
    expect(result!.dec?.intent).toBe('Decrement')
    expect(result!.reset?.intent).toBe('Reset')
    expect(result!.reset?.requiresConfirm).toBe(true)
  })

  it('handles deep composition chains (A → B → C)', async () => {
    const files = {
      '/proj/c.ts': `
        export type Leaf = /** @intent("Bottom") */ { type: 'bottom' }
      `,
      '/proj/b.ts': `
        import { Leaf } from './c'
        export type Mid = Leaf | /** @intent("Middle") */ { type: 'middle' }
      `,
      '/proj/app.ts': `
        import { Mid } from './b'
        type Msg = Mid | /** @intent("Top") */ { type: 'top' }
      `,
    }
    const ctx = memoryCtx(files)
    const result = await extractMsgAnnotationsCrossFile(
      files['/proj/app.ts']!,
      'Msg',
      '/proj/app.ts',
      ctx,
    )
    expect(Object.keys(result ?? {}).sort()).toEqual(['bottom', 'middle', 'top'])
  })

  it('first-walked variant wins on duplicate discriminants', async () => {
    // Pathological: two halves of the union both claim `type: 'inc'`.
    // Behaviour should be deterministic — first walked (inline literal,
    // before the TypeReference) wins. The lint rule reports this
    // independently; the extractor must not throw.
    const files = {
      '/proj/msg.ts': `
        export type Imported =
          /** @intent("Should not win") */
          | { type: 'inc' }
      `,
      '/proj/app.ts': `
        import { Imported } from './msg'
        type Msg =
          /** @intent("Local wins") */
          | { type: 'inc' }
          | Imported
      `,
    }
    const ctx = memoryCtx(files)
    const result = await extractMsgAnnotationsCrossFile(
      files['/proj/app.ts']!,
      'Msg',
      '/proj/app.ts',
      ctx,
    )
    expect(result?.inc?.intent).toBe('Local wins')
  })

  it('returns null when the union resolves to nothing extractable', async () => {
    const files = {
      '/proj/app.ts': `
        type Msg = string | number
      `,
    }
    const ctx = memoryCtx(files)
    const result = await extractMsgAnnotationsCrossFile(
      files['/proj/app.ts']!,
      'Msg',
      '/proj/app.ts',
      ctx,
    )
    expect(result).toBeNull()
  })

  it('handles a single-variant alias (not wrapped in a union)', async () => {
    // `type Msg = { type: 'a' }` — no `|` operator; a one-element "union".
    // The extractor treats it as a single-element union for consistency.
    const files = {
      '/proj/app.ts': `
        /** @intent("Alone") */
        type Msg = { type: 'a' }
      `,
    }
    const ctx = memoryCtx(files)
    const result = await extractMsgAnnotationsCrossFile(
      files['/proj/app.ts']!,
      'Msg',
      '/proj/app.ts',
      ctx,
    )
    // The leading JSDoc is on the alias itself, not the union member.
    // The resolver finds the variant; intent extraction may or may not
    // catch the alias-level JSDoc (existing extractor's behavior).
    expect(Object.keys(result ?? {})).toContain('a')
  })
})

describe('extractDiscriminatedUnionSchemaCrossFile — composition', () => {
  it('merges schema variants across composed types', async () => {
    const files = {
      '/proj/msg.ts': `
        export type CounterMsg = { type: 'inc' } | { type: 'dec'; by: number }
      `,
      '/proj/app.ts': `
        import { CounterMsg } from './msg'
        type Msg = CounterMsg | { type: 'reset' }
      `,
    }
    const ctx = memoryCtx(files)
    const result = await extractDiscriminatedUnionSchemaCrossFile(
      files['/proj/app.ts']!,
      'Msg',
      '/proj/app.ts',
      ctx,
    )
    expect(result?.discriminant).toBe('type')
    expect(Object.keys(result?.variants ?? {}).sort()).toEqual(['dec', 'inc', 'reset'])
    expect(result?.variants.dec).toEqual({ by: 'number' })
    expect(result?.variants.reset).toEqual({})
  })
})
