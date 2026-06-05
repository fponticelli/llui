import { describe, it, expect } from 'vitest'
import type { Transformer } from '@lexical/markdown'
import { orderTransformers, buildTransformers } from '../src/transformers/registry.js'
import type { MarkdownPlugin } from '../src/plugins/types.js'

// Minimal fake transformers (only the fields the registry inspects).
const t = (type: string, tag = ''): Transformer => ({ type, tag }) as unknown as Transformer

describe('orderTransformers', () => {
  it('orders by category: multiline-element < element < text-format < text-match', () => {
    const input = [t('text-match'), t('text-format', '*'), t('element'), t('multiline-element')]
    expect(orderTransformers(input).map((x) => x.type)).toEqual([
      'multiline-element',
      'element',
      'text-format',
      'text-match',
    ])
  })

  it('orders text-format by descending tag length so *** beats ** beats *', () => {
    const input = [t('text-format', '*'), t('text-format', '***'), t('text-format', '**')]
    expect(orderTransformers(input).map((x) => (x as { tag: string }).tag)).toEqual([
      '***',
      '**',
      '*',
    ])
  })

  it('is stable for equal-rank text-match transformers', () => {
    const a = t('text-match')
    const b = t('text-match')
    const ordered = orderTransformers([a, b])
    expect(ordered[0]).toBe(a)
    expect(ordered[1]).toBe(b)
  })
})

describe('buildTransformers', () => {
  it('flattens plugin contributions, de-duplicates by reference, and orders', () => {
    const shared = t('element')
    const p1: MarkdownPlugin = { name: 'p1', transformers: [t('text-match'), shared] }
    const p2: MarkdownPlugin = { name: 'p2', transformers: [shared, t('text-format', '**')] }
    const out = buildTransformers([p1, p2])
    expect(out.map((x) => x.type)).toEqual(['element', 'text-format', 'text-match'])
    // `shared` appears once.
    expect(out.filter((x) => x === shared)).toHaveLength(1)
  })

  it('tolerates plugins with no transformers', () => {
    expect(buildTransformers([{ name: 'empty' }])).toEqual([])
  })
})
