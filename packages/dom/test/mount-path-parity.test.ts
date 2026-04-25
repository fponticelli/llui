import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  component,
  mountApp,
  mountAtAnchor,
  hydrateApp,
  hydrateAtAnchor,
  div,
  type ComponentDef,
} from '../src/index.js'
import { _setDevToolsInstall, _setHmrModule } from '../src/mount.js'

/**
 * Parity tests across the four mount paths:
 *
 *   - mountApp           (fresh, container-rooted)
 *   - mountAtAnchor      (fresh, anchor-rooted)
 *   - hydrateApp         (SSR rehydrate, container-rooted)
 *   - hydrateAtAnchor    (SSR rehydrate, anchor-rooted)
 *
 * The four paths must register the new instance with the same
 * observability surfaces — devtools (`window.__lluiComponents`,
 * `window.__lluiDebug`) and HMR (`replaceComponent` / `replaceAtAnchor`).
 *
 * Issue #1 reported in 2026-04-25 was that `hydrateApp` silently skipped
 * `devToolsInstall` and `registerForHmr`, leaving SSR-hydrated layouts
 * invisible to MCP / agent client / devtools. The bug went unnoticed
 * because the mount paths grew organically without a parity assertion.
 *
 * This test stubs the injection seams (`_setDevToolsInstall`,
 * `_setHmrModule`) and asserts each path calls each seam with an
 * instance argument. A future divergence in any path fails here loudly.
 */

interface State {
  n: number
}

const Counter: ComponentDef<State, never, never> = component<State, never, never>({
  name: 'Counter',
  init: () => [{ n: 0 }, []],
  update: (s) => [s, []],
  view: () => [div({ id: 'root' }, [])],
})

function setup(): {
  devToolsCalls: object[]
  hmrRegisterContainerCalls: { name: string; container: HTMLElement }[]
  hmrRegisterAnchorCalls: { name: string; anchor: Comment }[]
  hmrUnregisterCalls: { name: string }[]
} {
  const devToolsCalls: object[] = []
  const hmrRegisterContainerCalls: { name: string; container: HTMLElement }[] = []
  const hmrRegisterAnchorCalls: { name: string; anchor: Comment }[] = []
  const hmrUnregisterCalls: { name: string }[] = []

  _setDevToolsInstall((inst) => {
    devToolsCalls.push(inst)
  })

  // Minimal HMR module stub. Only registerForHmr / registerForAnchor /
  // unregisterForHmr are observed; the parity test isn't about HMR
  // behavior, just about whether each mount path WIRES through to the
  // registry.
  _setHmrModule({
    registerForHmr: ((name: string, _inst: object, container: HTMLElement) => {
      hmrRegisterContainerCalls.push({ name, container })
    }) as never,
    registerForAnchor: ((name: string, _inst: object, anchor: Comment) => {
      hmrRegisterAnchorCalls.push({ name, anchor })
    }) as never,
    unregisterForHmr: ((name: string) => {
      hmrUnregisterCalls.push({ name })
    }) as never,
    // mountApp calls replaceComponent before mounting to handle the
    // HMR swap-in-place case. Return null/undefined to signal "no
    // existing instance to swap" so the normal mount path runs.
    replaceComponent: (() => null) as never,
  } as never)

  return { devToolsCalls, hmrRegisterContainerCalls, hmrRegisterAnchorCalls, hmrUnregisterCalls }
}

beforeEach(() => {
  // Each test installs its own stubs via setup(); reset before to be safe.
  _setDevToolsInstall(null)
})

afterEach(() => {
  _setDevToolsInstall(null)
  // Restore HMR module to whatever the runtime entry installed (none in tests).
  // The internal seam allows null reset by passing a no-op stub; use a
  // dummy that no-ops to clear our hooks.
  _setHmrModule({
    registerForHmr: (() => {}) as never,
    registerForAnchor: (() => {}) as never,
    unregisterForHmr: (() => {}) as never,
  } as never)
})

describe('mount-path parity — devtools + HMR registration', () => {
  it('mountApp registers devtools + HMR with the container', () => {
    const stubs = setup()
    const container = document.createElement('div')
    const handle = mountApp(container, Counter)
    try {
      expect(stubs.devToolsCalls).toHaveLength(1)
      expect(stubs.hmrRegisterContainerCalls).toEqual([{ name: 'Counter', container }])
      expect(stubs.hmrRegisterAnchorCalls).toEqual([])
    } finally {
      handle.dispose()
    }
    expect(stubs.hmrUnregisterCalls).toEqual([{ name: 'Counter' }])
  })

  it('mountAtAnchor registers devtools + HMR with the anchor', () => {
    const stubs = setup()
    const parent = document.createElement('div')
    const anchor = document.createComment('llui-mount')
    parent.appendChild(anchor)
    const handle = mountAtAnchor(anchor, Counter)
    try {
      expect(stubs.devToolsCalls).toHaveLength(1)
      expect(stubs.hmrRegisterContainerCalls).toEqual([])
      expect(stubs.hmrRegisterAnchorCalls).toEqual([{ name: 'Counter', anchor }])
    } finally {
      handle.dispose()
    }
    expect(stubs.hmrUnregisterCalls).toEqual([{ name: 'Counter' }])
  })

  it('hydrateApp registers devtools + HMR with the container (regression for issue #1)', () => {
    const stubs = setup()
    const container = document.createElement('div')
    const handle = hydrateApp(container, Counter, { n: 7 })
    try {
      expect(stubs.devToolsCalls).toHaveLength(1)
      expect(stubs.hmrRegisterContainerCalls).toEqual([{ name: 'Counter', container }])
      expect(stubs.hmrRegisterAnchorCalls).toEqual([])
    } finally {
      handle.dispose()
    }
    expect(stubs.hmrUnregisterCalls).toEqual([{ name: 'Counter' }])
  })

  it('hydrateAtAnchor registers devtools + HMR with the anchor', () => {
    const stubs = setup()
    const parent = document.createElement('div')
    const anchor = document.createComment('llui-mount')
    parent.appendChild(anchor)
    const handle = hydrateAtAnchor(anchor, Counter, { n: 11 })
    try {
      expect(stubs.devToolsCalls).toHaveLength(1)
      expect(stubs.hmrRegisterContainerCalls).toEqual([])
      expect(stubs.hmrRegisterAnchorCalls).toEqual([{ name: 'Counter', anchor }])
    } finally {
      handle.dispose()
    }
    expect(stubs.hmrUnregisterCalls).toEqual([{ name: 'Counter' }])
  })

  it('all four paths produce the same number of devtools registrations', () => {
    // Sanity: any future mount path that gets added without
    // devToolsInstall would shift this count and fail the suite.
    const stubs = setup()
    const c1 = document.createElement('div')
    const c2 = document.createElement('div')
    const parent = document.createElement('div')
    const a1 = document.createComment('a1')
    const a2 = document.createComment('a2')
    parent.append(a1, a2)

    const h1 = mountApp(c1, Counter)
    const h2 = mountAtAnchor(a1, Counter)
    const h3 = hydrateApp(c2, Counter, { n: 0 })
    const h4 = hydrateAtAnchor(a2, Counter, { n: 0 })

    try {
      expect(stubs.devToolsCalls).toHaveLength(4)
    } finally {
      h1.dispose()
      h2.dispose()
      h3.dispose()
      h4.dispose()
    }
  })
})
