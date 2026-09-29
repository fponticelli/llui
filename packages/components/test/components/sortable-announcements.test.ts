/**
 * Screen-reader support for the sortable (no pointer, no sight of the list):
 * the machine owns a polite live region announcing every grab, move, drop and
 * cancel with the item's position ("item 2 of 3"), and a hidden instructions
 * part the handle references through `aria-describedby`. The grabbed state is
 * `aria-pressed` on the handle — `aria-grabbed` is deprecated (ARIA 1.1) and
 * has no replacement, and assistive technology never broadly supported it.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { component, div, each, mountApp, provide, span, text } from '@llui/dom'
import {
  connect,
  droppedMove,
  init,
  reorder,
  update,
  type SortableMsg,
  type SortableState,
} from '../../src/components/sortable'
import { LocaleContext, en, type Locale } from '../../src/locale'
import { read, rootSignal } from '../_signal'

const drive = (msgs: readonly SortableMsg[], from: SortableState = init()): SortableState =>
  msgs.reduce((state, msg) => update(state, msg)[0], from)

const grab = (index: number, count = 4): SortableMsg => ({
  type: 'toggleGrab',
  id: `item-${index}`,
  index,
  count,
  container: 'list',
})

describe('sortable announcements (reducer)', () => {
  it('starts with nothing to announce', () => {
    expect(init()).toEqual({ dragging: null, announcement: null })
  })

  it('a keyboard grab announces the item and its position among all items', () => {
    expect(drive([grab(1)]).announcement).toEqual({
      kind: 'grabbed',
      container: 'list',
      id: 'item-1',
      position: 1,
      count: 4,
    })
  })

  it('a pointer grab announces the same way', () => {
    const state = drive([
      { type: 'start', id: 'item-2', index: 2, count: 5, container: 'list', x: 4, y: 8 },
    ])
    expect(state.announcement).toEqual({
      kind: 'grabbed',
      container: 'list',
      id: 'item-2',
      position: 2,
      count: 5,
    })
    expect(state.dragging?.count).toBe(5)
  })

  it('each step of the drop target is announced, and a step that goes nowhere is not', () => {
    const moved = drive([grab(1), { type: 'moveBy', delta: 1 }])
    expect(moved.announcement).toEqual({
      kind: 'moved',
      container: 'list',
      id: 'item-1',
      position: 2,
      count: 4,
    })
    // Past the last slot: the machine clamps to the count it grabbed with.
    const atEnd = drive(
      [
        { type: 'moveBy', delta: 1 },
        { type: 'moveBy', delta: 1 },
      ],
      moved,
    )
    expect(atEnd.dragging?.currentIndex).toBe(3)
    const pastEnd = update(atEnd, { type: 'moveBy', delta: 1 })[0]
    expect(pastEnd).toBe(atEnd)
    // Before the first slot likewise.
    const atStart = drive([grab(0), { type: 'moveBy', delta: -1 }])
    expect(atStart.announcement?.kind).toBe('grabbed')
  })

  it('a pointer move announces a new slot, never a coordinate-only change', () => {
    const grabbed = drive([
      { type: 'start', id: 'item-0', index: 0, count: 3, container: 'list', x: 0, y: 0 },
    ])
    const jiggled = update(grabbed, { type: 'move', index: 0, container: 'list', x: 3, y: 5 })[0]
    expect(jiggled.announcement).toBe(grabbed.announcement)
    const stepped = update(jiggled, { type: 'move', index: 2, container: 'list', x: 3, y: 90 })[0]
    expect(stepped.announcement).toEqual({
      kind: 'moved',
      container: 'list',
      id: 'item-0',
      position: 2,
      count: 3,
    })
  })

  it('a drop announces where the item came from and where it landed', () => {
    const dropped = drive([grab(0), { type: 'moveBy', delta: 2 }, grab(0)])
    expect(dropped.dragging).toBeNull()
    expect(dropped.announcement).toEqual({
      kind: 'dropped',
      container: 'list',
      id: 'item-0',
      from: 0,
      to: 2,
      count: 4,
    })
    const pointerDrop = drive([
      { type: 'start', id: 'item-3', index: 3, count: 4, container: 'list', x: 0, y: 0 },
      { type: 'move', index: 1, container: 'list', x: 0, y: -60 },
      { type: 'drop' },
    ])
    expect(pointerDrop.announcement).toEqual({
      kind: 'dropped',
      container: 'list',
      id: 'item-3',
      from: 3,
      to: 1,
      count: 4,
    })
  })

  it('a cancel announces the item back at the position it was grabbed from', () => {
    const cancelled = drive([grab(2), { type: 'moveBy', delta: -2 }, { type: 'cancel' }])
    expect(cancelled.dragging).toBeNull()
    expect(cancelled.announcement).toEqual({
      kind: 'cancelled',
      container: 'list',
      id: 'item-2',
      position: 2,
      count: 4,
    })
  })

  it('a transfer to another list is left for the consumer to announce', () => {
    const start: SortableMsg = {
      type: 'start',
      id: 'a',
      index: 0,
      count: 2,
      container: 'todo',
      x: 0,
      y: 0,
    }
    const over = drive([start, { type: 'move', index: 1, container: 'done', x: 0, y: 0 }])
    // Hovering the other list keeps the last announcement (its size is unknown here)…
    expect(over.announcement).toEqual(drive([start]).announcement)
    // …and dropping there clears the region instead of naming a wrong position.
    expect(update(over, { type: 'drop' })[0].announcement).toBeNull()
  })

  it('carries a finite count through the finite-number guard', () => {
    const bad = update(init(), {
      type: 'toggleGrab',
      id: 'item-0',
      index: 0,
      count: Number.NaN,
      container: 'list',
    })[0]
    expect(bad).toEqual(init())
  })
})

describe('sortable accessible parts (connect)', () => {
  const state = (partial: Partial<SortableState>): SortableState => ({ ...init(), ...partial })
  const parts = connect(rootSignal<SortableState>(), () => {}, { id: 'list' })
  const named = connect(rootSignal<SortableState>(), () => {}, {
    id: 'list',
    itemLabel: (id) => id.toUpperCase(),
  })

  it('exposes a polite, atomic status region owned by the machine', () => {
    const { text: liveText, ...attrs } = parts.liveRegion
    expect(attrs).toEqual({
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      'data-scope': 'sortable',
      'data-part': 'live-region',
    })
    expect(read(liveText, init())).toBe('')
  })

  it.each([
    [
      { kind: 'grabbed', container: 'list', id: 'b', position: 1, count: 3 } as const,
      'Picked up item 2 of 3.',
      'Picked up B, item 2 of 3.',
    ],
    [
      { kind: 'moved', container: 'list', id: 'b', position: 2, count: 3 } as const,
      'Moved to position 3 of 3.',
      'B moved to position 3 of 3.',
    ],
    [
      { kind: 'dropped', container: 'list', id: 'b', from: 1, to: 2, count: 3 } as const,
      'Dropped. Moved from position 2 to position 3 of 3.',
      'Dropped B. Moved from position 2 to position 3 of 3.',
    ],
    [
      { kind: 'dropped', container: 'list', id: 'b', from: 1, to: 1, count: 3 } as const,
      'Dropped at its original position, 2 of 3.',
      'Dropped B at its original position, 2 of 3.',
    ],
    [
      { kind: 'cancelled', container: 'list', id: 'b', position: 1, count: 3 } as const,
      'Reorder cancelled. The item returned to position 2 of 3.',
      'Reorder cancelled. B returned to position 2 of 3.',
    ],
  ])(
    'announces %j in English, with and without an item label',
    (announcement, plain, withLabel) => {
      expect(read(parts.liveRegion.text, state({ announcement }))).toBe(plain)
      expect(read(named.liveRegion.text, state({ announcement }))).toBe(withLabel)
    },
  )

  it('names the instructions only when they are rendered (hasInstructions)', () => {
    // Default: the consumer renders the part, so every handle references it.
    expect(parts.handle('b', 1)['aria-describedby']).toBe('list:instructions')
    const explicit = connect(rootSignal<SortableState>(), () => {}, {
      id: 'list',
      hasInstructions: true,
    })
    expect(explicit.handle('b', 1)['aria-describedby']).toBe('list:instructions')
    // Opted out: no handle names an element that does not exist.
    const without = connect(rootSignal<SortableState>(), () => {}, {
      id: 'list',
      hasInstructions: false,
    })
    const handle = without.handle('b', 1)
    expect(handle['aria-describedby']).toBeUndefined()
    // Nothing else about the handle changes.
    expect(handle['aria-label']).toBe('Drag handle')
    expect(handle.role).toBe('button')
  })

  it('stays silent for an announcement another container owns', () => {
    const other = connect(rootSignal<SortableState>(), () => {}, { id: 'other' })
    const announcement = {
      kind: 'grabbed',
      container: 'list',
      id: 'b',
      position: 1,
      count: 3,
    } as const
    expect(read(other.liveRegion.text, state({ announcement }))).toBe('')
    expect(read(parts.liveRegion.text, state({ announcement }))).not.toBe('')
  })

  it('describes the handle with hidden instructions and reports the grab as aria-pressed', () => {
    const { text: instructions, ...attrs } = parts.instructions
    expect(attrs).toEqual({
      id: 'list:instructions',
      hidden: true,
      'data-scope': 'sortable',
      'data-part': 'instructions',
    })
    expect(instructions).toBe(en.sortable.instructions)

    const handle = parts.handle('b', 1)
    expect(handle['aria-describedby']).toBe('list:instructions')
    expect(handle['aria-label']).toBe('Drag handle')
    expect(named.handle('b', 1)['aria-label']).toBe('Drag handle for B')
    expect('aria-grabbed' in handle).toBe(false)
    const grabbed = state({
      dragging: {
        id: 'b',
        startIndex: 1,
        currentIndex: 1,
        count: 3,
        fromContainer: 'list',
        toContainer: 'list',
        startX: 0,
        startY: 0,
        currentX: 0,
        currentY: 0,
      },
    })
    expect(read(handle['aria-pressed'], grabbed)).toBe(true)
    expect(read(parts.handle('c', 2)['aria-pressed'], grabbed)).toBe(false)
    expect(read(handle['aria-pressed'], init())).toBe(false)
  })
})

describe('a keyboard reorder, as a screen reader hears it', () => {
  let app: ReturnType<typeof mountApp> | null = null
  afterEach(() => {
    app?.dispose()
    app = null
    document.body.innerHTML = ''
  })

  interface Ctx {
    items: string[]
    sort: SortableState
  }
  type Msg = { type: 'sort'; msg: SortableMsg }

  function mount(
    items: string[],
    { locale, hasInstructions }: { locale?: Locale; hasInstructions?: boolean } = {},
  ): HTMLElement {
    const def = component<Ctx, Msg>({
      name: 'AnnouncedSortable',
      init: () => ({ items, sort: init() }),
      update: (state, msg) => {
        const moved = droppedMove(state.sort, msg.msg)
        const [sort] = update(state.sort, msg.msg)
        return {
          items: moved === null ? state.items : reorder(state.items, moved.from, moved.to),
          sort,
        }
      },
      view: ({ state, send }) => {
        const build = () => {
          const parts = connect(state.at('sort'), (m) => send({ type: 'sort', msg: m }), {
            id: 'list',
            itemLabel: (id) => id,
            ...(hasInstructions === undefined ? {} : { hasInstructions }),
          })
          const { text: liveText, ...liveAttrs } = parts.liveRegion
          const { text: instructions, ...instructionAttrs } = parts.instructions
          return [
            div({ ...parts.root }, [
              each(state.at('items'), {
                key: (item) => item,
                render: (item, index) => {
                  const id = item.peek()
                  const at = index.peek()
                  return [
                    div({ ...parts.item(id, at) }, [
                      div({ ...parts.handle(id, at) }, [text('⋮')]),
                      span([text(item)]),
                    ]),
                  ]
                },
              }),
            ]),
            div({ ...liveAttrs }, [text(liveText)]),
            // A consumer that opts out does not render the part at all.
            ...(hasInstructions === false
              ? []
              : [div({ ...instructionAttrs }, [text(instructions)])]),
          ]
        }
        return locale === undefined ? build() : [provide(LocaleContext, locale, build)]
      },
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    app = mountApp(host, def)
    return host
  }

  const handleOf = (host: HTMLElement, label: string): HTMLElement =>
    Array.from(host.querySelectorAll<HTMLElement>('[data-part="item"]'))
      .find((element) => element.textContent?.includes(label))!
      .querySelector<HTMLElement>('[data-part="handle"]')!
  const key = (element: HTMLElement, name: string): void => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }))
  }
  const heard = (host: HTMLElement): string =>
    host.querySelector('[data-part="live-region"]')!.textContent ?? ''

  it('announces the grab, every move, the drop and a cancel', () => {
    const host = mount(['Apple', 'Banana', 'Cherry'])
    const instructions = host.querySelector<HTMLElement>('[data-part="instructions"]')!
    const handle = handleOf(host, 'Apple')
    // The description resolves to a real, hidden element.
    expect(document.getElementById(handle.getAttribute('aria-describedby')!)).toBe(instructions)
    expect(instructions.hidden).toBe(true)
    expect(instructions.textContent).toBe(en.sortable.instructions)
    expect(heard(host)).toBe('')

    key(handle, ' ')
    expect(handle.getAttribute('aria-pressed')).toBe('true')
    expect(heard(host)).toBe('Picked up Apple, item 1 of 3.')
    key(handle, 'ArrowDown')
    expect(heard(host)).toBe('Apple moved to position 2 of 3.')
    key(handle, 'ArrowDown')
    expect(heard(host)).toBe('Apple moved to position 3 of 3.')
    key(handle, 'Enter')
    expect(heard(host)).toBe('Dropped Apple. Moved from position 1 to position 3 of 3.')
    expect(handleOf(host, 'Apple').getAttribute('aria-pressed')).toBe('false')

    const banana = handleOf(host, 'Banana')
    key(banana, ' ')
    expect(heard(host)).toBe('Picked up Banana, item 1 of 3.')
    key(banana, 'ArrowDown')
    key(banana, 'Escape')
    expect(heard(host)).toBe('Reorder cancelled. Banana returned to position 1 of 3.')
  })

  it('without rendered instructions, no handle references a missing element', () => {
    const host = mount(['Apple', 'Banana', 'Cherry'], { hasInstructions: false })
    expect(host.querySelector('[data-part="instructions"]')).toBeNull()
    const handles = [...host.querySelectorAll<HTMLElement>('[data-part="handle"]')]
    expect(handles).toHaveLength(3)
    for (const handle of handles) expect(handle.hasAttribute('aria-describedby')).toBe(false)
    // Every idref left in the subtree resolves.
    for (const element of host.querySelectorAll('[aria-describedby],[aria-labelledby]')) {
      for (const name of ['aria-describedby', 'aria-labelledby']) {
        for (const id of (element.getAttribute(name) ?? '').split(/\s+/).filter(Boolean)) {
          expect(document.getElementById(id), `${name}=${id}`).not.toBeNull()
        }
      }
    }
    // The announcements are unaffected.
    key(handles[0]!, ' ')
    expect(heard(host)).toBe('Picked up Apple, item 1 of 3.')
  })

  it('speaks the provided locale', () => {
    const spanish: Locale = {
      ...en,
      sortable: {
        handle: (item) => (item === undefined ? 'Asa' : `Asa de ${item}`),
        instructions: 'Pulsa espacio para tomar el elemento.',
        grabbed: (item, position, count) => `Tomado ${item ?? ''} ${position}/${count}`,
        moved: (item, position, count) => `Movido ${item ?? ''} ${position}/${count}`,
        dropped: (item, from, to, count) => `Soltado ${item ?? ''} ${from}->${to}/${count}`,
        cancelled: (item, position, count) => `Cancelado ${item ?? ''} ${position}/${count}`,
      },
    }
    const host = mount(['Apple', 'Banana'], { locale: spanish })
    const handle = handleOf(host, 'Banana')
    expect(handle.getAttribute('aria-label')).toBe('Asa de Banana')
    expect(host.querySelector('[data-part="instructions"]')!.textContent).toBe(
      'Pulsa espacio para tomar el elemento.',
    )
    key(handle, ' ')
    expect(heard(host)).toBe('Tomado Banana 2/2')
    key(handle, 'ArrowUp')
    expect(heard(host)).toBe('Movido Banana 1/2')
    key(handle, ' ')
    expect(heard(host)).toBe('Soltado Banana 2->1/2')
  })
})
