import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { evalDynamic } from '../src/binding.js'
import { getNumberFormat, sharedPluralRules } from '../src/catalog/functions.js'
import {
  basicCatalog,
  mountA2ui,
  type A2uiHandle,
  type FunctionCall,
  type JsonValue,
} from '../src/index.js'

const ev = (
  call: FunctionCall,
  data: JsonValue = {},
  root: JsonValue = data,
): JsonValue | undefined => evalDynamic(basicCatalog, root, data, call)

describe('validation functions', () => {
  it('required', () => {
    expect(ev({ call: 'required', args: { value: '' } })).toBe(false)
    expect(ev({ call: 'required', args: { value: null } })).toBe(false)
    expect(ev({ call: 'required', args: { value: 'x' } })).toBe(true)
    expect(ev({ call: 'required', args: { value: { path: '/name' } } }, { name: 'Ada' })).toBe(true)
  })
  it('regex', () => {
    expect(ev({ call: 'regex', args: { value: 'abc', pattern: '^a' } })).toBe(true)
    expect(ev({ call: 'regex', args: { value: 'xyz', pattern: '^a' } })).toBe(false)
  })
  it('regex rejects over-cap pattern/input (ReDoS guard)', () => {
    const hugePattern = '(a+)+'.repeat(300) // > 1000 chars
    expect(ev({ call: 'regex', args: { value: 'aaaa', pattern: hugePattern } })).toBe(false)
    const hugeInput = 'a'.repeat(20_000) // > 10000 chars
    expect(ev({ call: 'regex', args: { value: hugeInput, pattern: '^a' } })).toBe(false)
  })
  it('regex still matches for within-cap pattern/input', () => {
    expect(ev({ call: 'regex', args: { value: 'a'.repeat(9_000), pattern: '^a+$' } })).toBe(true)
  })
  it('length', () => {
    expect(ev({ call: 'length', args: { value: 'abcd', min: 2, max: 3 } })).toBe(false)
    expect(ev({ call: 'length', args: { value: 'ab', min: 2, max: 3 } })).toBe(true)
  })
  it('numeric', () => {
    expect(ev({ call: 'numeric', args: { value: 5, min: 1, max: 10 } })).toBe(true)
    expect(ev({ call: 'numeric', args: { value: 50, min: 1, max: 10 } })).toBe(false)
    expect(ev({ call: 'numeric', args: { value: 'nope' } })).toBe(false)
  })
  it('email', () => {
    expect(ev({ call: 'email', args: { value: 'a@b.com' } })).toBe(true)
    expect(ev({ call: 'email', args: { value: 'nope' } })).toBe(false)
  })
})

describe('boolean logic (nested evaluation)', () => {
  it('and / or / not compose with nested calls', () => {
    expect(ev({ call: 'and', args: { values: [true, true] } })).toBe(true)
    expect(ev({ call: 'and', args: { values: [true, false] } })).toBe(false)
    expect(ev({ call: 'or', args: { values: [false, true] } })).toBe(true)
    expect(ev({ call: 'not', args: { value: false } })).toBe(true)
    // nested: not(email('nope')) === true
    expect(ev({ call: 'not', args: { value: { call: 'email', args: { value: 'nope' } } } })).toBe(
      true,
    )
  })
})

describe('formatString interpolation', () => {
  it('interpolates relative and absolute paths, with escaping', () => {
    expect(ev({ call: 'formatString', args: { value: 'Hi ${name}' } }, { name: 'Bo' })).toBe(
      'Hi Bo',
    )
    expect(ev({ call: 'formatString', args: { value: 'Hi ${/name}' } }, { name: 'Bo' })).toBe(
      'Hi Bo',
    )
    expect(ev({ call: 'formatString', args: { value: 'cost \\${x}' } })).toBe('cost ${x}')
  })
})

describe('number / currency / date / pluralize', () => {
  it('formatNumber with decimals', () => {
    expect(ev({ call: 'formatNumber', args: { value: 3.14159, decimals: 2 } })).toBe('3.14')
  })
  it('formatCurrency', () => {
    expect(ev({ call: 'formatCurrency', args: { value: 5, currency: 'USD' } })).toContain('5.00')
  })
  it('formatDate with a TR35 pattern (timezone-safe local date)', () => {
    expect(ev({ call: 'formatDate', args: { value: '2024/01/15', format: 'yyyy-MM-dd' } })).toBe(
      '2024-01-15',
    )
  })
  it('memoizes Intl.NumberFormat by options signature and shares one PluralRules (fix 5)', () => {
    // A distinct options shape (unused elsewhere) so cache identity is deterministic.
    const opts = { useGrouping: false, minimumFractionDigits: 7, maximumFractionDigits: 7 }
    const a = getNumberFormat(opts)
    const b = getNumberFormat({ ...opts })
    expect(a).toBe(b) // reused, not reconstructed per evaluation
    // Distinct options ⇒ distinct formatter.
    expect(
      getNumberFormat({ ...opts, minimumFractionDigits: 6, maximumFractionDigits: 6 }),
    ).not.toBe(a)
    expect(sharedPluralRules).toBeInstanceOf(Intl.PluralRules)
  })

  it('pluralize picks the plural category', () => {
    const args = { one: '1 item', other: 'many items', zero: 'none' }
    expect(ev({ call: 'pluralize', args: { value: 1, ...args } })).toBe('1 item')
    expect(ev({ call: 'pluralize', args: { value: 5, ...args } })).toBe('many items')
    expect(ev({ call: 'pluralize', args: { value: 0, ...args } })).toBe('none')
  })
})

describe('functions in a live binding (reactive)', () => {
  let container: HTMLElement
  let handle: A2uiHandle
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })
  afterEach(() => {
    handle?.dispose()
    container.remove()
  })

  it('re-evaluates formatString when the bound data changes', () => {
    handle = mountA2ui(container)
    handle.apply([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 's',
          catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's',
          components: [
            {
              id: 'root',
              component: 'Text',
              text: { call: 'formatString', args: { value: 'Hello ${/name}!' } },
            },
          ],
        },
      },
      { version: 'v0.9', updateDataModel: { surfaceId: 's', path: '/', value: { name: 'Ada' } } },
    ])
    expect(container.querySelector('.a2ui-text')?.textContent).toBe('Hello Ada!')
    handle.apply({
      version: 'v0.9',
      updateDataModel: { surfaceId: 's', path: '/name', value: 'Bo' },
    })
    expect(container.querySelector('.a2ui-text')?.textContent).toBe('Hello Bo!')
  })
})
