/// <reference lib="dom" />
// Tests for the Save / Solve action buttons and the markdown toolbar.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mountAnnotateHud } from '../src/index.js'

function mockFetch(): Array<[string, RequestInit]> {
  const calls: Array<[string, RequestInit]> = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push([url, init])
    return new Response(
      JSON.stringify({ id: '001', filename: 'x.md', path: '/x', sessionId: 's' }),
      { status: 201 },
    )
  }) as unknown as typeof fetch
  return calls
}

function dispatchKey(
  target: Element,
  key: string,
  opts: { metaKey?: boolean; ctrlKey?: boolean } = {},
): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      metaKey: opts.metaKey,
      ctrlKey: opts.ctrlKey,
      bubbles: true,
      cancelable: true,
    }),
  )
}

beforeEach(() => {
  document.body.innerHTML = ''
  localStorage.removeItem('llui-devmode-annotate.position')
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Save / Solve action buttons', () => {
  it('renders Cancel, Save note, and Solve buttons', () => {
    mountAnnotateHud({ subscribeEvents: false })
    const root = document.getElementById('llui-devmode-annotate-root')!
    const labels = Array.from(root.querySelectorAll('button')).map((b) => b.textContent ?? '')
    expect(labels).toEqual(expect.arrayContaining(['Cancel', 'Save note']))
    // Solve lives inside a split button — match by data attribute,
    // not exact textContent (the main button includes a ↻ glyph when
    // resume mode is on).
    expect(root.querySelector('[data-llui-solve]')).not.toBeNull()
  })

  it("Solve submits with intent='task'", async () => {
    const calls = mockFetch()
    mountAnnotateHud({ subscribeEvents: false })
    const root = document.getElementById('llui-devmode-annotate-root')!
    const textarea = root.querySelector('textarea')!
    textarea.value = 'fix it'
    const solveBtn = root.querySelector('[data-llui-solve]') as HTMLButtonElement
    solveBtn.click()
    await new Promise((r) => setTimeout(r, 5))
    const body = JSON.parse(calls[0]![1].body as string) as {
      frontmatter: { intent: string }
    }
    expect(body.frontmatter.intent).toBe('task')
  })

  it("Save note submits with intent='note'", async () => {
    const calls = mockFetch()
    mountAnnotateHud({ subscribeEvents: false })
    const root = document.getElementById('llui-devmode-annotate-root')!
    const textarea = root.querySelector('textarea')!
    textarea.value = 'just fyi'
    const saveBtn = Array.from(root.querySelectorAll('button')).find(
      (b) => b.textContent === 'Save note',
    )!
    saveBtn.click()
    await new Promise((r) => setTimeout(r, 5))
    const body = JSON.parse(calls[0]![1].body as string) as {
      frontmatter: { intent: string }
    }
    expect(body.frontmatter.intent).toBe('note')
  })
})

describe('Markdown toolbar', () => {
  function getTextarea(): HTMLTextAreaElement {
    const root = document.getElementById('llui-devmode-annotate-root')!
    return root.querySelector('textarea')!
  }
  function clickToolBtn(label: string): void {
    const root = document.getElementById('llui-devmode-annotate-root')!
    const btn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === label)!
    btn.click()
  }

  it('B button wraps selection in **bold**', () => {
    mountAnnotateHud({ subscribeEvents: false })
    const ta = getTextarea()
    ta.value = 'make this bold'
    ta.setSelectionRange(5, 9) // "this"
    clickToolBtn('B')
    expect(ta.value).toBe('make **this** bold')
  })

  it('I button wraps in *italic* asterisks', () => {
    mountAnnotateHud({ subscribeEvents: false })
    const ta = getTextarea()
    ta.value = 'italic this'
    ta.setSelectionRange(7, 11)
    clickToolBtn('I')
    expect(ta.value).toBe('italic *this*')
  })

  it('code button wraps in backticks', () => {
    mountAnnotateHud({ subscribeEvents: false })
    const ta = getTextarea()
    ta.value = 'call foo() please'
    ta.setSelectionRange(5, 10)
    clickToolBtn('</>')
    expect(ta.value).toBe('call `foo()` please')
  })

  it("bullet button prefixes lines with '- '", () => {
    mountAnnotateHud({ subscribeEvents: false })
    const ta = getTextarea()
    ta.value = 'one\ntwo\nthree'
    ta.setSelectionRange(0, 13)
    clickToolBtn('•')
    expect(ta.value).toBe('- one\n- two\n- three')
  })

  it("numbered button prefixes lines with '1. ', '2. '…", () => {
    mountAnnotateHud({ subscribeEvents: false })
    const ta = getTextarea()
    ta.value = 'one\ntwo'
    ta.setSelectionRange(0, 7)
    clickToolBtn('1.')
    expect(ta.value).toBe('1. one\n2. two')
  })

  it('Cmd+B keyboard shortcut bolds the selection', () => {
    mountAnnotateHud({ subscribeEvents: false })
    const ta = getTextarea()
    ta.value = 'word'
    ta.setSelectionRange(0, 4)
    dispatchKey(ta, 'b', { metaKey: true })
    expect(ta.value).toBe('**word**')
  })

  it('Cmd+I shortcut italicizes', () => {
    mountAnnotateHud({ subscribeEvents: false })
    const ta = getTextarea()
    ta.value = 'word'
    ta.setSelectionRange(0, 4)
    dispatchKey(ta, 'i', { metaKey: true })
    expect(ta.value).toBe('*word*')
  })

  it('Cmd+E shortcut wraps in backticks', () => {
    mountAnnotateHud({ subscribeEvents: false })
    const ta = getTextarea()
    ta.value = 'word'
    ta.setSelectionRange(0, 4)
    dispatchKey(ta, 'e', { metaKey: true })
    expect(ta.value).toBe('`word`')
  })

  it('inserts placeholder text when nothing is selected', () => {
    mountAnnotateHud({ subscribeEvents: false })
    const ta = getTextarea()
    ta.value = ''
    ta.setSelectionRange(0, 0)
    clickToolBtn('B')
    expect(ta.value).toBe('**text**')
  })

  it('Bold twice toggles (strips the wrap) when selection includes the markers', () => {
    mountAnnotateHud({ subscribeEvents: false })
    const ta = getTextarea()
    ta.value = '**word**'
    ta.setSelectionRange(0, 8)
    clickToolBtn('B')
    expect(ta.value).toBe('word')
  })

  it('Bold toggle works when selection is the inner text with markers flanking', () => {
    mountAnnotateHud({ subscribeEvents: false })
    const ta = getTextarea()
    ta.value = '**word**'
    ta.setSelectionRange(2, 6) // just "word"
    clickToolBtn('B')
    expect(ta.value).toBe('word')
  })

  it('Italic toggle round-trips: wrap, then unwrap from the inner selection', () => {
    mountAnnotateHud({ subscribeEvents: false })
    const ta = getTextarea()
    ta.value = 'word'
    ta.setSelectionRange(0, 4)
    clickToolBtn('I')
    expect(ta.value).toBe('*word*')
    expect(ta.selectionStart).toBe(1)
    expect(ta.selectionEnd).toBe(5)
    clickToolBtn('I')
    expect(ta.value).toBe('word')
  })

  it('Code toggle strips backticks on second press', () => {
    mountAnnotateHud({ subscribeEvents: false })
    const ta = getTextarea()
    ta.value = '`foo()`'
    ta.setSelectionRange(0, 7)
    clickToolBtn('</>')
    expect(ta.value).toBe('foo()')
  })

  it('Bullet toggle: prefix once, strip on second press', () => {
    mountAnnotateHud({ subscribeEvents: false })
    const ta = getTextarea()
    ta.value = 'one\ntwo'
    ta.setSelectionRange(0, 7)
    clickToolBtn('•')
    expect(ta.value).toBe('- one\n- two')
    ta.setSelectionRange(0, ta.value.length)
    clickToolBtn('•')
    expect(ta.value).toBe('one\ntwo')
  })

  it('Numbered toggle: strip on second press', () => {
    mountAnnotateHud({ subscribeEvents: false })
    const ta = getTextarea()
    ta.value = 'one\ntwo'
    ta.setSelectionRange(0, 7)
    clickToolBtn('1.')
    expect(ta.value).toBe('1. one\n2. two')
    ta.setSelectionRange(0, ta.value.length)
    clickToolBtn('1.')
    expect(ta.value).toBe('one\ntwo')
  })
})
