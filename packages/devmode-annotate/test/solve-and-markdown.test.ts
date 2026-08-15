/// <reference lib="dom" />
// Tests for the standalone textarea plus the Save / Solve action buttons.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mountAnnotateHud } from '../src/index.js'

const HUD_STATE_KEY = 'llui-devmode-annotate.hud-state'

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

/** Seed the compose draft via the persisted-state restore path so the embedded
 * editor mounts with prose already in it. */
function seedProse(text: string): void {
  localStorage.setItem(HUD_STATE_KEY, JSON.stringify({ draftProse: text }))
}

beforeEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
})

afterEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
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

  it('mounts a textarea that submits the text typed into it', async () => {
    const calls = mockFetch()
    mountAnnotateHud({ subscribeEvents: false })
    const root = document.getElementById('llui-devmode-annotate-root')!
    expect(root.querySelector('[data-llui-editor]')).not.toBeNull()
    expect(root.querySelector('[data-llui-editor] [data-lexical-editor]')).toBeNull()

    const textarea = root.querySelector('textarea')!
    textarea.value = 'typed in the standalone HUD'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    const saveBtn = Array.from(root.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save note',
    )!
    saveBtn.click()
    await new Promise((resolve) => setTimeout(resolve, 5))

    const body = JSON.parse(calls[0]![1].body as string) as { body: string }
    expect(body.body).toBe('typed in the standalone HUD')
  })

  it("Solve submits with intent='task'", async () => {
    const calls = mockFetch()
    seedProse('fix it')
    mountAnnotateHud({ subscribeEvents: false })
    const root = document.getElementById('llui-devmode-annotate-root')!
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
    seedProse('just fyi')
    mountAnnotateHud({ subscribeEvents: false })
    const root = document.getElementById('llui-devmode-annotate-root')!
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
