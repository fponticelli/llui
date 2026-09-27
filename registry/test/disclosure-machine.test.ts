import { afterEach, describe, expect, it } from 'vitest'
import { component, mountApp, text, type Mountable } from '@llui/dom'
import * as accordion from '@llui/components/accordion'
import * as collapsible from '@llui/components/collapsible'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../llui/ui/accordion'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../llui/ui/collapsible'

interface State {
  accordion: accordion.AccordionState
  collapsible: collapsible.CollapsibleState
}
type Msg =
  | { type: 'accordion'; msg: accordion.AccordionMsg }
  | { type: 'collapsible'; msg: collapsible.CollapsibleMsg }

let app: ReturnType<typeof mountApp> | null = null

afterEach(() => {
  app?.dispose()
  app = null
  document.body.replaceChildren()
})

function mount(): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  app = mountApp(
    host,
    component<State, Msg>({
      name: 'RegistryDisclosurePresence',
      init: () => [
        {
          accordion: accordion.init({
            items: ['details'],
            value: ['details'],
            animated: true,
          }),
          collapsible: collapsible.init({ open: true, animated: true }),
        },
        [],
      ],
      update: (state, msg) =>
        msg.type === 'accordion'
          ? [{ ...state, accordion: accordion.update(state.accordion, msg.msg)[0] }, []]
          : [{ ...state, collapsible: collapsible.update(state.collapsible, msg.msg)[0] }, []],
      view: ({ state, send }): readonly Mountable[] => {
        const acc = accordion.connect(
          state.at('accordion'),
          (msg) => send({ type: 'accordion', msg }),
          { id: 'registry-presence-accordion' },
        )
        const col = collapsible.connect(
          state.at('collapsible'),
          (msg) => send({ type: 'collapsible', msg }),
          { id: 'registry-presence-collapsible' },
        )
        const item = acc.item('details')
        return [
          Accordion(
            { ...acc.root },
            [
              AccordionItem({ ...item.item }, [
                AccordionTrigger({ ...item.trigger }, [text('Accordion details')]),
                AccordionContent({ ...item.content }, [text('Accordion content')]),
              ]),
            ],
            { exitCompletion: acc.exitCompletion },
          ),
          Collapsible(
            { ...col.root },
            [
              CollapsibleTrigger({ ...col.trigger }, [text('Collapsible details')]),
              CollapsibleContent({ ...col.content }, [text('Collapsible content')]),
            ],
            { exitCompletion: col.exitCompletion },
          ),
        ]
      },
    }),
  )
  return host
}

const part = (host: HTMLElement, scope: string, name: string): HTMLElement =>
  host.querySelector(`[data-scope="${scope}"][data-part="${name}"]`) as HTMLElement

function animationEvent(type: string, animationName: string): Event {
  const event = new Event(type, { bubbles: true })
  Object.defineProperty(event, 'animationName', { value: animationName })
  return event
}

function armExit(scope: 'accordion' | 'collapsible', content: HTMLElement): string {
  const animationName = scope === 'accordion' ? 'accordion-up' : 'collapse-up'
  content.style.setProperty('--llui-disclosure-exit-animation', animationName)
  content.dispatchEvent(animationEvent('animationstart', animationName))
  return animationName
}

describe('registry disclosure skins consume retained machine presence', () => {
  it.each(['accordion', 'collapsible'] as const)(
    'keeps closing %s content mounted and inert until completion',
    (scope) => {
      const host = mount()
      const trigger = part(host, scope, 'trigger') as HTMLButtonElement
      const content = part(host, scope, 'content')

      trigger.click()
      expect(content.dataset.state).toBe('closing')
      expect(content.hidden).toBe(false)
      expect(content.getAttribute('aria-hidden')).toBe('true')
      expect(content.hasAttribute('inert')).toBe(true)
      expect(content.className).toMatch(/data-\[state=closing\]/)

      const animationName = armExit(scope, content)
      content.dispatchEvent(animationEvent('animationend', animationName))
      expect(content.dataset.state).toBe('closed')
      expect(content.hidden).toBe(true)
    },
  )

  // #264 review item 2: the registry's Accordion/Collapsible root skins must
  // place `parts.exitCompletion` THEMSELVES, since only the root skin's own
  // wrapper can make forgetting it a compile-time obligation rather than a
  // convention a hand-rolled call site or a demo has to remember. This is
  // NOT a re-test of the underlying machine (that lives in
  // `@llui/components`' own `disclosure-presence.integration.test.ts`) — it
  // is a test that the REGISTRY skin, used exactly as README.md documents
  // (`Accordion({ ...parts.root }, [...], { exitCompletion:
  // parts.exitCompletion })`, nothing placed by hand alongside it), still
  // settles a RETAINED close
  // sent directly (bypassing the trigger's click handler) when the content
  // runs no exit motion at all — the shape a `display: none` ancestor
  // produces in a real browser, simulated here the same way the components
  // package's own suite does: `getAnimations` stubbed to report nothing
  // running, so the exit-completion Mountable's MutationObserver-driven
  // settle is the ONLY thing that can complete it.
  it.each(['accordion', 'collapsible'] as const)(
    '%s: the documented registry skin call settles a programmatic close with no running exit motion',
    async (scope) => {
      const host = mount()
      const content = part(host, scope, 'content')
      Object.defineProperty(content, 'getAnimations', { configurable: true, value: () => [] })

      // A programmatic close only retains when `retain: true` is stamped
      // (#264 review-264j) — exactly what `parts.close()` would produce
      // from the runtime registry; a raw `send` with no `retain` closes
      // instantly by design.
      if (scope === 'accordion') {
        app?.send({ type: 'accordion', msg: { type: 'close', value: 'details', retain: true } })
      } else {
        app?.send({ type: 'collapsible', msg: { type: 'close', retain: true } })
      }

      expect(content.dataset.state).toBe('closing')
      // MutationObserver callbacks are microtask-scheduled, never
      // synchronous with the mutation that triggers them.
      await Promise.resolve()
      expect(content.dataset.state).toBe('closed')
      expect(content.hidden).toBe(true)
      expect(content.hasAttribute('inert')).toBe(true)
    },
  )

  it.each(['accordion', 'collapsible'] as const)(
    'keeps reopened %s content visible after a stale completion event',
    (scope) => {
      const host = mount()
      const trigger = part(host, scope, 'trigger') as HTMLButtonElement
      const content = part(host, scope, 'content')

      trigger.click()
      const animationName = armExit(scope, content)
      trigger.click()
      content.dispatchEvent(animationEvent('animationend', animationName))
      expect(content.dataset.state).toBe('open')
      expect(content.hidden).toBe(false)
      expect(content.hasAttribute('inert')).toBe(false)
    },
  )
})
