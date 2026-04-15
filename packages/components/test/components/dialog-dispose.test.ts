import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp, div, button, h2, text } from '@llui/dom'
import type { ComponentDef } from '@llui/dom'
import { init, update, connect, overlay } from '../../src/components/dialog'
import type { DialogState, DialogMsg } from '../../src/components/dialog'
import { _focusTrapStackSize } from '../../src/utils/focus-trap'
import { _scrollLockCount } from '../../src/utils/remove-scroll'

// Regression test for the "nav-while-dialog-open" leak concern.
//
// Scenario: a page mounts a component whose view contains an open dialog
// with a body portal. The user clicks a nav link — @llui/vike calls
// AppHandle.dispose() before clearing and mounting the next page. We
// assert that after dispose() returns, document.body has zero leftover
// portal nodes, the focus-trap stack is empty, body scroll-lock count
// is zero, and the sibling aria-hidden attributes are restored.
//
// If any of these leak, a new page mounts into a document whose focus
// trap is still holding the previous trigger, body is still scroll-locked,
// and the sibling <aside> still has aria-hidden="true". Users see
// broken focus and frozen scroll after navigation.

type Ctx = { dlg: DialogState }

function pageDef(initialOpen: boolean): ComponentDef<Ctx, DialogMsg, never> {
  const parts = connect<Ctx>(
    (s) => s.dlg,
    () => {},
    { id: 'page-dialog' },
  )
  return {
    name: 'Page',
    init: () => [{ dlg: init({ open: initialOpen }) }, []],
    update: (state, msg) => {
      const [next] = update(state.dlg, msg)
      return [{ dlg: next }, []]
    },
    view: ({ send }) => [
      button({ ...parts.trigger }, [text('Open')]),
      ...overlay<Ctx>({
        get: (s) => s.dlg,
        send,
        parts,
        content: () => [
          div({ ...parts.content }, [
            h2({ ...parts.title }, [text('Dialog Title')]),
            button({ ...parts.closeTrigger }, [text('Close')]),
          ]),
        ],
      }),
    ],
  }
}

describe('dialog.overlay — dispose while open', () => {
  let container: HTMLElement | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
    // Give body a sibling so aria-hidden has a target to claim
    const aside = document.createElement('aside')
    aside.id = 'page-sibling'
    aside.textContent = 'side content'
    document.body.appendChild(aside)
    container = document.createElement('div')
    container.id = 'app'
    document.body.appendChild(container)
  })

  afterEach(() => {
    document.body.innerHTML = ''
    document.body.style.overflow = ''
    document.body.style.paddingRight = ''
  })

  it('cleans document.body when app is disposed with dialog open', async () => {
    const app = mountApp(container!, pageDef(true))
    // Wait for the onMount callbacks (portal, focus trap, aria-hidden,
    // scroll lock) to fire. mountApp flushes them synchronously now but
    // this also covers the queueMicrotask fallback path.
    await Promise.resolve()

    // Pre-dispose state: everything should be in place
    const content = document.querySelector('[data-part="content"]')
    expect(content).not.toBeNull()
    expect(_focusTrapStackSize()).toBe(1)
    expect(_scrollLockCount()).toBe(1)
    expect(document.body.style.overflow).toBe('hidden')
    const sibling = document.getElementById('page-sibling')!
    expect(sibling.getAttribute('aria-hidden')).toBe('true')
    expect(sibling.hasAttribute('inert')).toBe(true)

    // Act: tear down the app (simulates @llui/vike client navigation)
    app.dispose()

    // Post-dispose: document.body must be clean
    expect(
      document.querySelector('[data-part="content"]'),
      'portal content node should be removed from document.body',
    ).toBeNull()
    expect(_focusTrapStackSize(), 'focus-trap stack should be empty').toBe(0)
    expect(_scrollLockCount(), 'body scroll-lock count should be zero').toBe(0)
    expect(document.body.style.overflow, 'body overflow should be restored').toBe('')
    expect(sibling.getAttribute('aria-hidden'), 'sibling aria-hidden should be restored').toBeNull()
    expect(sibling.hasAttribute('inert'), 'sibling inert should be cleared').toBe(false)

    // And the app container itself should no longer reference the dialog
    // (this is a side-check — mountApp doesn't clear on dispose, that's
    // the host's job, so we don't assert container.innerHTML === '')
  })

  it('cleans document.body when app is disposed after opening dialog post-mount', async () => {
    let sendRef!: (m: DialogMsg) => void
    const def: ComponentDef<Ctx, DialogMsg, never> = {
      ...pageDef(false),
      view: (h) => {
        sendRef = h.send
        return pageDef(false).view(h)
      },
    }
    const app = mountApp(container!, def)
    // Dialog starts closed
    expect(document.querySelector('[data-part="content"]')).toBeNull()
    expect(_focusTrapStackSize()).toBe(0)

    // Open the dialog
    sendRef!({ type: 'open' })
    app.flush()
    await Promise.resolve()

    expect(document.querySelector('[data-part="content"]')).not.toBeNull()
    expect(_focusTrapStackSize()).toBe(1)

    // Dispose while open
    app.dispose()

    expect(document.querySelector('[data-part="content"]')).toBeNull()
    expect(_focusTrapStackSize()).toBe(0)
    expect(_scrollLockCount()).toBe(0)
    const sibling = document.getElementById('page-sibling')!
    expect(sibling.getAttribute('aria-hidden')).toBeNull()
  })

  it('dispose is idempotent — calling twice does not over-pop stacks', async () => {
    const app = mountApp(container!, pageDef(true))
    await Promise.resolve()

    expect(_focusTrapStackSize()).toBe(1)
    app.dispose()
    expect(_focusTrapStackSize()).toBe(0)
    // A defensive second call should not underflow or throw
    expect(() => app.dispose()).not.toThrow()
    expect(_focusTrapStackSize()).toBe(0)
    expect(_scrollLockCount()).toBe(0)
  })
})
