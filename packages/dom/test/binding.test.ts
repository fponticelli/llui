import { describe, it, expect } from 'vitest'
import { __bindUncertain, createBinding, applyBinding } from '../src/binding'
import { createLifetime } from '../src/lifetime'
import { setRenderContext, clearRenderContext } from '../src/render-context'
import { browserEnv } from '../src/dom-env'
import { FULL_MASK } from '../src/update-loop'

describe('createBinding', () => {
  it('creates a binding with the given properties', () => {
    const scope = createLifetime(null)
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
    expect(binding.ownerLifetime).toBe(scope)
  })

  it('registers the binding on the scope', () => {
    const scope = createLifetime(null)
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

  // ── 'effect' kind — side-effect-only bindings ────────────────────
  //
  // Some bindings exist purely to run their accessor (for its side
  // effects, e.g. the prop-watch binding in `child()`). They have no
  // meaningful value to write into the DOM. Declaring them kind='effect'
  // makes applyBinding a no-op, avoiding object stringification and
  // lastValue churn on every parent update.

  it('__bindUncertain registers FULL_MASK on BOTH words for function values', () => {
    // Regression: __bindUncertain used to set only `mask: FULL_MASK`,
    // leaving `maskHi: 0` by default. The Phase 2 gate is
    // `(mask & dirty) | (maskHi & dirtyHi)`, so a dirty bit in the
    // high word (paths 31..61) silently skipped these bindings —
    // breaking the JSDoc-advertised "fire on any state change"
    // fallback for any component with ≥32 reactive prefixes.
    const rootLifetime = createLifetime(null)
    setRenderContext({
      rootLifetime,
      state: { whatever: 1 },
      allBindings: [],
      structuralBlocks: [],
      dom: browserEnv(),
    })
    try {
      const el = document.createElement('div')
      const accessor = (_s: never) => 'computed'
      __bindUncertain(el, 'attr', 'title', accessor)
      const binding = rootLifetime.bindings[0]!
      expect(binding.mask).toBe(FULL_MASK)
      expect(binding.maskHi).toBe(FULL_MASK)
      // Initial application ran — title is set.
      expect(el.getAttribute('title')).toBe('computed')
    } finally {
      clearRenderContext()
    }
  })

  it('__bindUncertain does NOT register a binding for non-function values', () => {
    const rootLifetime = createLifetime(null)
    setRenderContext({
      rootLifetime,
      state: {},
      allBindings: [],
      structuralBlocks: [],
      dom: browserEnv(),
    })
    try {
      const el = document.createElement('div')
      __bindUncertain(el, 'attr', 'title', 'static value')
      expect(rootLifetime.bindings.length).toBe(0)
      expect(el.getAttribute('title')).toBe('static value')
    } finally {
      clearRenderContext()
    }
  })

  it('is a no-op for kind=effect (does not mutate the node)', () => {
    const comment = document.createComment('watcher')
    const original = comment.nodeValue
    applyBinding({ kind: 'effect', node: comment, key: undefined }, { anything: true })
    expect(comment.nodeValue).toBe(original)
    applyBinding({ kind: 'effect', node: comment, key: undefined }, 'a string')
    expect(comment.nodeValue).toBe(original)
    applyBinding({ kind: 'effect', node: comment, key: undefined }, null)
    expect(comment.nodeValue).toBe(original)
  })
})
