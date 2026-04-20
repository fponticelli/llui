import { describe, it, expect } from 'vitest'
import {
  handleDescribeVisibleContent,
  type DescribeVisibleHost,
} from '../../../src/client/rpc/describe-visible-content.js'

function makeHost(root: Element | null): DescribeVisibleHost {
  return {
    getRootElement: () => root,
    getBindingDescriptors: () => null,
    getMsgAnnotations: () => null,
  }
}

describe('handleDescribeVisibleContent', () => {
  it('no root element → empty outline', () => {
    const result = handleDescribeVisibleContent(makeHost(null))
    expect(result.outline).toEqual([])
  })

  it('walks data-agent-tagged subtree: headings h1-h6', () => {
    const container = document.createElement('div')
    const zone = document.createElement('section')
    zone.setAttribute('data-agent', 'content')
    const h1 = document.createElement('h1')
    h1.textContent = 'Main Title'
    const h3 = document.createElement('h3')
    h3.textContent = 'Sub Section'
    zone.appendChild(h1)
    zone.appendChild(h3)
    container.appendChild(zone)

    const result = handleDescribeVisibleContent(makeHost(container))
    expect(result.outline).toEqual([
      { kind: 'heading', level: 1, text: 'Main Title' },
      { kind: 'heading', level: 3, text: 'Sub Section' },
    ])
  })

  it('buttons → {kind: "button", text, disabled, actionVariant}', () => {
    const container = document.createElement('div')
    const zone = document.createElement('div')
    zone.setAttribute('data-agent', 'actions')
    const btn = document.createElement('button')
    btn.setAttribute('data-agent', 'submitAction')
    btn.textContent = 'Submit'
    ;(btn as HTMLButtonElement).disabled = false
    const disabledBtn = document.createElement('button')
    disabledBtn.setAttribute('data-agent', 'cancelAction')
    disabledBtn.textContent = 'Cancel'
    ;(disabledBtn as HTMLButtonElement).disabled = true
    zone.appendChild(btn)
    zone.appendChild(disabledBtn)
    container.appendChild(zone)

    const result = handleDescribeVisibleContent(makeHost(container))
    expect(result.outline).toEqual([
      { kind: 'button', text: 'Submit', disabled: false, actionVariant: 'submitAction' },
      { kind: 'button', text: 'Cancel', disabled: true, actionVariant: 'cancelAction' },
    ])
  })

  it('ul/ol → {kind: "list", items: [{kind: "item", text}...]}', () => {
    const container = document.createElement('div')
    const zone = document.createElement('div')
    zone.setAttribute('data-agent', 'list-zone')
    const ul = document.createElement('ul')
    const li1 = document.createElement('li')
    li1.textContent = 'Item one'
    const li2 = document.createElement('li')
    li2.textContent = 'Item two'
    ul.appendChild(li1)
    ul.appendChild(li2)
    zone.appendChild(ul)
    container.appendChild(zone)

    const result = handleDescribeVisibleContent(makeHost(container))
    expect(result.outline).toEqual([
      {
        kind: 'list',
        items: [
          { kind: 'item', text: 'Item one' },
          { kind: 'item', text: 'Item two' },
        ],
      },
    ])
  })

  it('plain text (leaf with no children) → {kind: "text", text}', () => {
    const container = document.createElement('div')
    const zone = document.createElement('div')
    zone.setAttribute('data-agent', 'text-zone')
    const p = document.createElement('p')
    p.textContent = 'Hello world'
    zone.appendChild(p)
    container.appendChild(zone)

    const result = handleDescribeVisibleContent(makeHost(container))
    expect(result.outline).toEqual([{ kind: 'text', text: 'Hello world' }])
  })

  it('links with href → {kind: "link", text, href}', () => {
    const container = document.createElement('div')
    const zone = document.createElement('nav')
    zone.setAttribute('data-agent', 'nav')
    const a = document.createElement('a')
    a.setAttribute('href', '/home')
    a.textContent = 'Home'
    zone.appendChild(a)
    container.appendChild(zone)

    const result = handleDescribeVisibleContent(makeHost(container))
    expect(result.outline).toEqual([{ kind: 'link', text: 'Home', href: '/home' }])
  })

  it('no data-agent-tagged elements → empty outline', () => {
    const container = document.createElement('div')
    const p = document.createElement('p')
    p.textContent = 'Untagged content'
    container.appendChild(p)

    const result = handleDescribeVisibleContent(makeHost(container))
    expect(result.outline).toEqual([])
  })
})
