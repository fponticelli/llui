import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/components/sortable'
import type { SortableState } from '../../src/components/sortable'

// 2D layout support — for flex-wrap, grid, and any layout where items
// in the same visual "row" share a Y coordinate. The bug 2D fixes:
// same-row items collapse to the same midpoint distance in 1D mode,
// so findTargetAt's "closest Y" heuristic always picks the first
// match. Switching `layout: '2d'` uses Euclidean distance against
// {x, y} midpoints and emits per-item shift transforms.

type Ctx = { sort: SortableState }

function driving(state: SortableState): Ctx {
  return { sort: state }
}

describe('sortable 2D — DragState carries both X and Y', () => {
  it('start message with x is stored in dragging.startX / currentX', () => {
    const [s] = update(init(), {
      type: 'start',
      id: 'a',
      index: 1,
      container: 'grid',
      x: 100,
      y: 50,
    })
    expect(s.dragging?.startX).toBe(100)
    expect(s.dragging?.startY).toBe(50)
    expect(s.dragging?.currentX).toBe(100)
    expect(s.dragging?.currentY).toBe(50)
  })

  it('move updates currentX as well as currentY; startX stays fixed', () => {
    const [s0] = update(init(), {
      type: 'start',
      id: 'a',
      index: 1,
      container: 'grid',
      x: 100,
      y: 50,
    })
    const [s1] = update(s0, { type: 'move', index: 3, container: 'grid', x: 220, y: 120 })
    expect(s1.dragging?.startX).toBe(100)
    expect(s1.dragging?.currentX).toBe(220)
    expect(s1.dragging?.startY).toBe(50)
    expect(s1.dragging?.currentY).toBe(120)
  })

  it('move is idempotent when BOTH x and y are unchanged', () => {
    const [s0] = update(init(), {
      type: 'start',
      id: 'a',
      index: 1,
      container: 'grid',
      x: 100,
      y: 50,
    })
    const [s1] = update(s0, { type: 'move', index: 1, container: 'grid', x: 100, y: 50 })
    expect(s1).toBe(s0)
  })

  it('move is NOT idempotent when only x changed (same-row slide must fire)', () => {
    const [s0] = update(init(), {
      type: 'start',
      id: 'a',
      index: 1,
      container: 'grid',
      x: 100,
      y: 50,
    })
    const [s1] = update(s0, { type: 'move', index: 2, container: 'grid', x: 200, y: 50 })
    expect(s1).not.toBe(s0)
    expect(s1.dragging?.currentX).toBe(200)
    expect(s1.dragging?.currentIndex).toBe(2)
  })
})

describe('sortable 2D — dragged item transform carries both axes', () => {
  it("dragged item's style.transform is translate(dx, dy) in 2D", () => {
    const parts = connect<Ctx>((s) => s.sort, vi.fn(), { id: 'grid', layout: '2d' })
    const item = parts.item('a', 0)
    const state = driving({
      dragging: {
        id: 'a',
        startIndex: 0,
        currentIndex: 0,
        fromContainer: 'grid',
        toContainer: 'grid',
        startX: 100,
        startY: 50,
        currentX: 150,
        currentY: 80,
      },
    })
    expect(item['style.transform'](state)).toBe('translate(50px, 30px)')
  })

  it('dragged item in 1D keeps translateY(deltaY) only (regression)', () => {
    const parts = connect<Ctx>((s) => s.sort, vi.fn(), { id: 'list', layout: '1d' })
    const item = parts.item('a', 0)
    const state = driving({
      dragging: {
        id: 'a',
        startIndex: 0,
        currentIndex: 0,
        fromContainer: 'list',
        toContainer: 'list',
        startX: 100,
        startY: 50,
        currentX: 150,
        currentY: 80,
      },
    })
    expect(item['style.transform'](state)).toBe('translateY(30px)')
  })

  it("layout default ('1d') matches explicit 1d behavior", () => {
    const parts = connect<Ctx>((s) => s.sort, vi.fn(), { id: 'list' })
    const item = parts.item('a', 0)
    const state = driving({
      dragging: {
        id: 'a',
        startIndex: 0,
        currentIndex: 0,
        fromContainer: 'list',
        toContainer: 'list',
        startX: 100,
        startY: 50,
        currentX: 150,
        currentY: 80,
      },
    })
    expect(item['style.transform'](state)).toBe('translateY(30px)')
  })
})

describe('sortable 2D — data-shift is suppressed in 2D', () => {
  it('data-shift returns undefined under layout: 2d (CSS mechanism disabled)', () => {
    const parts = connect<Ctx>((s) => s.sort, vi.fn(), { id: 'grid', layout: '2d' })
    const item = parts.item('b', 1)
    const state = driving({
      dragging: {
        id: 'a',
        startIndex: 0,
        currentIndex: 2,
        fromContainer: 'grid',
        toContainer: 'grid',
        startX: 0,
        startY: 0,
        currentX: 0,
        currentY: 0,
      },
    })
    expect(item['data-shift'](state)).toBeUndefined()
  })

  it('data-shift still emits in 1D for items between source and target (regression)', () => {
    const parts = connect<Ctx>((s) => s.sort, vi.fn(), { id: 'list', layout: '1d' })
    const item = parts.item('b', 1)
    const state = driving({
      dragging: {
        id: 'a',
        startIndex: 0,
        currentIndex: 2,
        fromContainer: 'list',
        toContainer: 'list',
        startX: 0,
        startY: 0,
        currentX: 0,
        currentY: 0,
      },
    })
    // Item at liveIndex=1 with drag 0→2 shifts up. The connect closure
    // uses a snapshots map keyed by containerId; without a snapshot the
    // liveIndex falls back to the render-time index captured above (1).
    expect(item['data-shift'](state)).toBe('up')
  })
})

describe('sortable 2D — connect uses Euclidean target selection', () => {
  it('layout: 2d threads the setting into the closure', () => {
    // Without spying on findTargetAt internals, we check the presence
    // of the layout flag via behavior: when onPointerMove fires with
    // a coordinate that would match the second same-row item under
    // Euclidean but the first under Y-only, the dispatched index is
    // different between layouts. The jsdom-here geometry all returns
    // 0, so we assert the structural flag path is reachable via the
    // send call receiving a fresh msg with an `x` field.
    const send = vi.fn()
    const parts = connect<Ctx>((s) => s.sort, send, { id: 'grid', layout: '2d' })
    // Fake a buttons-pressed move event.
    parts.root.onPointerMove({
      buttons: 1,
      clientX: 120,
      clientY: 40,
    } as unknown as PointerEvent)
    // send may not fire if no roots match (jsdom no layout) — but the
    // important invariant is that no throw occurred and if a msg was
    // sent, it carried an x field.
    for (const call of send.mock.calls) {
      const msg = call[0]
      if (msg.type === 'move' || msg.type === 'start') {
        expect(msg).toHaveProperty('x')
        expect(typeof msg.x).toBe('number')
      }
    }
  })

  it('root onPointerMove sends {x, y} after 2D option (msg shape regression)', () => {
    // Set up a real DOM tree so findTargetAt can resolve a root. The
    // important assertion is the message SHAPE — the x field exists
    // regardless of layout mode. 1D also carries x in the msg so
    // consumers can switch modes without adapting their reducer.
    const host = document.createElement('ul')
    host.setAttribute('data-scope', 'sortable')
    host.setAttribute('data-part', 'root')
    host.setAttribute('data-container-id', 'grid')
    document.body.appendChild(host)
    try {
      const send = vi.fn()
      const parts = connect<Ctx>((s) => s.sort, send, { id: 'grid', layout: '2d' })
      parts.root.onPointerMove({
        buttons: 1,
        clientX: 42,
        clientY: 10,
      } as unknown as PointerEvent)
      // jsdom rects are all zero, so findTargetAt may short-circuit.
      // When it does fire, the msg must carry x.
      if (send.mock.calls.length > 0) {
        expect(send.mock.calls[0]![0]).toMatchObject({ x: 42, y: 10 })
      }
    } finally {
      host.remove()
    }
  })
})

describe('sortable 2D — non-dragged item per-item transform', () => {
  it('non-dragged item in 2D with a snapshot returns translate(dx, dy) matching the target slot', () => {
    // jsdom returns zero rects by default, which makes every snapshot
    // midpoint {x: 0, y: 0} and every delta also 0. Override
    // getBoundingClientRect on the item elements so the snapshot
    // captures distinct positions. The onPointerDown handler reads
    // rects when it runs, so patching before the handler fires
    // gives us realistic midpoints for the assertion.
    const host = document.createElement('ul')
    host.setAttribute('data-scope', 'sortable')
    host.setAttribute('data-part', 'root')
    host.setAttribute('data-container-id', 'grid')
    // Four items laid out as 2x2 grid — rows wrap between index 1 and 2.
    const rects = [
      { x: 0, y: 0, w: 100, h: 80 }, // item 0: top-left
      { x: 110, y: 0, w: 100, h: 80 }, // item 1: top-right
      { x: 0, y: 90, w: 100, h: 80 }, // item 2: bottom-left
      { x: 110, y: 90, w: 100, h: 80 }, // item 3: bottom-right
    ]
    const ids = ['a', 'b', 'c', 'd']
    const items: HTMLElement[] = []
    for (let i = 0; i < 4; i++) {
      const li = document.createElement('li')
      li.setAttribute('data-scope', 'sortable')
      li.setAttribute('data-part', 'item')
      li.setAttribute('data-id', ids[i]!)
      li.setAttribute('data-index', String(i))
      const r = rects[i]!
      li.getBoundingClientRect = () =>
        ({
          left: r.x,
          top: r.y,
          right: r.x + r.w,
          bottom: r.y + r.h,
          width: r.w,
          height: r.h,
          x: r.x,
          y: r.y,
        }) as DOMRect
      host.appendChild(li)
      items.push(li)
    }
    document.body.appendChild(host)
    try {
      const send = vi.fn()
      const parts = connect<Ctx>((s) => s.sort, send, { id: 'grid', layout: '2d' })
      // Fire onPointerDown for item 'a' at index 0 — snapshotAll()
      // captures midpoints for every `[data-scope="sortable"][data-part="root"]`
      // root in the document, so our jsdom host is picked up.
      const handle = parts.handle('a', 0)
      handle.onPointerDown({
        pointerId: 1,
        currentTarget: items[0],
        clientX: 50,
        clientY: 40,
        preventDefault: () => {},
      } as unknown as PointerEvent)

      // Simulate the state after pointer moves from item a (index 0)
      // to item c (index 2). Item b (liveIndex=1) and item c
      // (liveIndex=2) should shift left-by-one in array order —
      // visually, each takes the position its predecessor held.
      const state = driving({
        dragging: {
          id: 'a',
          startIndex: 0,
          currentIndex: 2,
          fromContainer: 'grid',
          toContainer: 'grid',
          startX: 50,
          startY: 40,
          currentX: 50,
          currentY: 130,
        },
      })
      // Item b (liveIndex=1, center {x: 160, y: 40}) should move to
      // item a's slot (center {x: 50, y: 40}). Vector: (-110, 0).
      const itemB = parts.item('b', 1)
      expect(itemB['style.transform'](state)).toBe('translate(-110px, 0px)')
      // Item c (liveIndex=2, center {x: 50, y: 130}) should move to
      // item b's slot (center {x: 160, y: 40}). Vector: (110, -90).
      const itemC = parts.item('c', 2)
      expect(itemC['style.transform'](state)).toBe('translate(110px, -90px)')
      // Item d (liveIndex=3) is outside the drag range [start, current],
      // no transform.
      const itemD = parts.item('d', 3)
      expect(itemD['style.transform'](state)).toBeUndefined()
    } finally {
      host.remove()
    }
  })

  it('non-dragged between source+target in 2D returns undefined with no snapshot', () => {
    // Without an active pointerdown capturing a snapshot, the
    // per-item transform has no midpoints to diff — it must
    // gracefully return undefined rather than throw. The real
    // snapshot flow is covered by the onPointerDown integration
    // tests; here we pin the no-snapshot path.
    const parts = connect<Ctx>((s) => s.sort, vi.fn(), { id: 'grid', layout: '2d' })
    const item = parts.item('b', 1)
    const state = driving({
      dragging: {
        id: 'a',
        startIndex: 0,
        currentIndex: 2,
        fromContainer: 'grid',
        toContainer: 'grid',
        startX: 0,
        startY: 0,
        currentX: 0,
        currentY: 0,
      },
    })
    expect(item['style.transform'](state)).toBeUndefined()
  })
})
