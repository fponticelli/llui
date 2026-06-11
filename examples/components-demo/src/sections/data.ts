import {
  div,
  button,
  span,
  h3,
  img,
  svg,
  path,
  text,
  table as tableEl,
  thead,
  tbody,
  tr,
  th,
  td,
  ul,
  li,
  each,
  onMount,
} from '@llui/dom'
import type { Send, Signal, Mountable } from '@llui/dom'
import { tabs } from '@llui/components/tabs'
import { accordion } from '@llui/components/accordion'
import { collapsible } from '@llui/components/collapsible'
import { pagination } from '@llui/components/pagination'
import { steps } from '@llui/components/steps'
import { carousel } from '@llui/components/carousel'
import { avatar } from '@llui/components/avatar'
import { treeView } from '@llui/components/tree-view'
import { listbox } from '@llui/components/listbox'
import { table } from '@llui/components/table'
import { sortable } from '@llui/components/sortable'
import { dataTable } from '@llui/components/patterns/data-table'
import type { DataTableEffect, DataTableMsg } from '@llui/components/patterns/data-table'
import { sectionGroup, card } from '../shared/ui'
import {
  composeModules,
  mergeHandlers,
  type ModulesState,
  type ModulesMsg,
} from '../shared/modules'

// ── Demo dataset for the `table` card (data lives in the consumer; the
// machine only tracks row IDs in display order). ─────────────────────────
interface Person {
  id: string
  name: string
  role: string
  status: string
}

const tableRows: Person[] = [
  { id: 'u1', name: 'Ada Lovelace', role: 'Engineer', status: 'Active' },
  { id: 'u2', name: 'Alan Turing', role: 'Architect', status: 'Active' },
  { id: 'u3', name: 'Grace Hopper', role: 'Manager', status: 'Away' },
  { id: 'u4', name: 'Linus Torvalds', role: 'Engineer', status: 'Active' },
  { id: 'u5', name: 'Margaret Hamilton', role: 'Lead', status: 'Active' },
]

const tableColumns = [
  { id: 'name', sortable: true },
  { id: 'role', sortable: true },
  { id: 'status', sortable: false },
]

// ── Sortable list initial order. The consumer owns the array; the machine
// only tracks the drag. We reorder `order` on `drop`. ────────────────────
const sortableInitial = ['Inbox', 'Drafts', 'Sent', 'Archive', 'Trash']

// ── In-memory dataset for the data-table pattern (the effect contract:
// the LoadPage effect is resolved against this slice). ───────────────────
const dtData: Person[] = [
  { id: 'd01', name: 'Ada Lovelace', role: 'Engineer', status: 'Active' },
  { id: 'd02', name: 'Alan Turing', role: 'Architect', status: 'Active' },
  { id: 'd03', name: 'Grace Hopper', role: 'Manager', status: 'Away' },
  { id: 'd04', name: 'Linus Torvalds', role: 'Engineer', status: 'Active' },
  { id: 'd05', name: 'Margaret Hamilton', role: 'Lead', status: 'Active' },
  { id: 'd06', name: 'Barbara Liskov', role: 'Researcher', status: 'Active' },
  { id: 'd07', name: 'Donald Knuth', role: 'Author', status: 'Away' },
  { id: 'd08', name: 'Edsger Dijkstra', role: 'Theorist', status: 'Active' },
  { id: 'd09', name: 'Ken Thompson', role: 'Engineer', status: 'Active' },
  { id: 'd10', name: 'Dennis Ritchie', role: 'Engineer', status: 'Active' },
  { id: 'd11', name: 'John McCarthy', role: 'Researcher', status: 'Away' },
  { id: 'd12', name: 'Tim Berners-Lee', role: 'Architect', status: 'Active' },
  { id: 'd13', name: 'Vint Cerf', role: 'Architect', status: 'Active' },
  { id: 'd14', name: 'Bjarne Stroustrup', role: 'Author', status: 'Active' },
  { id: 'd15', name: 'James Gosling', role: 'Engineer', status: 'Away' },
  { id: 'd16', name: 'Guido van Rossum', role: 'Engineer', status: 'Active' },
  { id: 'd17', name: 'Brendan Eich', role: 'Engineer', status: 'Active' },
  { id: 'd18', name: 'Anders Hejlsberg', role: 'Architect', status: 'Active' },
  { id: 'd19', name: 'Rich Hickey', role: 'Author', status: 'Away' },
  { id: 'd20', name: 'Yukihiro Matsumoto', role: 'Author', status: 'Active' },
  { id: 'd21', name: 'Joe Armstrong', role: 'Researcher', status: 'Active' },
  { id: 'd22', name: 'Leslie Lamport', role: 'Theorist', status: 'Active' },
  { id: 'd23', name: 'Frances Allen', role: 'Researcher', status: 'Away' },
  { id: 'd24', name: 'Niklaus Wirth', role: 'Author', status: 'Active' },
  { id: 'd25', name: 'Carol Shaw', role: 'Engineer', status: 'Active' },
]

const dtById = new Map(dtData.map((p) => [p.id, p]))

const DT_PAGE_SIZE = 5

const children = {
  tabs,
  accordion,
  collapsible,
  pagination,
  steps,
  carousel,
  avatar,
  treeView,
  listbox,
  table,
  sortable,
  dataTable,
} as const

// The section state is the module map plus a consumer-owned `order` array for
// the sortable list (the sortable machine only tracks the drag, not the data).
export type State = ModulesState<typeof children> & { order: string[] }
// Add the reorder message the sortable `drop` glue dispatches.
export type Msg = ModulesMsg<typeof children> | { type: 'reorder'; from: number; to: number }
// The data-table pattern is the only effectful child in this section.
export type Effect = DataTableEffect

export const init = (): [State, Effect[]] => [
  {
    tabs: tabs.init({ items: ['overview', 'specs', 'reviews'], value: 'overview' }),
    accordion: accordion.init({
      items: ['what', 'why', 'how'],
      value: ['what'],
      collapsible: true,
    }),
    collapsible: collapsible.init({ open: false }),
    pagination: pagination.init({ total: 100, pageSize: 10, page: 3 }),
    steps: steps.init({ steps: ['Account', 'Profile', 'Review'], current: 0, linear: true }),
    carousel: carousel.init({ count: 4, current: 0, loop: true }),
    avatar: avatar.init(),
    treeView: treeView.init({
      expanded: ['root'],
      visibleItems: ['root', 'docs', 'src', 'tests'],
      selectionMode: 'single',
    }),
    listbox: listbox.init({
      items: ['Draft', 'Published', 'Archived', 'Deleted'],
      value: ['Published'],
      selectionMode: 'single',
    }),
    table: table.init({
      columns: tableColumns,
      rows: tableRows.map((r) => r.id),
      selectionMode: 'multiple',
    }),
    sortable: sortable.init(),
    dataTable: dataTable.init({
      columns: tableColumns,
      selectionMode: 'multiple',
      pageSize: DT_PAGE_SIZE,
    }),
    order: [...sortableInitial],
  },
  // Kick off the first data-table page load. init() leaves queryId at 0 (no
  // reload has run yet), so the initial fetch must carry queryId 0 to match
  // the reducer's stale-response guard in `pageLoaded`.
  [
    {
      type: 'data-table:loadPage',
      page: 1,
      pageSize: DT_PAGE_SIZE,
      sort: null,
      queryId: 0,
    },
  ],
]

// Custom glue: handle the sortable `drop` (reorder the consumer-owned array),
// the `reorder` message, then fall through to the module composition.
const moduleUpdate = composeModules<State, Msg, Effect>(children)

function sectionUpdate(state: State, msg: Msg): [State, Effect[]] | null {
  if (msg.type === 'reorder') {
    return [{ ...state, order: sortable.reorder(state.order, msg.from, msg.to) }, []]
  }
  if (msg.type === 'sortable' && msg.msg.type === 'drop') {
    const d = state.sortable.dragging
    const reordered = d ? sortable.reorder(state.order, d.startIndex, d.currentIndex) : state.order
    const [next] = sortable.update(state.sortable, msg.msg)
    return [{ ...state, sortable: next, order: reordered }, []]
  }
  return null
}

export const update = mergeHandlers<State, Msg, Effect>(sectionUpdate, moduleUpdate)

// ── Effect contract: the data-table pattern emits a LoadPageEffect. We
// resolve it against the in-memory `dtData` slice (sort + page) and reply
// with the `pageLoaded` message carrying { queryId, rows, total }. ───────
export function onEffect(effect: Effect, send: Send<Msg>): void {
  if (effect.type !== 'data-table:loadPage') return
  const { page, pageSize, sort, queryId } = effect

  const sorted = [...dtData]
  if (sort !== null) {
    const dir = sort.direction === 'desc' ? -1 : 1
    sorted.sort((a, b) => {
      const av = String((a as unknown as Record<string, string>)[sort.columnId] ?? '')
      const bv = String((b as unknown as Record<string, string>)[sort.columnId] ?? '')
      return av.localeCompare(bv) * dir
    })
  }

  const total = sorted.length
  const start = (page - 1) * pageSize
  const ids = sorted.slice(start, start + pageSize).map((p) => p.id)

  const loaded: DataTableMsg = { type: 'pageLoaded', queryId, rows: ids, total }
  send({ type: 'dataTable', msg: loaded })
}

export function view(state: Signal<State>, send: Send<Msg>): Node[] {
  const ta = tabs.connect(state.at('tabs'), (m) => send({ type: 'tabs', msg: m }), {
    id: 'tabs-demo',
  })
  const ac = accordion.connect(state.at('accordion'), (m) => send({ type: 'accordion', msg: m }), {
    id: 'acc-demo',
  })
  const cl = collapsible.connect(
    state.at('collapsible'),
    (m) => send({ type: 'collapsible', msg: m }),
    {
      id: 'coll-demo',
    },
  )
  const pg = pagination.connect(state.at('pagination'), (m) => send({ type: 'pagination', msg: m }))
  const st = steps.connect(state.at('steps'), (m) => send({ type: 'steps', msg: m }), {
    label: 'Progress',
  })
  const cr = carousel.connect(state.at('carousel'), (m) => send({ type: 'carousel', msg: m }), {
    id: 'car-demo',
  })
  const av = avatar.connect(state.at('avatar'), (m) => send({ type: 'avatar', msg: m }), {
    alt: 'User avatar',
  })
  const tv = treeView.connect(state.at('treeView'), (m) => send({ type: 'treeView', msg: m }), {
    id: 'tree-demo',
  })
  const lb = listbox.connect(state.at('listbox'), (m) => send({ type: 'listbox', msg: m }), {
    id: 'lb-demo',
  })
  const tbl = table.connect(state.at('table'), (m) => send({ type: 'table', msg: m }), {
    id: 'data-grid',
  })
  const so = sortable.connect(state.at('sortable'), (m) => send({ type: 'sortable', msg: m }), {
    id: 'sortable-demo',
  })
  const dt = dataTable.connect(state.at('dataTable'), (m) => send({ type: 'dataTable', msg: m }), {
    id: 'dt-demo',
    paginationLabel: 'Table pages',
  })

  const accItem = (v: string, title: string, body: string): Node => {
    const p = ac.item(v)
    return div({ ...p.item }, [
      h3([
        button({ ...p.trigger }, [
          span([text(title)]),
          span(
            {
              class: 'ml-2 transition-transform',
              'data-state': state
                .at('accordion')
                .map((a) => (a.value.includes(v) ? 'open' : 'closed')),
              style: state
                .at('accordion')
                .map((a) => (a.value.includes(v) ? 'transform:rotate(180deg);' : '')),
            },
            [
              svg(
                {
                  xmlns: 'http://www.w3.org/2000/svg',
                  width: '16',
                  height: '16',
                  viewBox: '0 0 24 24',
                  fill: 'none',
                  stroke: 'currentColor',
                  'stroke-width': '2',
                  'stroke-linecap': 'round',
                  'stroke-linejoin': 'round',
                  'aria-hidden': 'true',
                },
                [path({ d: 'M6 9l6 6 6-6' })],
              ),
            ],
          ),
        ]),
      ]),
      div({ ...p.content }, [text(body)]),
    ])
  }

  const stepItem = (idx: number, labelText: string): Node => {
    const p = st.item(idx)
    return div({ ...p.item }, [
      button({ ...p.trigger }, [text(String(idx + 1))]),
      span([text(labelText)]),
      span({ ...p.separator }, []),
    ])
  }

  const pgItem = (page: number): Node => button({ ...pg.item(page) }, [text(String(page))])

  const slides = ['Mountains', 'Ocean', 'Forest', 'Desert']
  const colors = ['#0e7490', '#0369a1', '#14532d', '#b45309']
  const renderSlides = (): Node[] =>
    slides.map((s, i) => div({ ...cr.slide(i).slide, style: `background:${colors[i]}` }, [text(s)]))
  const renderIndicators = (): Node[] =>
    slides.map((_, i) => button({ ...cr.slide(i).indicator }, []))

  const treeBranch = (id: string, label: string, depth: number, treeChildren: Node[]): Node => {
    const p = tv.item(id, depth, true)
    return div([
      div({ ...p.item }, [
        button({ ...p.branchTrigger, class: 'flex items-center gap-1' }, [
          svg(
            {
              xmlns: 'http://www.w3.org/2000/svg',
              width: '16',
              height: '16',
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: 'currentColor',
              'stroke-width': '2',
              'stroke-linecap': 'round',
              'stroke-linejoin': 'round',
              'aria-hidden': 'true',
            },
            [path({ d: 'M9 6l6 6-6 6' })],
          ),
        ]),
        span([text(label)]),
      ]),
      div(
        { class: 'pl-4', hidden: state.at('treeView').map((tvs) => !tvs.expanded.includes(id)) },
        treeChildren,
      ),
    ])
  }
  const treeLeaf = (id: string, label: string, depth: number): Node => {
    const p = tv.item(id, depth, false)
    return div({ ...p.item, class: 'pl-5' }, [span([text(label)])])
  }

  // ── Table (static data grid: sortable headers + multiple selection) ────
  const sortGlyph = (colId: string): Mountable =>
    span({ class: 'ml-1 text-xs text-text-muted' }, [
      text(
        state
          .at('table.sort')
          .map((s) => (s && s.columnId === colId ? (s.direction === 'asc' ? '▲' : '▼') : '')),
      ),
    ])

  const tableHeaderCell = (colId: string, label: string, sortableCol: boolean): Mountable => {
    const h = tbl.columnHeader(colId)
    return th(
      {
        ...h,
        class: sortableCol
          ? 'cursor-pointer select-none border-b border-slate-200 px-3 py-2 text-left text-sm font-semibold hover:bg-slate-50'
          : 'border-b border-slate-200 px-3 py-2 text-left text-sm font-semibold',
      },
      [text(label), sortableCol ? sortGlyph(colId) : span([])],
    )
  }

  const tableBodyRow = (person: Person, index: number): Mountable => {
    const r = tbl.row(person.id, index)
    return tr(
      {
        ...r,
        class: 'cursor-pointer border-b border-slate-100 hover:bg-slate-50',
      },
      [
        td({ class: 'px-3 py-2 text-sm' }, [
          span(
            {
              ...tbl.rowCheckbox(person.id, index),
              class:
                'mr-2 inline-block h-4 w-4 cursor-pointer rounded border border-slate-300 text-center text-xs leading-4',
            },
            [text(state.at('table.selection').map((sel) => (sel.includes(person.id) ? '✓' : '')))],
          ),
          text(person.name),
        ]),
        td({ class: 'px-3 py-2 text-sm' }, [text(person.role)]),
        td({ class: 'px-3 py-2 text-sm' }, [text(person.status)]),
      ],
    )
  }

  // ── Sortable: wire pointermove/up at the root + pointerdown on handles ──
  const sortableSig = state.at('sortable')
  const sortableMount = onMount(() => {
    const root = document.querySelector<HTMLElement>(
      '[data-scope="sortable"][data-part="root"][data-container-id="sortable-demo"]',
    )
    if (!root) return
    const onMove = (e: PointerEvent): void => {
      if (!sortableSig.peek().dragging) return
      const items = Array.from(
        root.querySelectorAll<HTMLElement>('[data-scope="sortable"][data-part="item"]'),
      )
      let target = 0
      let best = Infinity
      items.forEach((item, i) => {
        const rect = item.getBoundingClientRect()
        const mid = rect.top + rect.height / 2
        const d = Math.abs(e.clientY - mid)
        if (d < best) {
          best = d
          target = i
        }
      })
      send({
        type: 'sortable',
        msg: {
          type: 'move',
          index: target,
          container: 'sortable-demo',
          x: e.clientX,
          y: e.clientY,
        },
      })
    }
    const onUp = (): void => {
      if (sortableSig.peek().dragging) send({ type: 'sortable', msg: { type: 'drop' } })
    }
    root.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      root.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  })

  const sortableItem = (label: string, index: Signal<number>): Mountable => {
    const idx = index.peek()
    const it = so.item(label, idx)
    const hd = so.handle(label, idx)
    return li(
      {
        ...it,
        class:
          'flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-sm transition-colors',
        'data-dragging': sortableSig.map((s) =>
          s.dragging && s.dragging.id === label ? '' : undefined,
        ),
        style: sortableSig.map((s) =>
          s.dragging && s.dragging.id === label
            ? 'opacity:0.6;box-shadow:0 4px 12px rgba(0,0,0,0.12);'
            : '',
        ),
      },
      [
        span(
          {
            ...hd,
            class: 'cursor-grab select-none text-text-muted',
            onPointerDown: (e: PointerEvent) => {
              e.preventDefault()
              // Resolve the row's CURRENT position from the live order — the
              // build-time `idx` goes stale once rows have been reordered (the
              // each() is keyed by label, so a moved row keeps its original idx).
              const currentIndex = state.peek().order.indexOf(label)
              send({
                type: 'sortable',
                msg: {
                  type: 'start',
                  id: label,
                  index: currentIndex,
                  container: 'sortable-demo',
                  x: e.clientX,
                  y: e.clientY,
                },
              })
            },
          },
          [text('⋮⋮')],
        ),
        span([text(label)]),
      ],
    )
  }

  // ── Data-table pattern: sortable headers + selection + pagination ──────
  const dtHeaderCell = (colId: string, label: string, sortableCol: boolean): Mountable => {
    const h = dt.table.columnHeader(colId)
    return th(
      {
        ...h,
        class: sortableCol
          ? 'cursor-pointer select-none border-b border-slate-200 px-3 py-2 text-left text-sm font-semibold hover:bg-slate-50'
          : 'border-b border-slate-200 px-3 py-2 text-left text-sm font-semibold',
      },
      [
        text(label),
        sortableCol
          ? span({ class: 'ml-1 text-xs text-text-muted' }, [
              text(
                state
                  .at('dataTable.table.sort')
                  .map((s) =>
                    s && s.columnId === colId ? (s.direction === 'asc' ? '▲' : '▼') : '',
                  ),
              ),
            ])
          : span([]),
      ],
    )
  }

  const dtBodyRow = (id: Signal<string>, index: Signal<number>): Mountable[] => {
    const rowId = id.peek()
    const idx = index.peek()
    const person = dtById.get(rowId)
    const r = dt.table.row(rowId, idx)
    return [
      tr({ ...r, class: 'cursor-pointer border-b border-slate-100 hover:bg-slate-50' }, [
        td({ class: 'px-3 py-2 text-sm' }, [
          span(
            {
              ...dt.table.rowCheckbox(rowId, idx),
              class:
                'mr-2 inline-block h-4 w-4 cursor-pointer rounded border border-slate-300 text-center text-xs leading-4',
            },
            [
              text(
                state
                  .at('dataTable.table.selection')
                  .map((sel) => (sel.includes(rowId) ? '✓' : '')),
              ),
            ],
          ),
          text(person ? person.name : rowId),
        ]),
        td({ class: 'px-3 py-2 text-sm' }, [text(person ? person.role : '')]),
        td({ class: 'px-3 py-2 text-sm' }, [text(person ? person.status : '')]),
      ]),
    ]
  }

  return [
    // Placed so the sortable pointer-wiring onMount registers (discarded
    // onMount() is inert).
    sortableMount,
    sectionGroup('Navigation & display', [
      card('Tabs', [
        div({ ...ta.root }, [
          div({ ...ta.list }, [
            button({ ...ta.item('overview').trigger }, [text('Overview')]),
            button({ ...ta.item('specs').trigger }, [text('Specs')]),
            button({ ...ta.item('reviews').trigger }, [text('Reviews')]),
          ]),
          div({ ...ta.item('overview').panel, class: 'py-3 text-sm' }, [text('Overview content.')]),
          div({ ...ta.item('specs').panel, class: 'py-3 text-sm' }, [text('Specs content.')]),
          div({ ...ta.item('reviews').panel, class: 'py-3 text-sm' }, [text('Reviews content.')]),
        ]),
      ]),
      card('Pagination', [
        div({ ...pg.root, class: 'flex items-center gap-1' }, [
          button({ ...pg.prevTrigger }, [text('‹')]),
          pgItem(1),
          pgItem(2),
          pgItem(3),
          pgItem(4),
          pgItem(5),
          span({ class: 'px-2 text-text-muted' }, [text('…')]),
          pgItem(10),
          button({ ...pg.nextTrigger }, [text('›')]),
        ]),
        div({ class: 'mt-3 text-sm text-text-muted' }, [
          text('Page '),
          text(state.at('pagination').map((p) => String(p.page))),
          text(' of '),
          text(state.at('pagination').map((p) => String(Math.ceil(p.total / p.pageSize)))),
        ]),
      ]),
      card('Stepper', [
        div({ ...st.root }, [
          stepItem(0, 'Account'),
          stepItem(1, 'Profile'),
          stepItem(2, 'Review'),
        ]),
        div({ class: 'mt-3 flex gap-2' }, [
          button({ ...st.prevTrigger, class: 'btn btn-secondary text-xs' }, [text('Back')]),
          button({ ...st.nextTrigger, class: 'btn btn-primary text-xs' }, [text('Next')]),
        ]),
      ]),
      card('Carousel', [
        div({ ...cr.root }, [
          div({ ...cr.viewport }, renderSlides()),
          div({ class: 'flex items-center justify-center gap-2' }, [
            button({ ...cr.prevTrigger, class: 'btn btn-secondary text-xs' }, [text('‹')]),
            div({ ...cr.indicatorGroup }, renderIndicators()),
            button({ ...cr.nextTrigger, class: 'btn btn-secondary text-xs' }, [text('›')]),
          ]),
        ]),
      ]),
      card('Avatar', [
        div({ class: 'flex items-center gap-4' }, [
          div({ ...av.root }, [
            img({
              ...av.image,
              src: 'https://example.invalid/not-an-avatar.png',
              alt: '',
            }),
            span({ ...av.fallback }, [text('FP')]),
          ]),
          div({ class: 'text-sm text-text-muted' }, [
            text('Status: '),
            text(state.at('avatar.status')),
          ]),
        ]),
      ]),
      card('Listbox', [
        div(
          {
            ...lb.root,
            'aria-label': 'Status filter',
            class: 'flex flex-col gap-1 rounded border border-slate-200 p-1',
          },
          ['Draft', 'Published', 'Archived', 'Deleted'].map((v, i) => {
            const p = lb.item(v, i).root
            return div(
              {
                ...p,
                class: 'cursor-pointer rounded px-2 py-1 text-sm hover:bg-slate-100',
              },
              [text(v)],
            )
          }),
        ),
        div({ class: 'mt-2 text-sm text-text-muted' }, [
          text('Status: '),
          text(state.at('listbox').map((l) => l.value[0] ?? 'none')),
        ]),
      ]),
      card('Tree View', [
        div({ ...tv.root }, [
          treeBranch('root', 'project/', 0, [
            treeLeaf('docs', 'docs/', 1),
            treeBranch('src', 'src/', 1, [
              treeLeaf('main.ts', 'main.ts', 2),
              treeLeaf('utils.ts', 'utils.ts', 2),
            ]),
            treeLeaf('tests', 'tests/', 1),
          ]),
        ]),
      ]),
    ]),
    sectionGroup('Disclosure', [
      card('Collapsible', [
        div({ ...cl.root }, [
          button({ ...cl.trigger, class: 'btn btn-secondary' }, [
            span([
              text(state.at('collapsible').map((c) => (c.open ? 'Hide details' : 'Show details'))),
            ]),
          ]),
          div({ ...cl.content, class: 'mt-2 text-sm text-text-muted' }, [
            text(
              'Simpler than accordion — single section, no keyboard nav between siblings. Uses role=region + aria-labelledby.',
            ),
          ]),
        ]),
      ]),
      card('Accordion', [
        div({ ...ac.root }, [
          accItem(
            'what',
            'What is LLui?',
            'A compile-time-optimized TEA framework with zero virtual DOM.',
          ),
          accItem(
            'why',
            'Why another framework?',
            'LLM-first authoring, explicit data flow, compiler does the heavy lifting.',
          ),
          accItem(
            'how',
            'How does it work?',
            'Vite plugin extracts access paths + bitmasks for zero runtime overhead.',
          ),
        ]),
      ]),
    ]),
    sectionGroup('Tables & sorting', [
      card('Table (data grid)', [
        div({ class: 'overflow-x-auto' }, [
          tableEl({ ...tbl.root, class: 'w-full border-collapse' }, [
            thead([
              tr([
                tableHeaderCell('name', 'Name', true),
                tableHeaderCell('role', 'Role', true),
                tableHeaderCell('status', 'Status', false),
              ]),
            ]),
            tbody(tableRows.map((person, i) => tableBodyRow(person, i))),
          ]),
        ]),
        div({ class: 'mt-3 flex items-center gap-3 text-sm text-text-muted' }, [
          span([
            text('Sort: '),
            text(state.at('table.sort').map((s) => (s ? `${s.columnId} ${s.direction}` : 'none'))),
          ]),
          span([
            text('Selected: '),
            text(state.at('table.selection').map((sel) => String(sel.length))),
          ]),
          button(
            {
              class: 'btn btn-secondary text-xs',
              onClick: () => send({ type: 'table', msg: { type: 'clearSelection' } }),
            },
            [text('Clear')],
          ),
        ]),
      ]),
      card('Sortable (drag to reorder)', [
        ul({ ...so.root, class: 'flex flex-col gap-2' }, [
          each(state.at('order'), {
            key: (label) => label,
            render: (label, index) => {
              const labelValue = label.peek()
              return [sortableItem(labelValue, index)]
            },
          }),
        ]),
        div({ class: 'mt-3 text-sm text-text-muted' }, [
          text('Order: '),
          text(state.at('order').map((o) => o.join(' → '))),
        ]),
      ]),
      card('Data Table (paged · sortable · selectable)', [
        div({ class: 'overflow-x-auto' }, [
          tableEl({ ...dt.table.root, class: 'w-full border-collapse' }, [
            thead([
              tr([
                dtHeaderCell('name', 'Name', true),
                dtHeaderCell('role', 'Role', true),
                dtHeaderCell('status', 'Status', false),
              ]),
            ]),
            tbody([
              each(state.at('dataTable.table.rows'), {
                key: (id) => id,
                render: (id, index) => dtBodyRow(id, index),
              }),
            ]),
          ]),
        ]),
        div({ ...dt.loadingOverlay, class: 'mt-2 text-sm text-text-muted' }, [text('Loading…')]),
        div({ ...dt.emptyState, class: 'mt-2 text-sm text-text-muted' }, [text('No rows.')]),
        div({ ...dt.errorState, class: 'mt-2 text-sm text-red-600' }, [text('Failed to load.')]),
        div({ class: 'mt-3 flex items-center gap-2' }, [
          button(
            {
              ...dt.pagination.prevTrigger,
              class: 'btn btn-secondary text-xs',
            },
            [text('‹ Prev')],
          ),
          span({ class: 'text-sm text-text-muted' }, [
            text('Page '),
            text(state.at('dataTable.pagination').map((p) => String(p.page))),
            text(' of '),
            text(
              state
                .at('dataTable.pagination')
                .map((p) => String(Math.max(1, Math.ceil(p.total / p.pageSize)))),
            ),
          ]),
          button(
            {
              ...dt.pagination.nextTrigger,
              class: 'btn btn-secondary text-xs',
            },
            [text('Next ›')],
          ),
          span({ class: 'ml-3 text-sm text-text-muted' }, [
            text('Selected: '),
            text(state.at('dataTable.table.selection').map((sel) => String(sel.length))),
          ]),
        ]),
      ]),
    ]),
  ]
}
