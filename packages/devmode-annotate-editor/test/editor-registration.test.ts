/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mountAnnotateHud, type AnnotateHudHandle } from '@llui/devmode-annotate'
import '../src/index.js'

describe('@llui/devmode-annotate-editor registration', () => {
  let handle: AnnotateHudHandle | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    handle?.destroy()
    handle = null
    document.body.innerHTML = ''
  })

  it('upgrades the note surface to the existing rich Markdown editor', () => {
    handle = mountAnnotateHud({ subscribeEvents: false })
    const root = document.getElementById('llui-devmode-annotate-root')!

    expect(root.querySelector('[data-llui-editor] [data-lexical-editor]')).not.toBeNull()
    expect(root.querySelector('textarea')).toBeNull()
    expect(root.textContent).toContain('Rich editor · select text to format')
  })

  it('accepts programmatic Markdown through the HUD handle', async () => {
    handle = mountAnnotateHud({ subscribeEvents: false })
    handle.setProse('# Registered editor')
    await new Promise((resolve) => setTimeout(resolve, 0))

    const root = document.getElementById('llui-devmode-annotate-root')!
    expect(root.querySelector('[data-llui-editor] h1')?.textContent).toBe('Registered editor')
  })
})
