// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  component,
  mountApp,
  mountAtAnchor,
  hydrateApp,
  hydrateAtAnchor,
  div,
  text,
  type ComponentDef,
} from '../src/index.js'
import { _setHmrModule, _getHmrModule } from '../src/mount.js'
import { enableHmr } from '../src/hmr.js'

/**
 * Each of the four mount paths exposes an HMR fast path: a second
 * mount-time call into the same root (container or anchor) of a
 * same-named component swaps the existing instance in place rather
 * than creating a second one. Without that, the second call would
 * leak the prior instance — lifetime never disposed, HMR entry never
 * unregistered, bindings still running on detached DOM.
 *
 * The four paths must also key the fast path on root identity, not
 * just `def.name`. Independent mounts of the same-named component at
 * different roots (e.g. a docs page iterating placeholder spans and
 * mounting an inline widget into each) must each produce their own
 * instance.
 *
 * These tests pin both halves of that contract for every mount path,
 * paralleling the structure of mount-path-parity.test.ts.
 */

type S = { n: number }

function mkDef(label: string): ComponentDef<S, never, never> {
  return component<S, never, never>({
    name: 'FastPathComp',
    init: () => [{ n: 0 }, []],
    update: (s) => [s, []],
    view: () => [div({ class: label }, [text((s: S) => `${label}:${s.n}`)])],
    __prefixes: [(s) => s.n],
  })
}

function makeAnchor(): { anchor: Comment; parent: HTMLElement } {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const anchor = document.createComment('a')
  parent.appendChild(anchor)
  return { anchor, parent }
}

let priorHmr: ReturnType<typeof _getHmrModule> = null
beforeEach(() => {
  priorHmr = _getHmrModule()
  enableHmr()
})
afterEach(() => {
  _setHmrModule(priorHmr)
})

describe('mountApp HMR fast path is keyed on container identity', () => {
  it('second call into the same container hot-swaps in place', () => {
    const container = document.createElement('div')
    mountApp(container, mkDef('v1'))
    expect(container.querySelector('.v1')).not.toBeNull()
    const h2 = mountApp(container, mkDef('v2'))
    expect(container.querySelector('.v1')).toBeNull()
    expect(container.querySelector('.v2')).not.toBeNull()
    h2.dispose()
  })

  it('different containers each produce a fresh, independent mount', () => {
    const a = document.createElement('div')
    const b = document.createElement('div')
    const hA = mountApp(a, mkDef('a'))
    const hB = mountApp(b, mkDef('b'))
    expect(a.querySelector('.a')).not.toBeNull()
    expect(b.querySelector('.b')).not.toBeNull()
    // The two are independent — neither call swapped the other.
    expect(a.querySelector('.b')).toBeNull()
    expect(b.querySelector('.a')).toBeNull()
    hA.dispose()
    hB.dispose()
  })
})

describe('mountAtAnchor HMR fast path is keyed on anchor identity', () => {
  it('second call on the same anchor hot-swaps in place (no leak, no duplicate sentinel)', () => {
    const { anchor, parent } = makeAnchor()
    mountAtAnchor(anchor, mkDef('v1'))
    expect(parent.querySelector('.v1')).not.toBeNull()
    // Exactly one end sentinel between anchor and parent end.
    expect(countSentinels(parent)).toBe(1)

    const h2 = mountAtAnchor(anchor, mkDef('v2'))
    expect(parent.querySelector('.v1')).toBeNull()
    expect(parent.querySelector('.v2')).not.toBeNull()
    // Sentinel is reused, not duplicated — the swap path keeps the
    // anchor/sentinel pair intact.
    expect(countSentinels(parent)).toBe(1)
    h2.dispose()
  })

  it('different anchors each produce a fresh, independent mount', () => {
    const a = makeAnchor()
    const b = makeAnchor()
    const hA = mountAtAnchor(a.anchor, mkDef('a'))
    const hB = mountAtAnchor(b.anchor, mkDef('b'))
    expect(a.parent.querySelector('.a')).not.toBeNull()
    expect(b.parent.querySelector('.b')).not.toBeNull()
    // Independent: neither call swapped the other.
    expect(a.parent.querySelector('.b')).toBeNull()
    expect(b.parent.querySelector('.a')).toBeNull()
    hA.dispose()
    hB.dispose()
  })
})

describe('hydrateApp HMR fast path is keyed on container identity', () => {
  it('second call on the same container hot-swaps in place', () => {
    const container = document.createElement('div')
    // Pre-populate with "server HTML" so first hydrate has something to replace.
    container.innerHTML = '<div class="v1">server:0</div>'
    hydrateApp(container, mkDef('v1'), { n: 0 })
    expect(container.querySelector('.v1')).not.toBeNull()

    const h2 = hydrateApp(container, mkDef('v2'), { n: 0 })
    expect(container.querySelector('.v1')).toBeNull()
    expect(container.querySelector('.v2')).not.toBeNull()
    h2.dispose()
  })

  it('different containers each hydrate fresh and independent', () => {
    const a = document.createElement('div')
    const b = document.createElement('div')
    const hA = hydrateApp(a, mkDef('a'), { n: 0 })
    const hB = hydrateApp(b, mkDef('b'), { n: 0 })
    expect(a.querySelector('.a')).not.toBeNull()
    expect(b.querySelector('.b')).not.toBeNull()
    expect(a.querySelector('.b')).toBeNull()
    expect(b.querySelector('.a')).toBeNull()
    hA.dispose()
    hB.dispose()
  })
})

describe('hydrateAtAnchor HMR fast path is keyed on anchor identity', () => {
  it('second call on the same anchor hot-swaps in place (sentinel preserved)', () => {
    const { anchor, parent } = makeAnchor()
    hydrateAtAnchor(anchor, mkDef('v1'), { n: 0 })
    expect(parent.querySelector('.v1')).not.toBeNull()
    expect(countSentinels(parent)).toBe(1)

    const h2 = hydrateAtAnchor(anchor, mkDef('v2'), { n: 0 })
    expect(parent.querySelector('.v1')).toBeNull()
    expect(parent.querySelector('.v2')).not.toBeNull()
    expect(countSentinels(parent)).toBe(1)
    h2.dispose()
  })

  it('different anchors each hydrate fresh and independent', () => {
    const a = makeAnchor()
    const b = makeAnchor()
    const hA = hydrateAtAnchor(a.anchor, mkDef('a'), { n: 0 })
    const hB = hydrateAtAnchor(b.anchor, mkDef('b'), { n: 0 })
    expect(a.parent.querySelector('.a')).not.toBeNull()
    expect(b.parent.querySelector('.b')).not.toBeNull()
    expect(a.parent.querySelector('.b')).toBeNull()
    expect(b.parent.querySelector('.a')).toBeNull()
    hA.dispose()
    hB.dispose()
  })
})

function countSentinels(parent: ParentNode): number {
  let n = 0
  for (let c: Node | null = parent.firstChild; c !== null; c = c.nextSibling) {
    if (c.nodeType === 8 && (c as Comment).nodeValue === 'llui-mount-end') n++
  }
  return n
}
