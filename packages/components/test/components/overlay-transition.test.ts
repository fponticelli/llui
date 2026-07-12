import { describe, it, expect, afterEach, vi } from 'vitest'
import { component, mountApp, div, button, h2, text } from '@llui/dom'
import type { TransitionOptions } from '@llui/dom'
import { init, update, connect, overlay } from '../../src/components/dialog'
import type { DialogState, DialogMsg } from '../../src/components/dialog'

// The structural-transition seam wired through `createOverlay`: an `overlay()`
// given a `transition` threads it onto the mountWhen `show` INSIDE the portal, so
// `enter` fires on the real content and `leave` defers the unmount of the real
// content until its promise resolves. With no transition the overlay closes
// synchronously (byte-identical to before). These use fake spies — no real CSS.

type Ctx = { dlg: DialogState }

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const content = (): HTMLElement | null =>
  document.querySelector('[data-part="content"]') as HTMLElement | null

/** A controllable `leave`: records the nodes it is handed and returns a pending
 * promise per call; `resolveAll()` settles every outstanding promise. */
function makeLeave() {
  const resolvers: Array<() => void> = []
  const calls: Node[][] = []
  const leave = (nodes: Node[]): Promise<void> => {
    calls.push(nodes)
    return new Promise<void>((r) => resolvers.push(r))
  }
  return { leave, calls, resolveAll: () => resolvers.splice(0).forEach((r) => r()) }
}

let currentApp: ReturnType<typeof mountApp> | null = null

afterEach(() => {
  if (currentApp) {
    currentApp.dispose()
    currentApp = null
  }
  document.body.innerHTML = ''
})

function makeApp(
  transition: TransitionOptions | undefined,
  initialOpen = false,
): { send: (m: DialogMsg) => void } {
  let sendRef!: (m: DialogMsg) => void
  const def = component<Ctx, DialogMsg, never>({
    name: 'TestTransition',
    init: () => [{ dlg: init({ open: initialOpen }) }, []],
    update: (state, msg) => {
      const [next] = update(state.dlg, msg)
      return [{ dlg: next }, []]
    },
    view: ({ state, send }) => {
      sendRef = send
      const parts = connect(state.at('dlg'), send, { id: 'tx' })
      return [
        button({ ...parts.trigger }, [text('Open')]),
        overlay({
          state: state.at('dlg'),
          send,
          parts,
          transition,
          content: () => [div({ ...parts.content }, [h2({ ...parts.title }, [text('Title')])])],
        }),
      ]
    },
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  currentApp = mountApp(container, def)
  return { send: (m) => sendRef!(m) }
}

describe('overlay — transition seam', () => {
  it('enter fires on open with the real content in the DOM', async () => {
    const enter = vi.fn()
    const { send } = makeApp({ enter })
    expect(enter).toHaveBeenCalledTimes(0)
    send({ type: 'open' })
    await flush()
    expect(content()).not.toBeNull()
    expect(enter).toHaveBeenCalledTimes(1)
    // The nodes handed to enter contain the real portaled content wrapper.
    const nodes = enter.mock.calls[0]![0] as Node[]
    expect(nodes.some((n) => n instanceof HTMLElement && n.contains(content()))).toBe(true)
  })

  it('leave defers the close until its promise resolves', async () => {
    const { leave, calls, resolveAll } = makeLeave()
    const { send } = makeApp({ leave }, true)
    await flush()
    const el = content()
    expect(el).not.toBeNull()

    send({ type: 'close' }) // skipAnimations default → status 'closed' → mountWhen false
    expect(calls.length).toBe(1)
    expect(content()).toBe(el) // STILL in the DOM — detach deferred on the leave promise
    // The leaving footprint includes the real content element.
    expect(calls[0]!.some((n) => n instanceof HTMLElement && n.contains(el))).toBe(true)

    resolveAll()
    await flush()
    expect(content()).toBeNull() // now removed
  })

  it('reopening before the leave resolves supersedes cleanly (one content, no leak)', async () => {
    const { leave, resolveAll } = makeLeave()
    const { send } = makeApp({ leave }, true)
    await flush()
    const first = content()!

    send({ type: 'close' }) // first starts leaving (pending)
    expect(content()).toBe(first)
    send({ type: 'open' }) // reopen before leave resolves — supersede
    await flush()
    expect(document.querySelectorAll('[data-part="content"]').length).toBe(1)

    resolveAll() // stale leave resolves — must be a no-op
    await flush()
    expect(document.querySelectorAll('[data-part="content"]').length).toBe(1)
  })

  it('no-transition path closes synchronously (unchanged)', async () => {
    const { send } = makeApp(undefined, true)
    await flush()
    expect(content()).not.toBeNull()
    send({ type: 'close' })
    expect(content()).toBeNull() // removed immediately — no deferral
  })

  it('dispose finalizes an in-flight leave (no overlay left mounted past unmount)', async () => {
    const { leave } = makeLeave()
    const { send } = makeApp({ leave }, true)
    await flush()
    const el = content()!
    send({ type: 'close' }) // leaving (pending)
    expect(content()).toBe(el)
    currentApp!.dispose()
    currentApp = null
    expect(content()).toBeNull() // detached on dispose despite the unresolved leave
  })
})
