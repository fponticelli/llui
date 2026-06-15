import { describe, it, expect } from 'vitest'
import { renderToString, renderNodes } from '../../src/signals/ssr'
import {
  signalText,
  el,
  signalShow,
  signalBranch,
  signalSubApp,
  onMount,
} from '../../src/signals/dom'
import type { SignalComponentDef } from '../../src/signals/component'

// SSR must NOT invoke onMount callbacks: the mount lifecycle is a client-DOM
// concern, and on a Worker (or any DOM-less server runtime) a callback body that
// touches a browser global would otherwise throw and 500 the render. The marker
// comment is still emitted (hydration rebuilds the tree client-side and runs the
// callback then).
describe('onMount (signal) — SSR', () => {
  it('does NOT run a top-level onMount during renderToString', () => {
    let ran = false
    const def: SignalComponentDef<{ x: number }, never> = {
      init: () => ({ x: 0 }),
      update: (s) => s,
      view: () => [
        el('p', {}, [signalText(() => 'hi', [])]),
        onMount(() => {
          ran = true
        }),
      ],
    }
    const html = renderToString(def, undefined, document)
    expect(ran).toBe(false)
    expect(html).toContain('<p>hi</p>')
  })

  it('does NOT run an onMount inside a SHOW arm that is open during SSR', () => {
    let ran = false
    const def: SignalComponentDef<{ open: boolean }, never> = {
      init: () => ({ open: true }),
      update: (s) => s,
      view: () => [
        signalShow({ produce: (s) => (s as { open: boolean }).open, deps: ['open'] }, () => [
          el('span', {}, [signalText(() => 'shown', [])]),
          onMount(() => {
            ran = true
          }),
        ]),
      ],
    }
    const html = renderToString(def, { open: true }, document)
    expect(ran).toBe(false)
    expect(html).toContain('shown') // arm content is still serialized
  })

  it('does NOT run an onMount inside a BRANCH arm mounted during SSR (the dicerun repro)', () => {
    let ran = false
    const def: SignalComponentDef<{ tab: string }, never> = {
      init: () => ({ tab: 'roll' }),
      update: (s) => s,
      view: () => [
        signalBranch(
          { produce: (s) => (s as { tab: string }).tab, deps: ['tab'] },
          {
            stats: () => [el('div', { class: 'stats' }, [signalText(() => 'stats', [])])],
            roll: () => [
              el('div', { class: 'roller' }, [signalText(() => 'roll', [])]),
              onMount(() => {
                // body that would touch a browser global on a Worker
                ran = true
              }),
            ],
          },
        ),
      ],
    }
    const html = renderToString(def, { tab: 'roll' }, document)
    expect(ran).toBe(false)
    expect(html).toContain('class="roller"')
  })

  it('does NOT mount a subApp inside an SSR-open arm (its child onMount would crash)', () => {
    let childOnMountRan = false
    let childMounted = false
    const child: SignalComponentDef<{ n: number }, never> = {
      init: () => ({ n: 0 }),
      update: (s) => s,
      view: () => [
        el('em', {}, [signalText(() => 'child', [])]),
        onMount(() => {
          childOnMountRan = true
        }),
      ],
    }
    const def: SignalComponentDef<{ open: boolean }, never> = {
      init: () => ({ open: true }),
      update: (s) => s,
      view: () => [
        signalShow({ produce: (s) => (s as { open: boolean }).open, deps: ['open'] }, () => [
          signalSubApp({
            reason: 'isolated client-only widget',
            def: child,
            onHandle: () => {
              childMounted = true
            },
          }),
        ]),
      ],
    }
    const html = renderToString(def, { open: true }, document)
    expect(childMounted).toBe(false)
    expect(childOnMountRan).toBe(false)
    expect(html).toContain('<!--subApp-->') // anchor still serialized
  })

  it('still emits the onMount marker comment so the serialized tree is stable', () => {
    const def: SignalComponentDef<{ x: number }, never> = {
      init: () => ({ x: 0 }),
      update: (s) => s,
      view: () => [el('p', {}, [signalText(() => 'hi', [])]), onMount(() => {})],
    }
    const { nodes, dispose } = renderNodes(def, undefined, document)
    // marker comment is present among the rendered nodes
    const hasComment = nodes.some((n) => n.nodeType === 8 && (n as Comment).data === 'onMount')
    expect(hasComment).toBe(true)
    dispose()
  })
})
