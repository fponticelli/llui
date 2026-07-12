import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  mountSignalComponent,
  normalizeUpdateResult,
  type SignalComponentDef,
} from '../../src/signals/component'
import { renderToString, renderNodes } from '../../src/signals/ssr'
import { el, signalShow, signalLazy, react } from '../../src/signals/dom'
import { collectHeadSink, HEAD_SINK, style, script } from '../../src/signals/head'
import { component, span, ul, li, text, each } from '../../src/signals/authoring'

// ── Finding 3: SSR serializer must not escape raw-text element content ──
describe('finding 3 — SSR raw-text elements (style/script) serialize verbatim', () => {
  it('round-trips inline <style>/<script> content uncorrupted', () => {
    const def: SignalComponentDef<{ x: number }, never> = {
      init: () => ({ x: 0 }),
      update: (s) => s,
      view: () => [
        el('style', {}, ['a > b { color: red }']),
        el('script', {}, ['if (a && b) x()']),
      ],
    }
    const html = renderToString(def, undefined, document)
    expect(html).toContain('<style>a > b { color: red }</style>')
    expect(html).toContain('<script>if (a && b) x()</script>')
    // NOT html-escaped
    expect(html).not.toContain('&gt;')
    expect(html).not.toContain('&amp;&amp;')
  })

  it('neutralizes a literal </script> close sequence in raw text', () => {
    const def: SignalComponentDef<{ x: number }, never> = {
      init: () => ({ x: 0 }),
      update: (s) => s,
      view: () => [el('script', {}, ['var s = "</script>"'])],
    }
    const html = renderToString(def, undefined, document)
    expect(html).toContain('<\\/script>') // guarded, doesn't close early
    expect(html).toContain('</script>') // the real closing tag is still present
  })

  it('serializes a custom on-* attribute but drops a real inline handler attr', () => {
    const def: SignalComponentDef<{ x: number }, never> = {
      init: () => ({ x: 0 }),
      update: (s) => s,
      // `on-theme` is a custom attribute (not an event handler); `onclick` set as a
      // static string is a genuine inline-handler attribute slot.
      view: () => [el('div', { 'on-theme': 'dark', onclick: 'boom()' }, [])],
    }
    const html = renderToString(def, undefined, document)
    expect(html).toContain('on-theme="dark"')
    expect(html).not.toContain('onclick')
  })
})

// ── Finding 6: shared normalizeUpdateResult, exported, behavior preserved ──
describe('finding 6 — normalizeUpdateResult', () => {
  it('is exported from the package surface and preserves the heuristic', () => {
    expect(normalizeUpdateResult(5)).toEqual([5, []])
    expect(normalizeUpdateResult([5, []])).toEqual([5, []])
    expect(normalizeUpdateResult([5, [{ type: 'fx' }]])).toEqual([5, [{ type: 'fx' }]])
    // bare-S object return
    expect(normalizeUpdateResult({ a: 1 })).toEqual([{ a: 1 }, []])
    // a 2-tuple state whose 2nd elem is NOT an array is a bare state
    expect(normalizeUpdateResult([1, 2] as unknown)).toEqual([[1, 2], []])
  })
})

// ── Finding 2: anon head dedup keys deterministic per render + hydration adopt ──
describe('finding 2 — anonymous head keys are per-render deterministic', () => {
  const headEl = (): HTMLHeadElement => document.head
  afterEach(() => {
    for (const e of Array.from(headEl().querySelectorAll('[data-llui-head]'))) e.remove()
  })

  function collectHead<S>(def: SignalComponentDef<S, never>): string {
    const sink = collectHeadSink()
    const contexts = new Map<symbol, unknown>([[HEAD_SINK.id, sink]])
    const { dispose } = renderNodes(def, undefined, document, contexts)
    const out = sink.serialize(document)
    dispose()
    return out.head
  }

  it('two sequential renders produce identical anon head keys', () => {
    const def: SignalComponentDef<{ x: number }, never> = {
      init: () => ({ x: 0 }),
      update: (s) => s,
      view: () => [style('a { b: c }'), script({}, 'x()')],
    }
    const first = collectHead(def)
    const second = collectHead(def)
    expect(first).toContain('data-llui-head="style:#1"')
    expect(first).toContain('data-llui-head="script:#2"')
    // A module-global counter would drift to style:#3 / script:#4 here.
    expect(second).toBe(first)
  })

  it('client hydrate adopts a server anon <style> by its stable key (no duplicate)', () => {
    // Simulate the server tag emitted with the per-render key.
    const server = document.createElement('style')
    server.setAttribute('data-llui-head', 'style:#1')
    server.textContent = 'x{}'
    headEl().appendChild(server)

    const container = document.createElement('div')
    const h = mountSignalComponent<{ x: number }, never>(container, {
      init: () => ({ x: 0 }),
      update: (s) => s,
      view: () => [style('body { margin: 0 }')],
    })
    // The client render computes the SAME anon key (style:#1) and adopts the marked
    // server tag rather than appending a second one.
    expect(headEl().querySelectorAll('[data-llui-head="style:#1"]').length).toBe(1)
    h.dispose()
  })
})

// ── Finding 4: send()/batch() after dispose() are no-ops; cleanups still run ──
describe('finding 4 — after-dispose guards', () => {
  it('send() after dispose is a no-op (no reducer, no commit) and cleanup ran', () => {
    let cleanupRan = false
    type M = { type: 'inc' }
    const h = mountSignalComponent<number, M, { type: 'sub' }>(document.createElement('div'), {
      init: () => [0, [{ type: 'sub' }]],
      update: (s, m) => (m.type === 'inc' ? s + 1 : s),
      onEffect: (e) => (e.type === 'sub' ? () => (cleanupRan = true) : undefined),
      view: () => [],
    })
    expect(h.getState()).toBe(0)
    h.dispose()
    expect(cleanupRan).toBe(true) // the in-flight subscription's cleanup ran on dispose
    h.send({ type: 'inc' })
    expect(h.getState()).toBe(0) // reducer never ran — no-op after dispose
  })
})

// ── Finding 11: initialState presence check keeps a legit falsy seed ──
describe('finding 11 — initialState presence check', () => {
  it('respects an explicit null initialState instead of falling back to init()', () => {
    const h = mountSignalComponent<{ v: number } | null, never>(
      document.createElement('div'),
      {
        init: () => ({ v: 1 }),
        update: (s) => s,
        view: () => [],
      },
      { initialState: null },
    )
    expect(h.getState()).toBeNull()
    h.dispose()
  })
})

// ── Finding 12: per-mount AbortSignal ──
describe('finding 12 — per-mount lifecycle AbortSignal', () => {
  const def: SignalComponentDef<number, never, { type: 'boot' }> = {
    init: () => [0, [{ type: 'boot' }]],
    update: (s) => s,
    onEffect: (_e, api) => {
      captured.push(api.signal)
    },
    view: () => [],
  }
  const captured: AbortSignal[] = []
  afterEach(() => (captured.length = 0))

  it('two concurrent mounts get distinct signals; disposing one leaves the other', () => {
    const a = mountSignalComponent(document.createElement('div'), def)
    const b = mountSignalComponent(document.createElement('div'), def)
    expect(captured.length).toBe(2)
    const [sa, sb] = captured
    expect(sa).not.toBe(sb)
    expect(sa!.aborted).toBe(false)
    expect(sb!.aborted).toBe(false)
    a.dispose()
    expect(sa!.aborted).toBe(true)
    expect(sb!.aborted).toBe(false) // disposing one mount does NOT abort the other
    b.dispose()
    expect(sb!.aborted).toBe(true)
  })
})

// ── Finding 5: component field literally named `state` inside an each row ──
describe('finding 5 — row-ctx namespace is collision-proof', () => {
  interface S {
    state: string // a top-level field named `state`
    rows: readonly { id: string; label: string }[]
  }
  it('renders a component field named `state` correctly inside an each row', () => {
    const container = document.createElement('div')
    const app = component<S, { type: 'x' }>({
      init: () => ({ state: 'GLOBAL', rows: [{ id: 'a', label: 'A' }] }),
      update: (s) => s,
      view: ({ state }) => [
        ul([
          each(
            state.map((s) => s.rows),
            {
              key: (r) => r.id,
              // reads BOTH the row item AND the component field named `state`
              render: (item) => [
                li([
                  span([text(item.at('label'))]),
                  span({ class: 'g' }, [text(state.at('state'))]),
                ]),
              ],
            },
          ),
        ]),
      ],
    })
    const h = mountSignalComponent(container, app)
    expect(container.querySelector('li span:first-child')!.textContent).toBe('A')
    // Would render the whole state object (or empty) under the string-prefix bug.
    expect(container.querySelector('.g')!.textContent).toBe('GLOBAL')
    h.dispose()
  })
})

// ── Finding 13: insert-before-mount ordering (option selected inside a show arm) ──
describe('finding 13 — show arm inserts nodes before mounting bindings', () => {
  it('commits a reactive <select value> once the arm nodes are attached', () => {
    interface S {
      open: boolean
      value: string
    }
    const container = document.createElement('div')
    const app: SignalComponentDef<S, never> = {
      init: () => ({ open: true, value: 'b' }),
      update: (s) => s,
      view: () => [
        signalShow({ produce: (s) => (s as S).open, deps: ['open'] }, () => [
          el('select', { value: react((s) => (s as S).value, ['value']) }, [
            el('option', { value: 'a' }, ['a']),
            el('option', { value: 'b' }, ['b']),
          ]),
        ]),
      ],
    }
    const h = mountSignalComponent(container, app)
    const sel = container.querySelector('select') as HTMLSelectElement
    // The `value` binding must commit against the attached <select> (with options
    // present); committing on a detached node would silently drop to option 'a'.
    expect(sel.value).toBe('b')
    h.dispose()
  })
})

// ── Finding 8: lazy skips the loader under SSR ──
describe('finding 8 — signalLazy under SSR', () => {
  it('does not invoke the loader during a server render (bare anchor)', () => {
    const loader = vi.fn(() => Promise.resolve({} as never))
    const def: SignalComponentDef<{ x: number }, never> = {
      init: () => ({ x: 0 }),
      update: (s) => s,
      view: () => [signalLazy({ loader, fallback: () => [el('div', {}, ['loading'])] })],
    }
    const html = renderToString(def, undefined, document)
    expect(loader).not.toHaveBeenCalled()
    // fallback is not rendered server-side either (bare anchor, mirrors subApp)
    expect(html).not.toContain('loading')
  })
})

// ── Finding 9: duplicate each keys throw in dev ──
describe('finding 9 — duplicate each keys throw in dev', () => {
  it('throws with the offending key + deps when two rows share a key', () => {
    const container = document.createElement('div')
    const app = component<{ rows: readonly { id: string }[] }, { type: 'x' }>({
      init: () => ({ rows: [{ id: 'dup' }, { id: 'dup' }] }),
      update: (s) => s,
      view: ({ state }) => [
        ul([
          each(
            state.map((s) => s.rows),
            { key: (r) => r.id, render: (item) => [li([text(item.at('id'))])] },
          ),
        ]),
      ],
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => mountSignalComponent(container, app)).toThrow(/duplicate key "dup"/)
    errSpy.mockRestore()
  })
})

// ── Finding 10: devtools setState routes through the commit + subscriber path ──
describe('finding 10 — devtools setState notifies subscribers', () => {
  it('notifies subscribers when devtools setState pokes state', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<number, { type: 'inc' }>(container, {
      init: () => 0,
      update: (s) => s + 1,
      view: () => [],
    })
    const seen: number[] = []
    h.subscribe((s) => seen.push(s))
    // Reach the debug hook the way the relay does: `restoreState` → hooks.setState.
    const api = (globalThis as { __lluiDebug?: { restoreState(s: unknown): void } }).__lluiDebug
    expect(api).toBeDefined()
    api!.restoreState(42)
    expect(seen).toContain(42) // routed through the commit + subscriber path
    h.dispose()
  })
})
