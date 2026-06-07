// Integration contract for the markdown editor's `collab` seam. The real CRDT
// convergence/undo/presence behaviour is owned and tested by `@llui/lexical-collab`;
// here we verify the editor wiring: it enables the collab state slice, hands the
// factory a markdown `seed` (bound to `defaultValue` + the editor's transformers),
// routes the status hooks into `state.collab`, and rejects `collab` + `value`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { component, mountApp, text, type Signal } from '@llui/dom'
import { $getRoot, type LexicalEditor } from 'lexical'
import { markdownEditor, type CollabFactory, type CollabHooks } from '../src/editor.js'
import type { CollabStatus } from '../src/state.js'

let container: HTMLElement
let app: ReturnType<typeof mountApp> | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  app?.dispose()
  app = null
  document.body.innerHTML = ''
})

/** A fake collab binding that captures the editor-injected hooks and, on
 * register, performs a bootstrap seed exactly like the real binding does on its
 * first provider sync (seed only when the document is still empty). */
function captureCollab(): {
  factory: CollabFactory
  hooks: () => CollabHooks
  disposed: () => boolean
} {
  let hooks: CollabHooks | undefined
  let disposed = false
  const factory: CollabFactory = (h) => {
    hooks = h
    return {
      register: (editor: LexicalEditor) => {
        editor.update(
          () => {
            if ($getRoot().isEmpty()) h.seed(editor)
          },
          { discrete: true },
        )
        return () => {
          disposed = true
        }
      },
    }
  }
  return {
    factory,
    hooks: () => {
      if (!hooks) throw new Error('collab factory not invoked yet')
      return hooks
    },
    disposed: () => disposed,
  }
}

const collabState = (): CollabStatus => (app!.getState() as { collab: CollabStatus }).collab

describe('markdownEditor — collab seam', () => {
  it('marks the collab state slice enabled', () => {
    const c = captureCollab()
    app = mountApp(container, markdownEditor({ collab: c.factory }))
    expect(collabState().enabled).toBe(true)
  })

  it('is inert (enabled: false) without a collab factory', () => {
    app = mountApp(container, markdownEditor({ defaultValue: 'plain' }))
    expect(collabState().enabled).toBe(false)
  })

  it('hands the factory a markdown seed bound to defaultValue + transformers', () => {
    const c = captureCollab()
    app = mountApp(container, markdownEditor({ collab: c.factory, defaultValue: '# Bootstrapped' }))
    // The bootstrap seed converted the markdown into the live document.
    expect(container.querySelector('h1')?.textContent).toBe('Bootstrapped')
  })

  it('routes provider status hooks into state.collab', () => {
    const c = captureCollab()
    app = mountApp(container, markdownEditor({ collab: c.factory }))
    expect(collabState()).toMatchObject({ connected: false, synced: false, peers: 0 })

    c.hooks().onStatus(true)
    c.hooks().onSync(true)
    c.hooks().onPeers(3)
    expect(collabState()).toMatchObject({ connected: true, synced: true, peers: 3 })

    c.hooks().onStatus(false)
    c.hooks().onPeers(0)
    expect(collabState()).toMatchObject({ connected: false, synced: true, peers: 0 })
  })

  it('disposes the binding when the editor unmounts', () => {
    const c = captureCollab()
    app = mountApp(container, markdownEditor({ collab: c.factory }))
    expect(c.disposed()).toBe(false)
    app.dispose()
    app = null
    expect(c.disposed()).toBe(true)
  })

  it('rejects collab + value (the CRDT owns the content, not a signal)', () => {
    const c = captureCollab()
    // Obtain a real value Signal from a mounted probe component.
    let valueSig: Signal<string> | undefined
    const probe = component<{ v: string }, { type: 'noop' }>({
      name: 'Probe',
      init: () => ({ v: '' }),
      update: (s) => s,
      view: ({ state }) => {
        valueSig = state.at('v')
        return [text('')]
      },
    })
    const probeApp = mountApp(container, probe)
    expect(() => markdownEditor({ collab: c.factory, value: valueSig! })).toThrow(
      /mutually exclusive/,
    )
    probeApp.dispose()
  })
})
