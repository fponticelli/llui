import { describe, it, expect } from 'vitest'
import { elSplit } from '../src/el-split'
import { createScope } from '../src/scope'
import { setRenderContext, clearRenderContext } from '../src/render-context'

// REPRO: Bug 5 — elSplit should auto-wrap raw string children as
// Text nodes, matching createElement's behavior. Previously it called
// parent.appendChild(child) unconditionally, which crashed on primitive
// strings with "parameter 1 is not of type 'Node'".
describe('elSplit — string children', () => {
  it('wraps a raw string child in a Text node (does not throw)', () => {
    setRenderContext({
      rootScope: createScope(null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      state: {} as any,
      allBindings: [],
      structuralBlocks: [],
    })
    try {
      const el = elSplit('button', null, null, null, ['Sign in'])
      expect(el.tagName).toBe('BUTTON')
      expect(el.textContent).toBe('Sign in')
      expect(el.childNodes.length).toBe(1)
      expect(el.childNodes[0]!.nodeType).toBe(3) // Text node
    } finally {
      clearRenderContext()
    }
  })

  it('mixes string and Node children in one call', () => {
    setRenderContext({
      rootScope: createScope(null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      state: {} as any,
      allBindings: [],
      structuralBlocks: [],
    })
    try {
      const span = document.createElement('span')
      span.textContent = 'inner'
      const el = elSplit('div', null, null, null, ['Hello ', span, '!'])
      expect(el.textContent).toBe('Hello inner!')
      expect(el.childNodes.length).toBe(3)
    } finally {
      clearRenderContext()
    }
  })
})
