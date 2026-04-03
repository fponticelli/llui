import { describe, it, expect } from 'vitest'
import { createBinding, applyBinding } from '../src/binding'
import { createScope } from '../src/scope'

describe('createBinding', () => {
  it('creates a binding with the given properties', () => {
    const scope = createScope(null)
    const node = document.createTextNode('')
    const accessor = (s: { count: number }) => String(s.count)
    const binding = createBinding(scope, {
      mask: 0b01,
      accessor,
      kind: 'text',
      node,
      perItem: false,
    })

    expect(binding.mask).toBe(0b01)
    expect(binding.accessor).toBe(accessor)
    expect(binding.kind).toBe('text')
    expect(binding.node).toBe(node)
    expect(binding.perItem).toBe(false)
    expect(binding.lastValue).toBeUndefined()
    expect(binding.ownerScope).toBe(scope)
  })

  it('registers the binding on the scope', () => {
    const scope = createScope(null)
    const node = document.createTextNode('')
    const binding = createBinding(scope, {
      mask: 1,
      accessor: () => 'x',
      kind: 'text',
      node,
      perItem: false,
    })

    expect(scope.bindings).toContain(binding)
  })
})

describe('applyBinding', () => {
  it('sets text node value for text kind', () => {
    const node = document.createTextNode('')
    applyBinding({ kind: 'text', node, key: undefined }, 'hello')
    expect(node.nodeValue).toBe('hello')
  })

  it('sets element property for prop kind', () => {
    const el = document.createElement('input')
    applyBinding({ kind: 'prop', node: el, key: 'value' }, 'test-value')
    expect(el.value).toBe('test-value')
  })

  it('sets attribute for attr kind', () => {
    const el = document.createElement('div')
    applyBinding({ kind: 'attr', node: el, key: 'title' }, 'my title')
    expect(el.getAttribute('title')).toBe('my title')
  })

  it('removes attribute when value is null', () => {
    const el = document.createElement('div')
    el.setAttribute('title', 'old')
    applyBinding({ kind: 'attr', node: el, key: 'title' }, null)
    expect(el.hasAttribute('title')).toBe(false)
  })

  it('removes attribute when value is false', () => {
    const el = document.createElement('div')
    el.setAttribute('data-active', 'true')
    applyBinding({ kind: 'attr', node: el, key: 'data-active' }, false)
    expect(el.hasAttribute('data-active')).toBe(false)
  })

  it('sets className for class kind', () => {
    const el = document.createElement('div')
    applyBinding({ kind: 'class', node: el, key: undefined }, 'foo bar')
    expect(el.className).toBe('foo bar')
  })

  it('sets style property for style kind', () => {
    const el = document.createElement('div')
    applyBinding({ kind: 'style', node: el, key: 'color' }, 'red')
    expect(el.style.color).toBe('red')
  })

  it('removes style property when value is null', () => {
    const el = document.createElement('div')
    el.style.color = 'red'
    applyBinding({ kind: 'style', node: el, key: 'color' }, null)
    expect(el.style.color).toBe('')
  })
})
