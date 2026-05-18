import { describe, it, expect } from 'vitest'
import { transformUseClientSsr, hasUseClientDirective } from '../src/transform'

describe("'use client' directive detection", () => {
  it('detects the directive as the first statement', () => {
    expect(hasUseClientDirective("'use client'\nexport const X = 1")).toBe(true)
    expect(hasUseClientDirective('"use client"\nexport const X = 1')).toBe(true)
  })

  it('skips leading whitespace and comments before the directive', () => {
    expect(hasUseClientDirective("  \n'use client'\nexport const X = 1")).toBe(true)
    expect(hasUseClientDirective("// header comment\n'use client'")).toBe(true)
    expect(hasUseClientDirective("/* block */ 'use client'")).toBe(true)
    expect(
      hasUseClientDirective("/**\n * JSDoc header\n */\n'use client'\nexport const X = 1"),
    ).toBe(true)
  })

  it('rejects the string mid-file or inside a function', () => {
    expect(hasUseClientDirective("import x from 'y'\n'use client'")).toBe(false)
    expect(hasUseClientDirective("export function f() { 'use client'; return 1 }")).toBe(false)
    expect(hasUseClientDirective("const x = 'use client'")).toBe(false)
  })

  it('rejects absence', () => {
    expect(hasUseClientDirective('export const X = 1')).toBe(false)
    expect(hasUseClientDirective('')).toBe(false)
  })
})

describe("'use client' SSR transform", () => {
  it('stubs every `export const`', () => {
    const src = `'use client'
import L from 'leaflet'
import { component } from '@llui/dom'

export const MapWidget = component({ name: 'MapWidget', init: () => [{}, []], update: (s) => [s, []], view: () => [] })
export const AnotherOne = component({ name: 'AnotherOne', init: () => [{}, []], update: (s) => [s, []], view: () => [] })
`
    const result = transformUseClientSsr(src, 'widgets.ts')
    expect(result).not.toBeNull()
    expect(result!.output).toContain("import { __clientOnlyStub } from '@llui/dom'")
    expect(result!.output).toContain(`export const MapWidget = __clientOnlyStub("MapWidget")`)
    expect(result!.output).toContain(`export const AnotherOne = __clientOnlyStub("AnotherOne")`)
    // The leaflet import must NOT appear in the stub output — that's
    // the whole point: the SSR bundle never reaches leaflet.
    expect(result!.output).not.toContain('leaflet')
  })

  it('stubs `export default`', () => {
    const src = `'use client'
import { component } from '@llui/dom'
export default component({ name: 'Widget', init: () => [{}, []], update: (s) => [s, []], view: () => [] })
`
    const result = transformUseClientSsr(src, 'widget.ts')
    expect(result).not.toBeNull()
    expect(result!.output).toContain('export default __clientOnlyStub("default")')
  })

  it('stubs `export function`', () => {
    const src = `'use client'
export function makeWidget() { return null }
`
    const result = transformUseClientSsr(src, 'f.ts')
    expect(result).not.toBeNull()
    expect(result!.output).toContain(`export const makeWidget = __clientOnlyStub("makeWidget")`)
  })

  it('stubs `export class`', () => {
    const src = `'use client'
export class Thing {}
`
    const result = transformUseClientSsr(src, 'c.ts')
    expect(result).not.toBeNull()
    expect(result!.output).toContain(`export const Thing = __clientOnlyStub("Thing")`)
  })

  it('stubs named `export { a, b }` lists', () => {
    const src = `'use client'
const a = 1
const b = 2
export { a, b }
`
    const result = transformUseClientSsr(src, 'named.ts')
    expect(result).not.toBeNull()
    expect(result!.output).toContain(`export const a = __clientOnlyStub("a")`)
    expect(result!.output).toContain(`export const b = __clientOnlyStub("b")`)
  })

  it('warns on re-exports that bypass stubbing', () => {
    const src = `'use client'
export { Chart } from 'chart.js'
`
    const result = transformUseClientSsr(src, 'reexport.ts')
    expect(result).not.toBeNull()
    expect(result!.warnings.length).toBeGreaterThan(0)
    expect(result!.warnings[0]).toContain('re-export')
  })

  it('drops all top-level imports from the stub output', () => {
    const src = `'use client'
import L from 'leaflet'
import { Chart } from 'chart.js'
import type { Foo } from './foo'
export const X = 1
`
    const result = transformUseClientSsr(src, 'imports.ts')
    expect(result).not.toBeNull()
    expect(result!.output).not.toContain('leaflet')
    expect(result!.output).not.toContain('chart.js')
    // Type imports are erased anyway, but double-check they don't leak.
    expect(result!.output).not.toContain("from './foo'")
  })

  it('returns null when the directive is absent', () => {
    const src = `export const X = 1`
    expect(transformUseClientSsr(src, 'x.ts')).toBeNull()
  })
})
