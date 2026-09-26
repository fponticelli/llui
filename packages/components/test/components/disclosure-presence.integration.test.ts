import { afterEach, describe, expect, it } from 'vitest'
import { button, component, div, mountApp, text, type Mountable } from '@llui/dom'
import * as accordion from '../../src/components/accordion'
import * as collapsible from '../../src/components/collapsible'

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
      name: 'DisclosurePresenceIntegration',
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
          { id: 'presence-accordion' },
        )
        const col = collapsible.connect(
          state.at('collapsible'),
          (msg) => send({ type: 'collapsible', msg }),
          { id: 'presence-collapsible' },
        )
        const item = acc.item('details')
        return [
          div({ ...acc.root }, [
            div({ ...item.item }, [
              button({ ...item.trigger }, [text('Accordion details')]),
              div({ ...item.content }, [text('Accordion content')]),
            ]),
          ]),
          div({ ...col.root }, [
            button({ ...col.trigger }, [text('Collapsible details')]),
            div({ ...col.content }, [text('Collapsible content')]),
          ]),
          acc.exitCompletion,
          col.exitCompletion,
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

function transitionEvent(type: string, propertyName: string): Event {
  const event = new Event(type, { bubbles: true })
  Object.defineProperty(event, 'propertyName', { value: propertyName })
  return event
}

function declareExitAnimation(content: HTMLElement, scope: string): void {
  content.style.setProperty(
    '--llui-disclosure-exit-animation',
    scope === 'accordion' ? 'accordion-up' : 'collapse-up',
  )
}

function declareExitTransitionName(content: HTMLElement, name: string): void {
  content.style.setProperty('--llui-disclosure-exit-animation', name)
}

describe('animated disclosure presence in actual DOM', () => {
  it.each([
    ['accordion', 'accordion-up'],
    ['collapsible', 'collapse-up'],
  ] as const)('retains inert %s content until its own exit event', (scope, exitName) => {
    const host = mount()
    const trigger = part(host, scope, 'trigger') as HTMLButtonElement
    const content = part(host, scope, 'content')
    declareExitAnimation(content, scope)

    trigger.click()
    expect(content.dataset.state).toBe('closing')
    expect(content.hidden).toBe(false)
    expect(content.getAttribute('aria-hidden')).toBe('true')
    expect(content.hasAttribute('inert')).toBe(true)

    content.dispatchEvent(animationEvent('animationstart', exitName))
    content.dispatchEvent(animationEvent('animationend', exitName))
    expect(content.dataset.state).toBe('closed')
    expect(content.hidden).toBe(true)
  })

  it.each(['accordion', 'collapsible'] as const)(
    'interrupts a closing %s surface without a stale end event hiding it',
    (scope) => {
      const host = mount()
      const trigger = part(host, scope, 'trigger') as HTMLButtonElement
      const content = part(host, scope, 'content')
      declareExitAnimation(content, scope)

      trigger.click()
      expect(content.dataset.state).toBe('closing')
      trigger.click()
      expect(content.dataset.state).toBe('open')
      content.dispatchEvent(new Event('animationend', { bubbles: true }))
      expect(content.dataset.state).toBe('open')
      expect(content.hidden).toBe(false)
      expect(content.hasAttribute('inert')).toBe(false)
    },
  )

  it('ignores bubbled descendant animation events', () => {
    const host = mount()
    const trigger = part(host, 'accordion', 'trigger') as HTMLButtonElement
    const content = part(host, 'accordion', 'content')
    declareExitAnimation(content, 'accordion')
    const child = content.firstElementChild ?? content.appendChild(document.createElement('span'))

    trigger.click()
    child.dispatchEvent(new Event('animationend', { bubbles: true }))
    expect(content.dataset.state).toBe('closing')
    expect(content.hidden).toBe(false)
  })

  it.each([
    ['accordion', 'accordion-down'],
    ['collapsible', 'collapse-down'],
  ] as const)('publishes a measured block-size endpoint for %s motion', (scope, enterName) => {
    const host = mount()
    const content = part(host, scope, 'content')
    Object.defineProperty(content, 'scrollHeight', { configurable: true, value: 96 })

    content.dispatchEvent(animationEvent('animationstart', enterName))

    expect(content.style.getPropertyValue('--llui-disclosure-block-size')).toBe('96px')
  })

  it('measures the content box so animated padding can reach a true zero endpoint', () => {
    const host = mount()
    const content = part(host, 'accordion', 'content')
    content.style.paddingBlockStart = '8px'
    content.style.paddingBlockEnd = '12px'
    Object.defineProperty(content, 'scrollHeight', { configurable: true, value: 116 })

    content.dispatchEvent(animationEvent('animationstart', 'accordion-down'))

    expect(content.style.getPropertyValue('--llui-disclosure-block-size')).toBe('96px')
  })

  it.each([
    ['accordion', 'accordion-down', 'accordion-up'],
    ['collapsible', 'collapse-down', 'collapse-up'],
  ] as const)(
    'does not let a canceled %s enter animation consume the newly armed exit',
    (scope, enterName, exitName) => {
      const host = mount()
      const trigger = part(host, scope, 'trigger') as HTMLButtonElement
      const content = part(host, scope, 'content')
      declareExitAnimation(content, scope)

      content.dispatchEvent(animationEvent('animationstart', enterName))
      trigger.click()
      expect(content.dataset.state).toBe('closing')

      content.dispatchEvent(animationEvent('animationcancel', enterName))
      expect(content.dataset.state).toBe('closing')

      content.dispatchEvent(animationEvent('animationstart', 'unrelated-pulse'))
      content.dispatchEvent(animationEvent('animationend', 'unrelated-pulse'))
      expect(content.dataset.state).toBe('closing')

      content.dispatchEvent(animationEvent('animationstart', exitName))
      content.dispatchEvent(animationEvent('animationend', exitName))
      expect(content.dataset.state).toBe('closed')
    },
  )

  it.each(['accordion', 'collapsible'] as const)(
    'completes exit for a custom skin whose animation never publishes --llui-disclosure-exit-animation (%s)',
    (scope) => {
      const host = mount()
      const trigger = part(host, scope, 'trigger') as HTMLButtonElement
      const content = part(host, scope, 'content')
      // Deliberately do NOT call declareExitAnimation: a custom skin can run
      // its own real CSS exit animation without ever publishing the named
      // custom property the baseline/registry skins use.

      trigger.click()
      expect(content.dataset.state).toBe('closing')

      content.dispatchEvent(animationEvent('animationstart', 'my-custom-fade-out'))
      content.dispatchEvent(animationEvent('animationend', 'my-custom-fade-out'))

      expect(content.dataset.state).toBe('closed')
      expect(content.hidden).toBe(true)
      expect(content.hasAttribute('inert')).toBe(true)
    },
  )

  it.each(['accordion', 'collapsible'] as const)(
    'still ignores a canceled enter animation when no --llui-disclosure-exit-animation name is published (%s)',
    (scope) => {
      const host = mount()
      const trigger = part(host, scope, 'trigger') as HTMLButtonElement
      const content = part(host, scope, 'content')

      content.dispatchEvent(animationEvent('animationstart', 'fade-in'))
      trigger.click()
      expect(content.dataset.state).toBe('closing')
      content.dispatchEvent(animationEvent('animationcancel', 'fade-in'))
      expect(content.dataset.state).toBe('closing')

      content.dispatchEvent(animationEvent('animationstart', 'fade-out'))
      content.dispatchEvent(animationEvent('animationend', 'fade-out'))
      expect(content.dataset.state).toBe('closed')
    },
  )

  it.each(['accordion', 'collapsible'] as const)(
    'completes a user-initiated close immediately when the skin runs no exit animation at all (%s)',
    (scope) => {
      const host = mount()
      const trigger = part(host, scope, 'trigger') as HTMLButtonElement
      const content = part(host, scope, 'content')
      Object.defineProperty(content, 'getAnimations', { configurable: true, value: () => [] })

      trigger.click()

      expect(content.dataset.state).toBe('closed')
      expect(content.hidden).toBe(true)
      expect(content.hasAttribute('inert')).toBe(true)
    },
  )

  it.each(['accordion', 'collapsible'] as const)(
    'does not complete immediately while a real exit animation is still running (%s)',
    (scope) => {
      const host = mount()
      const trigger = part(host, scope, 'trigger') as HTMLButtonElement
      const content = part(host, scope, 'content')
      declareExitAnimation(content, scope)
      Object.defineProperty(content, 'getAnimations', {
        configurable: true,
        value: () => [{ animationName: 'irrelevant', playState: 'running' }],
      })

      trigger.click()

      expect(content.dataset.state).toBe('closing')
    },
  )

  it.each([
    ['accordion', 'accordion-up'],
    ['collapsible', 'collapse-up'],
  ] as const)(
    'ignores a stale same-name %s exit event after reopen and re-close',
    (scope, exitName) => {
      const host = mount()
      const trigger = part(host, scope, 'trigger') as HTMLButtonElement
      const content = part(host, scope, 'content')
      declareExitAnimation(content, scope)
      const oldExit = { animationName: exitName, playState: 'running' }
      const currentExit = { animationName: exitName, playState: 'running' }
      let animations = [oldExit]
      Object.defineProperty(content, 'getAnimations', {
        configurable: true,
        value: () => animations,
      })

      trigger.click()
      content.dispatchEvent(animationEvent('animationstart', exitName))
      trigger.click()
      oldExit.playState = 'idle'
      // A real browser's `getAnimations()` already reflects the freshly
      // started exit animation synchronously (it forces a style flush), so
      // the mock is updated BEFORE the click that starts it, not after —
      // otherwise the "complete immediately if nothing is running" safety
      // net would (correctly, given what it can see) treat this moment as
      // unanimated and short-circuit the very generation this test means to
      // arm and match against a stale cancel below.
      animations = [currentExit]
      trigger.click()
      content.dispatchEvent(animationEvent('animationstart', exitName))

      content.dispatchEvent(animationEvent('animationcancel', exitName))
      expect(content.dataset.state).toBe('closing')

      currentExit.playState = 'finished'
      content.dispatchEvent(animationEvent('animationend', exitName))
      expect(content.dataset.state).toBe('closed')
    },
  )

  it.each(['accordion', 'collapsible'] as const)(
    'completes a transition-only %s exit via transitionend, not just animationend (#264 item 4a)',
    (scope) => {
      const host = mount()
      const trigger = part(host, scope, 'trigger') as HTMLButtonElement
      const content = part(host, scope, 'content')
      // A transition-only skin: getAnimations() reports the running
      // CSSTransition (so the "nothing running" safety net correctly
      // declines), but nothing ever fires animationstart/animationend for
      // it — only transitionstart/transitionend.
      const transition = { transitionProperty: 'opacity', playState: 'running' }
      Object.defineProperty(content, 'getAnimations', {
        configurable: true,
        value: () => [transition],
      })

      trigger.click()
      expect(content.dataset.state).toBe('closing')

      content.dispatchEvent(transitionEvent('transitionstart', 'opacity'))
      expect(content.dataset.state).toBe('closing')

      // A real browser's CSSTransition has already moved past 'running' by
      // the time `transitionend` actually fires.
      transition.playState = 'finished'
      content.dispatchEvent(transitionEvent('transitionend', 'opacity'))
      expect(content.dataset.state).toBe('closed')
      expect(content.hidden).toBe(true)
      expect(content.hasAttribute('inert')).toBe(true)
    },
  )

  it.each(['accordion', 'collapsible'] as const)(
    'completes a transition-only %s exit via transitioncancel',
    (scope) => {
      const host = mount()
      const trigger = part(host, scope, 'trigger') as HTMLButtonElement
      const content = part(host, scope, 'content')
      const transition = { transitionProperty: 'opacity', playState: 'running' }
      Object.defineProperty(content, 'getAnimations', {
        configurable: true,
        value: () => [transition],
      })

      trigger.click()
      content.dispatchEvent(transitionEvent('transitionstart', 'opacity'))
      transition.playState = 'idle'
      content.dispatchEvent(transitionEvent('transitioncancel', 'opacity'))
      expect(content.dataset.state).toBe('closed')
    },
  )

  it.each(['accordion', 'collapsible'] as const)(
    'settles a PROGRAMMATIC %s close (a message sent outside the trigger click) via watchExitCompletion (#264 item 4b)',
    (scope) => {
      const host = mount()
      const content = part(host, scope, 'content')
      declareExitAnimation(content, scope)
      // No real motion at all — the watcher's completeIfUnanimated should
      // settle this the moment the MutationObserver sees data-state flip,
      // with no click ever involved.
      Object.defineProperty(content, 'getAnimations', { configurable: true, value: () => [] })

      if (scope === 'accordion') {
        app?.send({ type: 'accordion', msg: { type: 'close', value: 'details' } })
      } else {
        app?.send({ type: 'collapsible', msg: { type: 'close' } })
      }

      expect(content.dataset.state).toBe('closing')
      // MutationObserver callbacks are microtask-scheduled, never
      // synchronous with the mutation.
      return Promise.resolve().then(() => {
        expect(content.dataset.state).toBe('closed')
        expect(content.hidden).toBe(true)
        expect(content.hasAttribute('inert')).toBe(true)
      })
    },
  )

  it.each(['accordion', 'collapsible'] as const)(
    'filters an unrelated transition by the declared exit name, then completes the real one (%s)',
    (scope) => {
      const host = mount()
      const trigger = part(host, scope, 'trigger') as HTMLButtonElement
      const content = part(host, scope, 'content')
      declareExitTransitionName(content, 'opacity')

      content.dispatchEvent(transitionEvent('transitionstart', 'transform'))
      trigger.click()
      expect(content.dataset.state).toBe('closing')

      content.dispatchEvent(transitionEvent('transitioncancel', 'transform'))
      expect(content.dataset.state).toBe('closing')

      // An unrelated transition (wrong property name) must never be mistaken
      // for the declared exit ('opacity') — this is the direction that
      // regresses if a motion event's name is ever read off the wrong field
      // (#264 review item 4a: TransitionEvent carries `propertyName`, not
      // `animationName`).
      content.dispatchEvent(transitionEvent('transitionstart', 'transform'))
      content.dispatchEvent(transitionEvent('transitionend', 'transform'))
      expect(content.dataset.state).toBe('closing')

      content.dispatchEvent(transitionEvent('transitionstart', 'opacity'))
      content.dispatchEvent(transitionEvent('transitionend', 'opacity'))
      expect(content.dataset.state).toBe('closed')
    },
  )

  it.each(['accordion', 'collapsible'] as const)(
    'ignores a stale same-property %s transition-cancel after reopen and re-close',
    (scope) => {
      const host = mount()
      const trigger = part(host, scope, 'trigger') as HTMLButtonElement
      const content = part(host, scope, 'content')
      declareExitTransitionName(content, 'opacity')
      const oldExit = { transitionProperty: 'opacity', playState: 'running' }
      const currentExit = { transitionProperty: 'opacity', playState: 'running' }
      let transitions = [oldExit]
      Object.defineProperty(content, 'getAnimations', {
        configurable: true,
        value: () => transitions,
      })

      trigger.click()
      content.dispatchEvent(transitionEvent('transitionstart', 'opacity'))
      trigger.click()
      oldExit.playState = 'idle'
      transitions = [currentExit]
      trigger.click()
      content.dispatchEvent(transitionEvent('transitionstart', 'opacity'))

      content.dispatchEvent(transitionEvent('transitioncancel', 'opacity'))
      expect(content.dataset.state).toBe('closing')

      currentExit.playState = 'finished'
      content.dispatchEvent(transitionEvent('transitionend', 'opacity'))
      expect(content.dataset.state).toBe('closed')
    },
  )

  it.each(['accordion', 'collapsible'] as const)(
    'does NOT settle a programmatic %s close while a real exit animation is still running',
    (scope) => {
      const host = mount()
      const content = part(host, scope, 'content')
      declareExitAnimation(content, scope)
      Object.defineProperty(content, 'getAnimations', {
        configurable: true,
        value: () => [{ animationName: 'irrelevant', playState: 'running' }],
      })

      if (scope === 'accordion') {
        app?.send({ type: 'accordion', msg: { type: 'close', value: 'details' } })
      } else {
        app?.send({ type: 'collapsible', msg: { type: 'close' } })
      }

      return Promise.resolve().then(() => {
        expect(content.dataset.state).toBe('closing')
      })
    },
  )
})
