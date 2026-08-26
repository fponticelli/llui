import { describe, it, expect, beforeEach } from 'vitest'
import { component, mountApp, button, text } from '../../src/signals/index'
import type { ElProps } from '../../src/signals/index'

/**
 * ARIA state attributes are ENUMERATED, not boolean.
 *
 * HTML boolean attributes (`disabled`, `checked`, `readonly`) mean "true" by
 * their presence, so `disabled=""` is correct and absence means false. ARIA
 * state attributes do not work that way: `aria-checked`, `aria-expanded`,
 * `aria-pressed`, `aria-selected` and friends take the literal STRINGS "true"
 * and "false", and an empty or missing value is not "false" — it is *invalid*,
 * which assistive tech reports as no state at all.
 *
 * The runtime used to apply the HTML rule to every attribute, so a `connect()`
 * part bag doing the natural thing — `'aria-checked': state.map((s) => s.checked)`
 * — produced `aria-checked=""` when on and REMOVED the attribute when off. A
 * `role="switch"` in that state announces nothing. Measured across the component
 * registry demo, seven part types were affected: radio-group item, switch root,
 * toggle root, toggle-group item, rating-group item, tabs trigger and accordion
 * trigger.
 *
 * `null` / `undefined` must still REMOVE the attribute — that is how a part bag
 * says "not applicable" (`state.map((s) => (s.disabled ? 'true' : undefined))`),
 * and turning those into "false" would assert a state the component never
 * claimed.
 */
describe('aria-* boolean values render as enumerated strings', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  function render(props: ElProps): HTMLElement {
    const host = document.createElement('div')
    document.body.appendChild(host)
    mountApp(
      host,
      component<{ n: number }, { type: 'noop' }, never>({
        name: 'AriaProbe',
        init: () => [{ n: 0 }, []],
        update: (s) => [s, []],
        view: () => [button(props, [text('x')])],
      }),
    )
    return host.querySelector('button')!
  }

  it('renders aria-checked={true} as the string "true", not ""', () => {
    expect(render({ 'aria-checked': true }).getAttribute('aria-checked')).toBe('true')
  })

  it('renders aria-checked={false} as "false" rather than removing it', () => {
    // The dangerous half: a `role="switch"` with NO `aria-checked` has no state
    // at all, which reads worse than an explicitly unchecked one.
    const el = render({ role: 'switch', 'aria-checked': false })
    expect(el.hasAttribute('aria-checked')).toBe(true)
    expect(el.getAttribute('aria-checked')).toBe('false')
  })

  it.each(['aria-expanded', 'aria-pressed', 'aria-selected', 'aria-hidden', 'aria-disabled'])(
    'applies the same rule to %s',
    (name) => {
      expect(render({ [name]: true }).getAttribute(name)).toBe('true')
      expect(render({ [name]: false }).getAttribute(name)).toBe('false')
    },
  )

  it('still REMOVES an aria-* attribute for null/undefined', () => {
    // `undefined` is how a part bag spells "not applicable"; rendering "false"
    // there would assert a state the component never claimed.
    expect(render({ 'aria-disabled': undefined }).hasAttribute('aria-disabled')).toBe(false)
    expect(render({ 'aria-disabled': null }).hasAttribute('aria-disabled')).toBe(false)
  })

  it('leaves a string aria value untouched', () => {
    expect(render({ 'aria-checked': 'mixed' }).getAttribute('aria-checked')).toBe('mixed')
  })

  it('does NOT change HTML boolean attributes, which mean true by presence', () => {
    // The rule is scoped to `aria-`: `disabled=""` is correct HTML and absence
    // is correct for false. Widening it would break every native control.
    expect(render({ disabled: true }).getAttribute('disabled')).toBe('')
    expect(render({ disabled: false }).hasAttribute('disabled')).toBe(false)
    expect(render({ hidden: true }).getAttribute('hidden')).toBe('')
  })
})
