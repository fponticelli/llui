import { describe, it, expect } from 'vitest'
import { renderToString } from '../../src/signals/ssr'
import { el, staticText } from '../../src/signals/dom'
import type { SignalComponentDef } from '../../src/signals/component'

// Regression (audit finding: SSR drops form-control state): `applyAttr` routes
// value/checked/selected to IDL properties that don't reflect to attributes, and
// the serializer read only attributes — so server-rendered forms painted empty.

describe('signal SSR — form control state', () => {
  it('serializes input value, checkbox checked, textarea value, and selected option', () => {
    const def: SignalComponentDef<Record<string, never>, never> = {
      init: () => ({}),
      update: (s) => s,
      view: () => [
        el('form', {}, [
          el('input', { type: 'text', value: 'hello', id: 'name' }, []),
          el('input', { type: 'checkbox', checked: true, id: 'agree' }, []),
          el('input', { type: 'checkbox', checked: false, id: 'no' }, []),
          el('textarea', { value: 'multi\nline', id: 'bio' }, []),
          el('select', { value: 'b', id: 'pick' }, [
            el('option', { value: 'a' }, [staticText('A')]),
            el('option', { value: 'b' }, [staticText('B')]),
          ]),
        ]),
      ],
    }
    const html = renderToString(def, undefined, document)
    expect(html).toContain('value="hello"')
    // checked box present, unchecked absent
    expect(html).toMatch(/<input[^>]*id="agree"[^>]*\bchecked\b/)
    expect(html).not.toMatch(/<input[^>]*id="no"[^>]*\bchecked\b/)
    // textarea value as escaped child text
    expect(html).toContain('<textarea id="bio">multi\nline</textarea>')
    // the matching option carries `selected`
    expect(html).toMatch(/<option value="b"[^>]*\bselected\b[^>]*>B<\/option>/)
    expect(html).not.toMatch(/<option value="a"[^>]*\bselected\b/)
  })
})
