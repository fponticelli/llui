import { describe, it, expect } from 'vitest'
import type { ComponentDef } from '../src/types'
import { component } from '../src/component'
import { div } from '../src/elements'
import { mountApp, hydrateApp, mountAtAnchor, hydrateAtAnchor } from '../src/mount'
import { renderToString, renderNodes } from '../src/ssr'
import { browserEnv } from '../src/dom-env'
import { addressOf } from '../src/addressed'
import { replaceComponent } from '../src/hmr'

const env = browserEnv()

// Type-level regression: every public API that takes a ComponentDef
// must accept a fully-typed `ComponentDef<S, M, E, D>` with D ≠ void
// without requiring an `as unknown as ComponentDef<S, M, E>` cast at
// the call site. The runtime forwards init data correctly; this test
// pins the type-signature contract so the TS compile pass is the
// assertion.

interface InitData {
  startAt: number
  label: string
}

type S = { count: number; label: string }
type M = { type: 'inc' } | { type: 'reset' }
type E = { type: 'log'; message: string }

const Widget = component<S, M, E, InitData>({
  name: 'Widget',
  // Defensive against `undefined`: the hydrate/render/ssr paths call
  // init() with no data to capture its effect payload, even when the
  // typed signature declares a D ≠ void. This mirrors how real apps
  // keep init tolerant so SSR + hydrate still work.
  init: (data) => [{ count: data?.startAt ?? 0, label: data?.label ?? '' }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'inc':
        return [{ ...state, count: state.count + 1 }, []]
      case 'reset':
        return [{ ...state, count: 0 }, []]
    }
  },
  view: ({ text }) => [div({ class: 'widget' }, [text((s) => s.label)])],
})

// Satisfies: the variable is deliberately typed so that assigning to a
// ComponentDef<S, M, E, void> parameter would fail without the D generic.
const WidgetDef: ComponentDef<S, M, E, InitData> = Widget

describe('public API accepts ComponentDef<S, M, E, D> with non-void D', () => {
  it('mountApp threads typed init data without a cast', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, WidgetDef, { startAt: 7, label: 'hi' })
    handle.dispose()
    expect(container.children.length).toBe(0)
  })

  it('mountAtAnchor threads typed init data without a cast', () => {
    const container = document.createElement('div')
    const anchor = document.createComment('llui-mount-start')
    container.appendChild(anchor)
    const handle = mountAtAnchor(anchor, WidgetDef, { startAt: 3, label: 'x' })
    handle.dispose()
  })

  it('hydrateApp accepts a ComponentDef<…, D> without a cast', () => {
    const container = document.createElement('div')
    container.innerHTML = '<div class="widget">seed</div>'
    const handle = hydrateApp(container, WidgetDef, { count: 0, label: 'seed' })
    handle.dispose()
  })

  it('hydrateAtAnchor accepts a ComponentDef<…, D> without a cast', () => {
    const container = document.createElement('div')
    const anchor = document.createComment('llui-mount-start')
    container.appendChild(anchor)
    const handle = hydrateAtAnchor(anchor, WidgetDef, { count: 0, label: 'seed' })
    handle.dispose()
  })

  it('renderToString accepts a ComponentDef<…, D> without a cast', () => {
    const html = renderToString(WidgetDef, { count: 0, label: 'ok' }, env)
    expect(html).toContain('widget')
  })

  it('renderNodes accepts a ComponentDef<…, D> without a cast', () => {
    const { nodes, inst } = renderNodes(WidgetDef, { count: 0, label: 'ok' }, env)
    expect(nodes.length).toBeGreaterThan(0)
    expect(inst).toBeDefined()
  })

  it('addressOf accepts a ComponentDef<…, D> without a cast', () => {
    // addressOf only reads def.receives — returns {} here — so the
    // assertion is purely that the call type-checks.
    const addr = addressOf(WidgetDef, 'k1')
    expect(addr).toEqual({})
  })

  it('replaceComponent accepts a ComponentDef<…, D> without a cast', () => {
    // Safe to call — no registered entries for this name, returns null.
    const result = replaceComponent('NotRegistered', WidgetDef)
    expect(result).toBeNull()
  })
})

// A ComponentDef<S, M, E> (D = void) must still type-check everywhere.
type VS = { n: number }
const VoidDef: ComponentDef<VS, never, never> = {
  name: 'VoidDef',
  init: () => [{ n: 0 }, []],
  update: (s) => [s, []],
  view: ({ text }) => [div({}, [text((s: VS) => String(s.n))])],
}

describe('void-D callers continue to type-check', () => {
  it('mountApp(container, VoidDef) with no data argument', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, VoidDef)
    handle.dispose()
  })

  it('renderToString(VoidDef) with no state argument', () => {
    const html = renderToString(VoidDef, undefined, env)
    expect(typeof html).toBe('string')
  })
})
