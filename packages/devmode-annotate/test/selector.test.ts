/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildSelector, uniqueSelectorFor } from '../src/selector.js'

// Finding 15 — the three previously-divergent selector builders (element
// picker / repro recorder / debug collector) now share ONE module.

describe('buildSelector (shared short/stable selector)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('prefers #id and stops climbing', () => {
    document.body.innerHTML = '<section id="hero"><button class="cta">Go</button></section>'
    expect(buildSelector(document.querySelector('button')!)).toBe('#hero > button.cta')
  })

  it('uses tag.class, skipping llui- classes', () => {
    document.body.innerHTML = '<div class="llui-x panel"><span class="label">hi</span></div>'
    const sel = buildSelector(document.querySelector('span')!)
    expect(sel).toContain('span.label')
    expect(sel).toContain('div.panel')
    expect(sel).not.toContain('llui-x')
  })

  it('disambiguates homogeneous siblings with :nth-of-type', () => {
    document.body.innerHTML = '<ul id="list"><li>a</li><li>b</li><li>c</li></ul>'
    const third = document.querySelectorAll('li')[2]!
    expect(buildSelector(third)).toBe('#list > li:nth-of-type(3)')
    // The selector round-trips: it resolves back to that exact element.
    expect(document.querySelector(buildSelector(third))).toBe(third)
  })
})

describe('uniqueSelectorFor (full unique path)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('returns the id selector when present', () => {
    document.body.innerHTML = '<div id="thing-1"></div>'
    expect(uniqueSelectorFor(document.getElementById('thing-1')!)).toBe('#thing-1')
  })

  it('builds a nth-child path up to the root', () => {
    document.body.innerHTML = '<ul><li>a</li><li>b</li></ul>'
    const second = document.querySelectorAll('li')[1]!
    const sel = uniqueSelectorFor(second)!
    expect(document.querySelector(sel)).toBe(second)
  })
})
