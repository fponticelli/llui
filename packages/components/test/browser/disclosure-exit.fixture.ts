import { button, component, div, mountApp, text, type Mountable } from '@llui/dom'
import * as accordion from '../../src/components/accordion.js'
import * as collapsible from '../../src/components/collapsible.js'

declare global {
  interface Window {
    __disclosureReady: boolean
    __collapsibleSend?: (msg: collapsible.CollapsibleMsg) => void
    __sibASend?: (msg: accordion.AccordionMsg) => void
    __sibBSend?: (msg: accordion.AccordionMsg) => void
    __sibColSend?: (msg: collapsible.CollapsibleMsg) => void
    __noPartSend?: (msg: accordion.AccordionMsg) => void
  }
}

window.__disclosureReady = false

function mountAccordion(hostId: string): void {
  const host = document.getElementById(hostId)
  if (host === null) return
  mountApp(
    host,
    component<accordion.AccordionState, accordion.AccordionMsg>({
      name: `Accordion:${hostId}`,
      init: () => [accordion.init({ items: ['x', 'y'], animated: true }), []],
      update: (state, msg) => accordion.update(state, msg),
      view: ({ state, send }): readonly Mountable[] => {
        const parts = accordion.connect(state, send, { id: hostId })
        const items = ['x', 'y'].map((value) => {
          const item = parts.item(value)
          return div({ ...item.item }, [
            button({ ...item.trigger }, [text(`Trigger ${value}`)]),
            div({ ...item.content }, [text(`Content ${value}`)]),
          ])
        })
        return [div({ ...parts.root }, items), parts.exitCompletion]
      },
    }),
  )
}

function mountCollapsible(hostId: string, container: Element): void {
  mountApp(
    container,
    component<collapsible.CollapsibleState, collapsible.CollapsibleMsg>({
      name: `Collapsible:${hostId}`,
      init: () => [collapsible.init({ open: true, animated: true }), []],
      update: (state, msg) => collapsible.update(state, msg),
      view: ({ state, send }): readonly Mountable[] => {
        const parts = collapsible.connect(state, send, { id: hostId })
        if (hostId === 'host-collapsible') window.__collapsibleSend = send
        return [
          button({ ...parts.trigger }, [text('Trigger')]),
          div({ ...parts.content }, [text('Content')]),
          parts.exitCompletion,
        ]
      },
    }),
  )
}

for (const id of ['host-none', 'host-anim', 'host-transition', 'host-reduced']) {
  mountAccordion(id)
}

mountCollapsible('host-collapsible', document.getElementById('host-collapsible')!)

const shadowHost = document.getElementById('host-shadow')!
const shadowRoot = shadowHost.attachShadow({ mode: 'open' })
const shadowContainer = document.createElement('div')
shadowRoot.append(shadowContainer)
mountCollapsible('host-shadow', shadowContainer)

/**
 * Two DIFFERENT component kinds (an accordion and a collapsible), each its
 * own item value 'x', mounted as SIBLINGS inside ONE parent component's
 * view — i.e. sharing the ONE onMount build container `onMount` hands every
 * callback placed in it (#264 review item 1). Each instance's own
 * `exitCompletion` must resolve its OWN content element by its own
 * `opts.id`-scoped id, never a shared `[data-scope][data-part]` query that
 * would find the SIBLING's element too. Distinct animation durations (A
 * fast, B slow) mean a cross-contaminated watcher settles the slow one
 * early, right after the fast one's own animation ends.
 */
interface SiblingsState {
  a: accordion.AccordionState
  b: accordion.AccordionState
}
type SiblingsMsg =
  | { type: 'a'; msg: accordion.AccordionMsg }
  | { type: 'b'; msg: accordion.AccordionMsg }

function mountSiblingAccordions(hostId: string): void {
  const host = document.getElementById(hostId)
  if (host === null) return
  mountApp(
    host,
    component<SiblingsState, SiblingsMsg>({
      name: 'SiblingAccordions',
      init: () => [
        {
          a: accordion.init({ items: ['x'], value: ['x'], animated: true }),
          b: accordion.init({ items: ['x'], value: ['x'], animated: true }),
        },
        [],
      ],
      update: (state, msg) =>
        msg.type === 'a'
          ? [{ ...state, a: accordion.update(state.a, msg.msg)[0] }, []]
          : [{ ...state, b: accordion.update(state.b, msg.msg)[0] }, []],
      view: ({ state, send }): readonly Mountable[] => {
        const sendA = (msg: accordion.AccordionMsg): void => send({ type: 'a', msg })
        const sendB = (msg: accordion.AccordionMsg): void => send({ type: 'b', msg })
        window.__sibASend = sendA
        window.__sibBSend = sendB
        const a = accordion.connect(state.at('a'), sendA, { id: 'sib-a' })
        const b = accordion.connect(state.at('b'), sendB, { id: 'sib-b' })
        const itemA = a.item('x')
        const itemB = b.item('x')
        return [
          div({ ...a.root, id: 'sib-a-root' }, [
            div({ ...itemA.item }, [
              button({ ...itemA.trigger }, [text('A trigger')]),
              div({ ...itemA.content }, [text('A content')]),
            ]),
          ]),
          div({ ...b.root, id: 'sib-b-root' }, [
            div({ ...itemB.item }, [
              button({ ...itemB.trigger }, [text('B trigger')]),
              div({ ...itemB.content }, [text('B content')]),
            ]),
          ]),
          a.exitCompletion,
          b.exitCompletion,
        ]
      },
    }),
  )
}

mountSiblingAccordions('host-siblings')

/**
 * An accordion mounted WITHOUT placing `parts.exitCompletion` in the view —
 * the "opt-in wired nowhere" half of #264 review item 1. A programmatic
 * close on a no-motion skin never settles (nothing resolves the content
 * element), and the connect()-time dev watchdog must warn regardless of
 * this omission.
 */
function mountAccordionWithoutExitCompletion(hostId: string): void {
  const host = document.getElementById(hostId)
  if (host === null) return
  mountApp(
    host,
    component<accordion.AccordionState, accordion.AccordionMsg>({
      name: `Accordion:${hostId}`,
      init: () => [accordion.init({ items: ['x'], value: ['x'], animated: true }), []],
      update: (state, msg) => accordion.update(state, msg),
      view: ({ state, send }): readonly Mountable[] => {
        window.__noPartSend = send
        const parts = accordion.connect(state, send, { id: hostId })
        const item = parts.item('x')
        return [
          div({ ...parts.root }, [
            div({ ...item.item }, [
              button({ ...item.trigger }, [text('Trigger x')]),
              div({ ...item.content }, [text('Content x')]),
            ]),
          ]),
          // Deliberately NOT placing `parts.exitCompletion`.
        ]
      },
    }),
  )
}

mountAccordionWithoutExitCompletion('host-no-part')

window.__disclosureReady = true
