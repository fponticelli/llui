import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setAriaHiddenOutside } from '../../src/utils/aria-hidden'

describe('setAriaHiddenOutside()', () => {
  let target: HTMLElement
  let sibling1: HTMLElement
  let sibling2: HTMLElement
  let uncle: HTMLElement

  beforeEach(() => {
    const parent = document.createElement('div')
    target = document.createElement('div')
    target.id = 'target'
    sibling1 = document.createElement('div')
    sibling1.id = 'sib1'
    sibling2 = document.createElement('div')
    sibling2.id = 'sib2'
    parent.append(sibling1, target, sibling2)

    uncle = document.createElement('div')
    uncle.id = 'uncle'

    document.body.append(parent, uncle)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('hides siblings up the tree', () => {
    const cleanup = setAriaHiddenOutside(target)
    expect(sibling1.getAttribute('aria-hidden')).toBe('true')
    expect(sibling2.getAttribute('aria-hidden')).toBe('true')
    expect(uncle.getAttribute('aria-hidden')).toBe('true')
    expect(target.getAttribute('aria-hidden')).toBeNull()
    cleanup()
  })

  it('applies inert alongside aria-hidden', () => {
    const cleanup = setAriaHiddenOutside(target)
    expect(sibling1.hasAttribute('inert')).toBe(true)
    cleanup()
  })

  it('restores original attributes on cleanup', () => {
    sibling1.setAttribute('aria-hidden', 'false')
    const cleanup = setAriaHiddenOutside(target)
    expect(sibling1.getAttribute('aria-hidden')).toBe('true')
    cleanup()
    expect(sibling1.getAttribute('aria-hidden')).toBe('false')
    expect(sibling1.hasAttribute('inert')).toBe(false)
  })

  it('removes attributes that were absent', () => {
    const cleanup = setAriaHiddenOutside(target)
    cleanup()
    expect(sibling1.hasAttribute('aria-hidden')).toBe(false)
    expect(sibling1.hasAttribute('inert')).toBe(false)
  })

  it('reference-counts nested calls', () => {
    const cleanupA = setAriaHiddenOutside(target)
    const cleanupB = setAriaHiddenOutside(target)
    cleanupA()
    // Still hidden because second call holds reference
    expect(sibling1.getAttribute('aria-hidden')).toBe('true')
    cleanupB()
    expect(sibling1.hasAttribute('aria-hidden')).toBe(false)
  })

  it('skips script/style siblings', () => {
    const parent = target.parentElement!
    const scriptEl = document.createElement('script')
    parent.appendChild(scriptEl)
    const cleanup = setAriaHiddenOutside(target)
    expect(scriptEl.hasAttribute('aria-hidden')).toBe(false)
    cleanup()
  })
})

// A modal's inert sweep must not silence the app's announcement channels: an
// `aria-hidden` live region is simply never read out, so a toast raised while a
// dialog is open disappears for screen-reader users (#123).
describe('setAriaHiddenOutside() — live regions stay announceable', () => {
  let content: HTMLElement

  beforeEach(() => {
    content = document.createElement('div')
    document.body.append(content)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('does not hide a body-level live region', () => {
    const region = document.createElement('div')
    region.setAttribute('role', 'region')
    region.setAttribute('aria-live', 'polite')
    const plain = document.createElement('div')
    document.body.append(region, plain)

    const cleanup = setAriaHiddenOutside(content)
    expect(region.hasAttribute('inert')).toBe(false)
    expect(region.getAttribute('aria-hidden')).toBeNull()
    // A sibling with nothing to announce is still hidden.
    expect(plain.hasAttribute('inert')).toBe(true)
    cleanup()
  })

  it('recognizes role=alert / role=status / role=log', () => {
    const roles = ['alert', 'status', 'log']
    const els = roles.map((role) => {
      const el = document.createElement('div')
      el.setAttribute('role', role)
      document.body.append(el)
      return el
    })
    const cleanup = setAriaHiddenOutside(content)
    for (const el of els) expect(el.hasAttribute('inert')).toBe(false)
    cleanup()
  })

  it('recognizes <output> (implicit role=status)', () => {
    // `<output>` carries an implicit `role="status"` / `aria-live="polite"` and
    // needs neither attribute written out, so a selector matching only explicit
    // ones misses the one live region the platform gives you for free.
    const out = document.createElement('output')
    const plain = document.createElement('div')
    document.body.append(out, plain)
    const cleanup = setAriaHiddenOutside(content)
    expect(out.hasAttribute('inert')).toBe(false)
    expect(out.getAttribute('aria-hidden')).toBeNull()
    // Non-vacuous: the sweep really ran.
    expect(plain.hasAttribute('inert')).toBe(true)
    cleanup()
  })

  it('an explicit role on <output> still wins', () => {
    // `role` overrides the implicit one, so an `<output role="presentation">` is
    // not an announcement channel and must be swept like anything else.
    const out = document.createElement('output')
    out.setAttribute('role', 'presentation')
    document.body.append(out)
    const cleanup = setAriaHiddenOutside(content)
    expect(out.hasAttribute('inert')).toBe(true)
    cleanup()
  })

  it('aria-live="off" is not an announcement channel', () => {
    const off = document.createElement('div')
    off.setAttribute('aria-live', 'off')
    document.body.append(off)
    const cleanup = setAriaHiddenOutside(content)
    expect(off.hasAttribute('inert')).toBe(true)
    cleanup()
  })

  it('hides AROUND a nested live region instead of sparing the whole subtree', () => {
    // The live region sits deep in the app tree. Skipping the sibling wholesale
    // would leave the entire app interactive behind the modal — the sweep must
    // descend and hide everything except the path down to the region.
    const app = document.createElement('div')
    const column = document.createElement('div')
    const form = document.createElement('div')
    const error = document.createElement('div')
    error.setAttribute('aria-live', 'polite')
    const other = document.createElement('div')
    form.append(error)
    column.append(form, other)
    const aside = document.createElement('div')
    app.append(column, aside)
    document.body.append(app)

    const cleanup = setAriaHiddenOutside(content)
    // The path down to the region is not inert…
    expect(app.hasAttribute('inert')).toBe(false)
    expect(column.hasAttribute('inert')).toBe(false)
    expect(form.hasAttribute('inert')).toBe(false)
    expect(error.hasAttribute('inert')).toBe(false)
    // …but everything hanging off that path is.
    expect(aside.hasAttribute('inert')).toBe(true)
    expect(other.hasAttribute('inert')).toBe(true)

    cleanup()
    expect(aside.hasAttribute('inert')).toBe(false)
    expect(other.hasAttribute('inert')).toBe(false)
  })
})
