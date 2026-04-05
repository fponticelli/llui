import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mountApp, button, text } from '@llui/dom'
import type { ComponentDef } from '@llui/dom'
import { init, update, view, openWith } from '../../src/patterns/confirm-dialog'
import type { ConfirmDialogState, ConfirmDialogMsg } from '../../src/patterns/confirm-dialog'

type Ctx = { cd: ConfirmDialogState; lastAction: string | null }

describe('confirmDialog reducer', () => {
  it('initializes with defaults', () => {
    const s = init()
    expect(s.open).toBe(false)
    expect(s.tag).toBe('')
    expect(s.confirmLabel).toBe('Confirm')
    expect(s.cancelLabel).toBe('Cancel')
  })

  it('openWith sets content + opens', () => {
    const [s] = update(init(), {
      type: 'openWith',
      tag: 'delete-user',
      title: 'Delete user?',
      description: 'This cannot be undone.',
      destructive: true,
    })
    expect(s.open).toBe(true)
    expect(s.tag).toBe('delete-user')
    expect(s.title).toBe('Delete user?')
    expect(s.description).toBe('This cannot be undone.')
    expect(s.destructive).toBe(true)
  })

  it('openWith inherits default labels unless overridden', () => {
    const [s] = update(init(), { type: 'openWith', tag: 't', title: 'Hi' })
    expect(s.confirmLabel).toBe('Confirm')
    const [s2] = update(init(), {
      type: 'openWith',
      tag: 't',
      title: 'Hi',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
    })
    expect(s2.confirmLabel).toBe('Delete')
    expect(s2.cancelLabel).toBe('Keep')
  })

  it('confirm closes dialog but preserves tag', () => {
    const s0 = { ...init(), open: true, tag: 'abc', title: 'X' }
    const [s] = update(s0, { type: 'confirm' })
    expect(s.open).toBe(false)
    expect(s.tag).toBe('abc') // consumer can read tag after confirm
  })

  it('cancel closes', () => {
    const s0 = { ...init(), open: true }
    const [s] = update(s0, { type: 'cancel' })
    expect(s.open).toBe(false)
  })

  it('setOpen for external control', () => {
    const [s] = update(init(), { type: 'setOpen', open: true })
    expect(s.open).toBe(true)
  })
})

describe('openWith helper', () => {
  it('builds proper message', () => {
    const msg = openWith('del', {
      title: 'Delete?',
      destructive: true,
    })
    expect(msg).toEqual({
      type: 'openWith',
      tag: 'del',
      title: 'Delete?',
      description: undefined,
      confirmLabel: undefined,
      cancelLabel: undefined,
      destructive: true,
    })
  })
})

describe('confirmDialog integration', () => {
  let currentApp: ReturnType<typeof mountApp> | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    if (currentApp) {
      currentApp.dispose()
      currentApp = null
    }
    document.body.innerHTML = ''
    document.body.style.overflow = ''
  })

  type AppMsg = { type: 'cd'; msg: ConfirmDialogMsg } | { type: 'triggerConfirm' }

  function makeApp(): {
    send: (m: AppMsg) => void
    getState: () => Ctx
  } {
    let sendRef!: (m: AppMsg) => void
    let stateRef!: Ctx

    const def: ComponentDef<Ctx, AppMsg, never> = {
      name: 'Test',
      init: () => [{ cd: init(), lastAction: null }, []],
      update: (state, msg) => {
        if (msg.type === 'triggerConfirm') {
          const [cd] = update(
            state.cd,
            openWith('delete-user', {
              title: 'Delete?',
              description: 'Are you sure?',
              destructive: true,
            }),
          )
          return [{ ...state, cd }, []]
        }
        if (msg.type === 'cd') {
          const [cd] = update(state.cd, msg.msg)
          // On confirm, record the action using the tag
          if (msg.msg.type === 'confirm') {
            return [{ ...state, cd, lastAction: `confirmed:${state.cd.tag}` }, []]
          }
          if (msg.msg.type === 'cancel') {
            return [{ ...state, cd, lastAction: 'cancelled' }, []]
          }
          return [{ ...state, cd }, []]
        }
        return [state, []]
      },
      view: (send) => {
        sendRef = send
        return [
          button({ type: 'button', onClick: () => send({ type: 'triggerConfirm' }) }, [text('Delete')]),
          ...view<Ctx>({
            get: (s) => s.cd,
            send: (m) => send({ type: 'cd', msg: m }),
            id: 'confirm',
          }),
        ]
      },
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    currentApp = mountApp(container, def)
    // Track state by hooking into update via a custom path
    const getState = (): Ctx => stateRef
    // We can't easily extract state; just return what we send in
    void getState
    return { send: sendRef!, getState }
  }

  it('dialog not rendered initially', () => {
    makeApp()
    expect(document.querySelector('[data-part="content"]')).toBeNull()
  })

  it('openWith opens dialog with title + description', async () => {
    const { send } = makeApp()
    send({ type: 'triggerConfirm' })
    await new Promise((r) => setTimeout(r, 0))
    const content = document.querySelector('[data-part="content"]') as HTMLElement
    expect(content).not.toBeNull()
    expect(content.getAttribute('role')).toBe('alertdialog')
    expect(content.textContent).toContain('Delete?')
    expect(content.textContent).toContain('Are you sure?')
  })

  it('confirm button closes dialog', async () => {
    const { send } = makeApp()
    send({ type: 'triggerConfirm' })
    await new Promise((r) => setTimeout(r, 0))
    const confirmBtn = document.querySelector(
      '.confirm-dialog__actions button:last-child',
    ) as HTMLButtonElement
    expect(confirmBtn).not.toBeNull()
    confirmBtn.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(document.querySelector('[data-part="content"]')).toBeNull()
  })

  it('cancel button closes dialog', async () => {
    const { send } = makeApp()
    send({ type: 'triggerConfirm' })
    await new Promise((r) => setTimeout(r, 0))
    const cancelBtn = document.querySelector(
      '.confirm-dialog__actions button:first-child',
    ) as HTMLButtonElement
    cancelBtn.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(document.querySelector('[data-part="content"]')).toBeNull()
  })

  it('Escape closes via cancel path (no outside-click by default)', async () => {
    const { send } = makeApp()
    send({ type: 'triggerConfirm' })
    await new Promise((r) => setTimeout(r, 0))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(document.querySelector('[data-part="content"]')).toBeNull()
  })

  it('outside click does NOT close (alertdialog semantics)', async () => {
    const { send } = makeApp()
    send({ type: 'triggerConfirm' })
    await new Promise((r) => setTimeout(r, 0))
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(document.querySelector('[data-part="content"]')).not.toBeNull()
  })

  it('destructive flag wires onto confirm button class', async () => {
    const { send } = makeApp()
    send({ type: 'triggerConfirm' })
    await new Promise((r) => setTimeout(r, 0))
    const confirmBtn = document.querySelector(
      '.confirm-dialog__actions button:last-child',
    ) as HTMLButtonElement
    // triggerConfirm dispatches openWith with destructive: true
    expect(confirmBtn.className).toContain('btn-danger')
  })

  it('tag is preserved through confirm so consumer can branch', async () => {
    // This verifies the composition contract: on confirm, state.tag tells us
    // what was being confirmed. Built into the update above; we verify the
    // reducer preserves tag in isolation here.
    const s0 = { ...init(), open: true, tag: 'my-action' }
    const [s1] = update(s0, { type: 'confirm' })
    expect(s1.tag).toBe('my-action')
    expect(s1.open).toBe(false)
  })
})

// Silence unused type var in test file
export type { Ctx }
