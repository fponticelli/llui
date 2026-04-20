import { describe, it, expect, beforeEach } from 'vitest'
import { handleQueryDom, type QueryDomHost } from '../../../src/client/rpc/query-dom.js'

function makeHost(root: Element | null): QueryDomHost {
  return { getRootElement: () => root }
}

describe('handleQueryDom', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
  })

  it('finds element with data-agent="<name>", returns text + attrs + path', () => {
    const span = document.createElement('span')
    span.setAttribute('data-agent', 'submitBtn')
    span.textContent = 'Submit'
    container.appendChild(span)

    const result = handleQueryDom(makeHost(container), { name: 'submitBtn' })

    expect(result.elements).toHaveLength(1)
    const el = result.elements[0]
    expect(el).toBeDefined()
    expect(el!.text).toBe('Submit')
    expect(el!.attrs['data-agent']).toBe('submitBtn')
    expect(el!.path).toEqual([0])
  })

  it('multiple:true returns all matches; multiple:false returns only first', () => {
    const a = document.createElement('button')
    a.setAttribute('data-agent', 'action')
    a.textContent = 'First'
    const b = document.createElement('button')
    b.setAttribute('data-agent', 'action')
    b.textContent = 'Second'
    container.appendChild(a)
    container.appendChild(b)

    const multi = handleQueryDom(makeHost(container), { name: 'action', multiple: true })
    expect(multi.elements).toHaveLength(2)
    expect(multi.elements[0]!.text).toBe('First')
    expect(multi.elements[1]!.text).toBe('Second')

    const single = handleQueryDom(makeHost(container), { name: 'action', multiple: false })
    expect(single.elements).toHaveLength(1)
    expect(single.elements[0]!.text).toBe('First')
  })

  it('missing name returns empty elements array', () => {
    const result = handleQueryDom(makeHost(container), { name: 'nonexistent' })
    expect(result.elements).toHaveLength(0)
  })

  it('escapes double-quotes in name to avoid selector injection', () => {
    // A name with double-quotes would break a naive querySelector; our escaping should handle it.
    const el = document.createElement('div')
    // Set a data-agent value that contains a double-quote via setAttribute directly
    el.setAttribute('data-agent', 'foo"bar')
    el.textContent = 'Tricky'
    container.appendChild(el)

    // The escaped selector [data-agent="foo\"bar"] should find the element
    const result = handleQueryDom(makeHost(container), { name: 'foo"bar' })
    expect(result.elements).toHaveLength(1)
    expect(result.elements[0]!.text).toBe('Tricky')
  })

  it('no root element returns empty elements array', () => {
    const result = handleQueryDom(makeHost(null), { name: 'anything' })
    expect(result.elements).toEqual([])
  })

  it('path reflects correct child index for nested element', () => {
    const outer = document.createElement('div')
    const inner = document.createElement('div')
    const target = document.createElement('span')
    target.setAttribute('data-agent', 'nested')
    target.textContent = 'deep'
    inner.appendChild(target)
    outer.appendChild(inner)
    container.appendChild(outer)

    const result = handleQueryDom(makeHost(container), { name: 'nested' })
    expect(result.elements).toHaveLength(1)
    // container → outer(0) → inner(0) → target(0)
    expect(result.elements[0]!.path).toEqual([0, 0, 0])
  })
})
