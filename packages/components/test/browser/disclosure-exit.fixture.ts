import { button, component, div, mountApp, onMount, text, type Mountable } from '@llui/dom'
import * as accordion from '../../src/components/accordion.js'
import * as collapsible from '../../src/components/collapsible.js'

declare global {
  interface Window {
    __disclosureReady: boolean
    __collapsibleSend?: (msg: collapsible.CollapsibleMsg) => void
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
        return [
          div({ ...parts.root }, items),
          onMount((root) => accordion.watchExitCompletion(root, state, send)),
        ]
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
          onMount((root) => collapsible.watchExitCompletion(root, state, send)),
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

window.__disclosureReady = true
