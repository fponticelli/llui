import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
// @ts-expect-error -- plain-JS script helpers, consumed by the repo's own tooling
import { publishedAttrValues, unresolvedAttrTypes } from '../lib/registry-attrs.mjs'

/**
 * The value arm gives NO VERDICT on an OPEN type, and until #248 a NAMED type
 * was always open — so `'data-state': Signal<MeterThreshold>` silenced it while
 * the shipped skin styled two values the machine never emitted, for a release.
 *
 * These pin the resolution that closed that, and — more importantly — the SEVEN
 * shapes it must still decline. A wrong verdict here is a build failure for a
 * consumer who did nothing wrong, so every decline is asserted individually
 * rather than inferred from the one positive case.
 */

let root: string
let pkg: string
let src: string

/** Resolve `data-x` on a part bag declared with `type`, in `src/main.ts`. */
async function valuesOf(type: string): Promise<Set<string> | null> {
  const file = path.join(src, 'main.ts')
  const source = `export interface P { root: { 'data-x': ${type} } }\n`
  await writeFile(file, source)
  const map: Map<string, Set<string> | null> = publishedAttrValues(file, source, new Map())
  return map.get('data-x') ?? null
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'llui-attr-alias-'))
  pkg = path.join(root, 'pkg')
  src = path.join(pkg, 'src')
  await mkdir(src, { recursive: true })
  await writeFile(path.join(pkg, 'package.json'), '{"name":"@fixture/pkg"}\n')

  // A sibling in the same package, imported with the NodeNext `.js` extension.
  await writeFile(path.join(src, 'sibling.ts'), `export type Tone = 'good' | 'bad'\n`)
  // A re-export barrel: `export type { X } from './y.js'`.
  await writeFile(
    path.join(src, 'barrel.ts'),
    `export type { Tone as Reexported } from './sibling.js'\n`,
  )
  // An alias chain: alias → alias → literals.
  await writeFile(
    path.join(src, 'chain.ts'),
    `import type { Tone } from './sibling.js'\nexport type Chained = Tone\n`,
  )
  // A mutually recursive pair, to prove the cycle guard rather than a stack overflow.
  await writeFile(
    path.join(src, 'cyc-a.ts'),
    `import type { B } from './cyc-b.js'\nexport type A = B\n`,
  )
  await writeFile(
    path.join(src, 'cyc-b.ts'),
    `import type { A } from './cyc-a.js'\nexport type B = A\n`,
  )
  // A file OUTSIDE the package root — reachable by path, never by resolution.
  await mkdir(path.join(root, 'outside'), { recursive: true })
  await writeFile(path.join(root, 'outside', 'far.ts'), `export type Far = 'nope'\n`)
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('the value arm follows a same-package type alias', () => {
  it('resolves an alias declared in the same file', async () => {
    const source = [
      `type Status = 'pending' | 'done'`,
      `export interface P { root: { 'data-x': Signal<Status> } }`,
    ].join('\n')
    const file = path.join(src, 'main.ts')
    await writeFile(file, source)
    const map: Map<string, Set<string> | null> = publishedAttrValues(file, source, new Map())
    expect([...(map.get('data-x') ?? [])].sort()).toEqual(['done', 'pending'])
  })

  it('resolves an alias imported from a sibling with a `.js` specifier', async () => {
    const source = [
      `import type { Tone } from './sibling.js'`,
      `export interface P { root: { 'data-x': Signal<Tone> } }`,
    ].join('\n')
    const file = path.join(src, 'main.ts')
    await writeFile(file, source)
    const map: Map<string, Set<string> | null> = publishedAttrValues(file, source, new Map())
    expect([...(map.get('data-x') ?? [])].sort()).toEqual(['bad', 'good'])
  })

  it('resolves through a named re-export and through an alias chain', async () => {
    const source = [
      `import type { Reexported } from './barrel.js'`,
      `import type { Chained } from './chain.js'`,
      `export interface P {`,
      `  a: { 'data-x': Signal<Reexported> }`,
      `}`,
      `export interface Q { b: { 'data-y': Chained } }`,
    ].join('\n')
    const file = path.join(src, 'main.ts')
    await writeFile(file, source)
    const map: Map<string, Set<string> | null> = publishedAttrValues(file, source, new Map())
    expect([...(map.get('data-x') ?? [])].sort()).toEqual(['bad', 'good'])
    expect([...(map.get('data-y') ?? [])].sort()).toEqual(['bad', 'good'])
  })

  it('unions a resolved alias with inline members and drops nullish ones', async () => {
    // `undefined` / `null` mean ABSENT, which no `[attr=value]` can select.
    const source = [
      `type Tone2 = 'good' | 'bad'`,
      `export interface P { root: { 'data-x': Signal<Tone2 | 'extra' | undefined> } }`,
    ].join('\n')
    const file = path.join(src, 'main.ts')
    await writeFile(file, source)
    const map: Map<string, Set<string> | null> = publishedAttrValues(file, source, new Map())
    expect([...(map.get('data-x') ?? [])].sort()).toEqual(['bad', 'extra', 'good'])
  })
})

describe('the value arm FAILS CLOSED on anything it cannot follow', () => {
  // Each case must give NO VERDICT (`null`), never an empty set — an empty set
  // would report every value the recipe names as dead, which is a build failure
  // for a consumer who did nothing wrong.

  it('declines a BARE specifier (another package)', async () => {
    // The specifier is `sibling`, and `./sibling.ts` EXISTS beside this file —
    // so a resolver that dropped the `./` test would happily resolve it and
    // report `good|bad` for a type it has never seen. Pointing the fixture at a
    // name with no file beside it would pass for the wrong reason: the
    // filesystem, not the guard, would be doing the declining.
    const source = [
      `import type { Tone } from 'sibling'`,
      `export interface P { root: { 'data-x': Signal<Tone> } }`,
    ].join('\n')
    const file = path.join(src, 'main.ts')
    await writeFile(file, source)
    const map: Map<string, Set<string> | null> = publishedAttrValues(file, source, new Map())
    expect(map.get('data-x')).toBeNull()
  })

  it('declines a relative path that leaves the package root', async () => {
    const source = [
      `import type { Far } from '../../outside/far.js'`,
      `export interface P { root: { 'data-x': Signal<Far> } }`,
    ].join('\n')
    const file = path.join(src, 'main.ts')
    await writeFile(file, source)
    const map: Map<string, Set<string> | null> = publishedAttrValues(file, source, new Map())
    expect(map.get('data-x')).toBeNull()
  })

  it('declines a GENERIC alias and a type ARGUMENT list', async () => {
    for (const decl of [
      // A parameter used in the body. Also caught by the type-parameter check,
      // so it is the WEAKER of the two fixtures — keep both.
      `type Boxed<T> = T | 'boxed'\nexport interface P { root: { 'data-x': Signal<Boxed<'a'>> } }`,
      // A parameter the body IGNORES. Nothing else declines this: with the
      // generic guards gone the alias resolves and the arm reports `a|b` for an
      // instantiation it never evaluated. This is the fixture that makes the
      // generic property observable on its own.
      `type Ignored<T> = 'a' | 'b'\nexport interface P { root: { 'data-x': Signal<Ignored<'zz'>> } }`,
    ]) {
      const file = path.join(src, 'main.ts')
      await writeFile(file, decl)
      const map: Map<string, Set<string> | null> = publishedAttrValues(file, decl, new Map())
      expect(map.get('data-x'), decl).toBeNull()
    }
  })

  it('declines a TYPE PARAMETER — the real `MenuItemAttrs<Scope extends string>` shape', async () => {
    const source = `export interface P<Scope extends string> { root: { 'data-x': Scope } }`
    const file = path.join(src, 'main.ts')
    await writeFile(file, source)
    const map: Map<string, Set<string> | null> = publishedAttrValues(file, source, new Map())
    expect(map.get('data-x')).toBeNull()
  })

  it('declines a type parameter that SHADOWS a module-level alias of the same name', async () => {
    // The one shape where the type-parameter check is the ONLY thing standing
    // between the guard and a WRONG verdict. Everywhere else a type parameter
    // also fails the alias lookup, so dropping the check changes nothing; here
    // the lookup succeeds and answers about a completely different type.
    const source = [
      `type Scope = 'menu' | 'submenu'`,
      `export interface P<Scope extends string> { root: { 'data-x': Scope } }`,
    ].join('\n')
    const file = path.join(src, 'main.ts')
    await writeFile(file, source)
    const map: Map<string, Set<string> | null> = publishedAttrValues(file, source, new Map())
    expect(map.get('data-x')).toBeNull()
  })

  it('declines a CYCLE rather than recursing forever', async () => {
    const source = [
      `import type { A } from './cyc-a.js'`,
      `export interface P { root: { 'data-x': Signal<A> } }`,
    ].join('\n')
    const file = path.join(src, 'main.ts')
    await writeFile(file, source)
    const map: Map<string, Set<string> | null> = publishedAttrValues(file, source, new Map())
    expect(map.get('data-x')).toBeNull()
  })

  it('declines an INTERFACE, a mapped type and a conditional type', async () => {
    for (const decl of [
      `interface Shape { a: 1 }\nexport interface P { root: { 'data-x': Shape } }`,
      `type Mapped = { [K in 'a' | 'b']: K }[('a' | 'b')]\nexport interface P { root: { 'data-x': Mapped } }`,
      `type Cond<T = 'a'> = T extends 'a' ? 'x' : 'y'\nexport interface P { root: { 'data-x': Cond } }`,
    ]) {
      const file = path.join(src, 'main.ts')
      await writeFile(file, decl)
      const map: Map<string, Set<string> | null> = publishedAttrValues(file, decl, new Map())
      expect(map.get('data-x'), decl).toBeNull()
    }
  })

  it('declines a MISSING sibling file', async () => {
    const source = [
      `import type { Gone } from './not-here.js'`,
      `export interface P { root: { 'data-x': Signal<Gone> } }`,
    ].join('\n')
    const file = path.join(src, 'main.ts')
    await writeFile(file, source)
    const map: Map<string, Set<string> | null> = publishedAttrValues(file, source, new Map())
    expect(map.get('data-x')).toBeNull()
  })

  it('still declines a plain `string`, as it always did', async () => {
    expect(await valuesOf('Signal<string>')).toBeNull()
    expect(await valuesOf('string')).toBeNull()
    expect(await valuesOf('`a-${string}`')).toBeNull()
  })
})

describe('the residue report names only what a resolver could have followed', () => {
  it('reports an unfollowable NAMED type, with why', async () => {
    const source = [
      `import type { Tone } from '@llui/dom'`,
      `export interface P { root: { 'data-x': Signal<Tone> } }`,
    ].join('\n')
    const file = path.join(src, 'main.ts')
    await writeFile(file, source)
    const found: { attr: string; reason: string }[] = unresolvedAttrTypes(file, source, new Map())
    expect(found.map((f) => f.attr)).toEqual(['data-x'])
    expect(found[0]!.reason).toBe('Tone: unresolved')
  })

  it('does NOT report a plain `string` / `number` / `boolean`', async () => {
    // These are honestly open — no resolver can enumerate them — so listing
    // them would drown the residue pin in 200 entries it can never act on.
    const source = [
      `export interface P {`,
      `  root: { 'data-a': string; 'aria-b': Signal<number>; 'data-c': boolean }`,
      `}`,
    ].join('\n')
    const file = path.join(src, 'main.ts')
    await writeFile(file, source)
    const found: unknown[] = unresolvedAttrTypes(file, source, new Map())
    expect(found).toEqual([])
  })

  it('does NOT report an attribute that resolves', async () => {
    const source = [
      `import type { Tone } from './sibling.js'`,
      `export interface P { root: { 'data-x': Signal<Tone> } }`,
    ].join('\n')
    const file = path.join(src, 'main.ts')
    await writeFile(file, source)
    const found: unknown[] = unresolvedAttrTypes(file, source, new Map())
    expect(found).toEqual([])
  })

  it('names a type PARAMETER as such, not as an unresolved alias', async () => {
    const source = `export interface P<Scope extends string> { root: { 'data-x': Scope } }`
    const file = path.join(src, 'main.ts')
    await writeFile(file, source)
    const found: { reason: string }[] = unresolvedAttrTypes(file, source, new Map())
    expect(found.map((f) => f.reason)).toEqual(['Scope: type parameter'])
  })
})
