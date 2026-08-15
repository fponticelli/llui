import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp } from '@llui/dom'
import { isInNestedLayer, getNestedLayers } from '@llui/components/utils'
import { markdownEditor } from '../src/editor.js'
import { corePlugin } from '../src/plugins/core.js'
import { contextMenuPlugin } from '../src/plugins/context-menu.js'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

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

// Regression: a markdown-editor overlay (overlayRoot) opened inside a
// dialog.overlay() must register its portal root as a nested layer, so the
// dialog's outside-click / aria-hidden / focus-trap utilities treat it as
// inside instead of dismissing/inerting it. See @llui/components
// registerNestedLayer + plugins/overlay.ts.
describe('overlayRoot registers a nested layer while open', () => {
  it('registers the live portal root only while open, cleans up on dispose', async () => {
    app = mountApp(
      container,
      markdownEditor({
        plugins: [corePlugin(), contextMenuPlugin()],
        defaultValue: 'x',
      }),
    )
    await wait(0)

    // Closed: the resolver is registered but surfaces no element.
    expect(getNestedLayers()).toEqual([])

    app.send({
      type: 'plugin',
      name: 'contextMenu',
      msg: {
        type: 'open',
        x: 30,
        y: 40,
        items: [{ id: 'undo', label: 'Undo' }],
      },
    })
    await wait(0)

    const root = document.querySelector(
      '[data-scope="md-context"][data-part="root"]',
    ) as HTMLElement
    expect(root).not.toBeNull()

    // Open: the portal root (and its descendants) count as a nested layer.
    expect(getNestedLayers()).toContain(root)
    expect(isInNestedLayer(root)).toBe(true)
    const option = document.querySelector('[data-scope="md-context"][data-part="option"]')
    expect(isInNestedLayer(option)).toBe(true)

    // A node truly outside is not a nested layer.
    expect(isInNestedLayer(document.body)).toBe(false)

    app.dispose()
    app = null
    // Disposing the editor unregisters the resolver entirely.
    expect(getNestedLayers()).toEqual([])
  })

  // #171 — the registration also has to name its OWNER, and only a SCOPED
  // lookup can see whether it did. Every assertion above passes an unscoped
  // lookup, which falls back to the flat answer, so it is satisfied by a
  // registration with no owner at all AND by one naming the wrong element.
  // Both halves below are needed; each kills a different mutation of
  // `plugins/overlay.ts`'s `{ owner: root }`:
  //
  //   `{}`                                 → unowned, so the flat fallback
  //                                          includes it for EVERY asker
  //                                          (caught by the "unrelated" half)
  //   `{ owner: () => …ownerDocument.body }` → an owner outside the editor, so
  //                                          the editor's own boundary no
  //                                          longer contains it (caught by the
  //                                          "editor's own container" half)
  it('names an OWNER, so a scoped lookup attributes it to the editor and to nothing else', async () => {
    const unrelated = document.createElement('div')
    document.body.appendChild(unrelated)

    app = mountApp(
      container,
      markdownEditor({
        plugins: [corePlugin(), contextMenuPlugin()],
        defaultValue: 'x',
      }),
    )
    await wait(0)

    app.send({
      type: 'plugin',
      name: 'contextMenu',
      msg: { type: 'open', x: 30, y: 40, items: [{ id: 'undo', label: 'Undo' }] },
    })
    await wait(0)

    const root = document.querySelector(
      '[data-scope="md-context"][data-part="root"]',
    ) as HTMLElement
    expect(root).not.toBeNull()
    // Non-vacuous: the portal really is a body-level SIBLING of the editor, so
    // containment of the PORTAL says nothing — only the owner can attribute it.
    expect(container.contains(root)).toBe(false)

    // A layer the editor owns: a lookup scoped to the editor's own subtree
    // (what a host `dialog.overlay()` containing this editor would ask with)
    // sees it.
    expect(getNestedLayers(undefined, container)).toContain(root)

    // …and a lookup scoped to an unrelated body-level layer does NOT. This is
    // the half that would fail #171: an unowned registration is exempt from
    // every asking layer on the page, including a modal that has nothing to do
    // with the editor.
    expect(getNestedLayers(undefined, unrelated)).not.toContain(root)
    expect(getNestedLayers(undefined, unrelated)).toEqual([])
  })
})
