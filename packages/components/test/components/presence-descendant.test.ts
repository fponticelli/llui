import { describe, it, expect, vi } from 'vitest'
import * as dialog from '../../src/components/dialog'
import * as drawer from '../../src/components/drawer'
import * as popover from '../../src/components/popover'
import * as hoverCard from '../../src/components/hover-card'
import * as tooltip from '../../src/components/tooltip'
import * as menu from '../../src/components/menu'
import * as contextMenu from '../../src/components/context-menu'
import * as toast from '../../src/components/toast'
import * as presence from '../../src/components/presence'
import type { PresenceStatus } from '../../src/components/presence'
import { rootSignal, signalOf } from '../_signal'

/**
 * A descendant `animationend`/`transitionend` must never advance a presence
 * machine (#126).
 *
 * Every overlay keeps its content mounted while `status === 'closing'` and
 * unmounts it when the end event arrives. Those events BUBBLE, so without the
 * `e.target === e.currentTarget` guard any child animation finishing mid-exit —
 * a spinner, a ripple, a child fade — unmounts the overlay early. Four surfaces
 * guarded it and five did not; the guard now lives in one place and every
 * surface goes through it.
 */

interface EndHandlers {
  onAnimationEnd: (e: AnimationEvent) => void
  onTransitionEnd: (e: TransitionEvent) => void
}

/**
 * Bind the part's end handlers to a real element and fire the events from a
 * CHILD, which is the only faithful way to reproduce the bubbling case.
 */
function fireFromDescendant(handlers: EndHandlers): { child: () => void; own: () => void } {
  const parent = document.createElement('div')
  const child = document.createElement('div')
  parent.appendChild(child)
  document.body.appendChild(parent)
  parent.addEventListener('animationend', handlers.onAnimationEnd)
  parent.addEventListener('transitionend', handlers.onTransitionEnd)
  return {
    child: () => {
      child.dispatchEvent(new Event('animationend', { bubbles: true }))
      child.dispatchEvent(new Event('transitionend', { bubbles: true }))
    },
    own: () => {
      parent.dispatchEvent(new Event('animationend', { bubbles: true }))
      parent.dispatchEvent(new Event('transitionend', { bubbles: true }))
    },
  }
}

function expectGuarded(name: string, build: (send: () => void) => EndHandlers): void {
  it(name, () => {
    const send = vi.fn()
    const events = fireFromDescendant(build(send))
    events.child()
    expect(send, 'a descendant end event must not advance presence').not.toHaveBeenCalled()
    events.own()
    expect(send, "the element's own end event must advance presence").toHaveBeenCalled()
  })
}

describe('descendant animation/transition end does not advance presence', () => {
  expectGuarded('dialog', (send) => dialog.connect(rootSignal(), send, { id: 'x' }).content)
  expectGuarded('drawer', (send) => drawer.connect(rootSignal(), send, { id: 'x' }).content)
  expectGuarded('popover', (send) => popover.connect(rootSignal(), send, { id: 'x' }).content)
  expectGuarded('hover-card', (send) => hoverCard.connect(rootSignal(), send, { id: 'x' }).content)
  expectGuarded('tooltip', (send) => tooltip.connect(rootSignal(), send, { id: 'x' }).content)
  expectGuarded('menu', (send) => menu.connect(rootSignal(), send, { id: 'x' }).content)
  expectGuarded(
    'context-menu',
    (send) => contextMenu.connect(rootSignal(), send, { id: 'x' }).content,
  )
  expectGuarded('presence', (send) => presence.connect(rootSignal(), send).root)
  expectGuarded('toast', (send) => {
    const item: toast.Toast = {
      id: 't1',
      type: 'info',
      duration: 5000,
      remainingMs: 5000,
      dismissable: true,
      paused: false,
      status: 'closing',
    }
    return toast.connect(rootSignal(), send).toast(signalOf(item)).root
  })
})

/**
 * The five overlays now reduce through the SAME presence transitions
 * (`presence.ts`), so they must produce the same status sequence — that shared
 * machine is what keeps their handlers from drifting apart again.
 */
describe('every overlay produces the same animated presence sequence', () => {
  // `status` is optional on dialog/drawer (they tolerate a partial `{ open }`
  // bridge slice), so the trace reads it as such.
  const trace = <S extends { status?: PresenceStatus }, M>(
    initial: S,
    reduce: (s: S, m: M) => [S, unknown[]],
    messages: readonly M[],
  ): (PresenceStatus | undefined)[] => {
    let state = initial
    const statuses: (PresenceStatus | undefined)[] = [state.status]
    for (const msg of messages) {
      state = reduce(state, msg)[0]
      statuses.push(state.status)
    }
    return statuses
  }

  const expected: PresenceStatus[] = ['closed', 'opening', 'open', 'closing', 'closed']

  it('dialog', () => {
    expect(
      trace(dialog.init({ skipAnimations: false }), dialog.update, [
        { type: 'open' },
        { type: 'animationEnd' },
        { type: 'close' },
        { type: 'animationEnd' },
      ]),
    ).toEqual(expected)
  })

  it('drawer', () => {
    expect(
      trace(drawer.init({ skipAnimations: false }), drawer.update, [
        { type: 'open' },
        { type: 'animationEnd' },
        { type: 'close' },
        { type: 'animationEnd' },
      ]),
    ).toEqual(expected)
  })

  it('popover', () => {
    expect(
      trace(popover.init({ skipAnimations: false }), popover.update, [
        { type: 'open' },
        { type: 'animationEnd' },
        { type: 'close' },
        { type: 'animationEnd' },
      ]),
    ).toEqual(expected)
  })

  it('hover-card', () => {
    expect(
      trace(hoverCard.init({ skipAnimations: false }), hoverCard.update, [
        { type: 'show' },
        { type: 'animationEnd' },
        { type: 'hide' },
        { type: 'animationEnd' },
      ]),
    ).toEqual(expected)
  })

  it('tooltip', () => {
    // Tooltip spells the flag the other way round (`animated`), which is the
    // whole of the difference between it and the other four.
    expect(
      trace(tooltip.init({ animated: true }), tooltip.update, [
        { type: 'show' },
        { type: 'animationEnd' },
        { type: 'hide' },
        { type: 'animationEnd' },
      ]),
    ).toEqual(expected)
  })
})
