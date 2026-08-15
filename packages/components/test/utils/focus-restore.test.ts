import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { focusLingeredInside } from '../../src/utils/focus-restore'

/**
 * #173 — the ONE rule for "should this layer pull focus back to its anchor?".
 *
 * It used to live only inside `overlay-engine.ts`'s teardown; `popover`'s
 * `dismiss.extra` restored unconditionally, so a dismissal caused by the user
 * moving focus yanked it straight back off whatever they had just reached. The
 * predicate is hoisted here so there is one implementation, not two.
 */
describe('focusLingeredInside', () => {
  let boundary: HTMLElement
  let inside: HTMLElement
  let anchor: HTMLElement
  let outside: HTMLElement

  beforeEach(() => {
    boundary = document.createElement('div')
    inside = document.createElement('button')
    boundary.append(inside)
    anchor = document.createElement('button')
    outside = document.createElement('button')
    document.body.append(boundary, anchor, outside)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('is true when focus rests inside the boundary', () => {
    inside.focus()
    expect(focusLingeredInside({ boundary, anchor })).toBe(true)
  })

  it('is true when focus rests on the boundary itself', () => {
    boundary.tabIndex = -1
    boundary.focus()
    expect(focusLingeredInside({ boundary, anchor })).toBe(true)
  })

  it('is FALSE when the user moved focus somewhere else', () => {
    outside.focus()
    expect(focusLingeredInside({ boundary, anchor })).toBe(false)
  })

  it('is true when focus fell back to the body (nobody chose that)', () => {
    inside.focus()
    inside.blur()
    expect(document.activeElement).toBe(document.body)
    expect(focusLingeredInside({ boundary, anchor })).toBe(true)
  })

  it('treats the anchor as outside unless allowAnchorActive is set', () => {
    anchor.focus()
    expect(focusLingeredInside({ boundary, anchor })).toBe(false)
    // `select` opts in: it focuses its own trigger on open, so without this its
    // restore would read as "the user moved focus to the trigger".
    expect(focusLingeredInside({ boundary, anchor, allowAnchorActive: true })).toBe(true)
  })

  it('allowAnchorActive does not rescue an unrelated element', () => {
    outside.focus()
    expect(focusLingeredInside({ boundary, anchor, allowAnchorActive: true })).toBe(false)
  })

  it('a null anchor cannot be matched by allowAnchorActive', () => {
    // Guards the `active === anchor` comparison against the case where both are
    // absent — a null `activeElement` must be decided by the body/null branch,
    // not by "null equals a null anchor".
    outside.focus()
    expect(focusLingeredInside({ boundary, anchor: null, allowAnchorActive: true })).toBe(false)
  })
})
