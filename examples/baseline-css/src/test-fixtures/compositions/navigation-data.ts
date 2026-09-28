// TEST-ONLY composition (registry/test/navigation-data-live-demos.browser.test.ts,
// registry/test/navigation-data-demos.test.ts). A consumer-authored composition
// of the navigation-data machines on the Baseline path: `theme.css` alone, no
// Tailwind, no registry skin. It carries the parts the live suites drive
// (carousel, tabs, pagination, accordion, collapsible, table, data-table) with
// the ids they address, wired exactly as a consumer wires them — the table's
// sort -> resort follow-up, the data-table's `loadPage` effect contract, and
// the placed `directionSync`/`exitCompletion` Mountables.
//
// It replaces the matching sections of the retired `examples/components-demo`:
// the same machine wiring and ids, minus the showcase chrome.
import {
  button,
  component,
  div,
  h3,
  nav,
  path,
  span,
  svg,
  table as tableEl,
  tbody,
  td,
  text,
  th,
  thead,
  tr,
  each,
} from '@llui/dom'
import type { Mountable, Reactive, ReadSignal, Renderable, Send, Signal } from '@llui/dom'
import { tabs } from '@llui/components/tabs'
import { accordion } from '@llui/components/accordion'
import { collapsible } from '@llui/components/collapsible'
import { pagination } from '@llui/components/pagination'
import { carousel } from '@llui/components/carousel'
import { table } from '@llui/components/table'
import type { TableState } from '@llui/components/table'
import { dataTable } from '@llui/components/patterns/data-table'
import type { DataTableEffect, DataTableMsg } from '@llui/components/patterns/data-table'

interface Person {
  id: string
  name: string
  role: string
  status: string
}

// The consumer owns the data; the table machine only tracks row ids in
// display order.
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

// The in-memory dataset the data-table's `loadPage` effect is resolved against.
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

const carouselChevron = (direction: 'previous' | 'next'): Mountable =>
  svg({ viewBox: '0 0 24 24', width: '16', height: '16', 'aria-hidden': 'true' }, [
    path({
      d: direction === 'previous' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
  ])

export interface State {
  tabs: ReturnType<typeof tabs.init>
  accordion: ReturnType<typeof accordion.init>
  collapsible: ReturnType<typeof collapsible.init>
  pagination: ReturnType<typeof pagination.init>
  carousel: ReturnType<typeof carousel.init>
  table: TableState
  dataTable: ReturnType<typeof dataTable.init>
}

export type Msg =
  | { type: 'tabs'; msg: Parameters<typeof tabs.update>[1] }
  | { type: 'accordion'; msg: Parameters<typeof accordion.update>[1] }
  | { type: 'collapsible'; msg: Parameters<typeof collapsible.update>[1] }
  | { type: 'pagination'; msg: Parameters<typeof pagination.update>[1] }
  | { type: 'carousel'; msg: Parameters<typeof carousel.update>[1] }
  | { type: 'table'; msg: Parameters<typeof table.update>[1] }
  | { type: 'dataTable'; msg: DataTableMsg }

export type Effect = DataTableEffect

export const init = (): [State, Effect[]] => [
  {
    tabs: tabs.init({ items: ['overview', 'specs', 'reviews'], value: 'overview' }),
    accordion: accordion.init({
      items: ['what', 'why', 'how'],
      value: ['what'],
      collapsible: true,
      animated: true,
    }),
    collapsible: collapsible.init({ open: false, animated: true }),
    pagination: pagination.init({ total: 100, pageSize: 10, page: 3 }),
    carousel: carousel.init({ count: 4, current: 0, loop: true }),
    table: table.init({
      columns: tableColumns,
      rows: tableRows.map((r) => r.id),
      selectionMode: 'multiple',
    }),
    dataTable: dataTable.init({
      columns: tableColumns,
      selectionMode: 'multiple',
      pageSize: DT_PAGE_SIZE,
    }),
  },
  // The first page load. `init()` leaves `queryId` at 0, so the initial fetch
  // carries 0 to match the reducer's stale-response guard in `pageLoaded`.
  [{ type: 'data-table:loadPage', page: 1, pageSize: DT_PAGE_SIZE, sort: null, queryId: 0 }],
]

/**
 * `table` tracks sort STATE only; the consumer sorts the data and feeds the
 * ordered ids back in. Without this follow-up `aria-sort` changes while every
 * row stays where it was.
 */
function resolveTableSort(state: TableState): TableState {
  const sort = state.sort
  const sortedIds =
    sort === null
      ? tableRows.map((r) => r.id)
      : [...tableRows]
          .sort((a, b) => {
            const key = sort.columnId as keyof Person
            const cmp = String(a[key]).localeCompare(String(b[key]))
            return sort.direction === 'asc' ? cmp : -cmp
          })
          .map((r) => r.id)
  return table.update(state, { type: 'setRows', rows: sortedIds })[0]
}

export function update(state: State, msg: Msg): [State, Effect[]] {
  switch (msg.type) {
    case 'tabs':
      return [{ ...state, tabs: tabs.update(state.tabs, msg.msg)[0] }, []]
    case 'accordion':
      return [{ ...state, accordion: accordion.update(state.accordion, msg.msg)[0] }, []]
    case 'collapsible':
      return [{ ...state, collapsible: collapsible.update(state.collapsible, msg.msg)[0] }, []]
    case 'pagination':
      return [{ ...state, pagination: pagination.update(state.pagination, msg.msg)[0] }, []]
    case 'carousel':
      return [{ ...state, carousel: carousel.update(state.carousel, msg.msg)[0] }, []]
    case 'table': {
      const [next] = table.update(state.table, msg.msg)
      const sorted =
        msg.msg.type === 'toggleSort' || msg.msg.type === 'setSort' ? resolveTableSort(next) : next
      return [{ ...state, table: sorted }, []]
    }
    case 'dataTable': {
      const [next, effects] = dataTable.update(state.dataTable, msg.msg)
      return [{ ...state, dataTable: next }, effects]
    }
  }
}

/** Resolves the data-table's `loadPage` effect against the in-memory slice. */
export function onEffect(effect: Effect, send: Send<Msg>): void {
  if (effect.type !== 'data-table:loadPage') return
  const { page, pageSize, sort, queryId } = effect
  const sorted = [...dtData]
  if (sort !== null) {
    const dir = sort.direction === 'desc' ? -1 : 1
    const key = sort.columnId as keyof Person
    sorted.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * dir)
  }
  const start = (page - 1) * pageSize
  const rows = sorted.slice(start, start + pageSize).map((p) => p.id)
  send({ type: 'dataTable', msg: { type: 'pageLoaded', queryId, rows, total: sorted.length } })
}

export function view(state: Signal<State>, send: Send<Msg>): Renderable {
  const ta = tabs.connect(state.at('tabs'), (m) => send({ type: 'tabs', msg: m }), {
    id: 'tabs-demo',
  })
  const ac = accordion.connect(state.at('accordion'), (m) => send({ type: 'accordion', msg: m }), {
    id: 'acc-demo',
  })
  const cl = collapsible.connect(
    state.at('collapsible'),
    (m) => send({ type: 'collapsible', msg: m }),
    { id: 'coll-demo' },
  )
  const pg = pagination.connect(
    state.at('pagination'),
    (m) => send({ type: 'pagination', msg: m }),
    { id: 'pagination-demo' },
  )
  const cr = carousel.connect(state.at('carousel'), (m) => send({ type: 'carousel', msg: m }), {
    id: 'car-demo',
  })
  const tbl = table.connect(state.at('table'), (m) => send({ type: 'table', msg: m }), {
    id: 'data-grid',
  })
  const dt = dataTable.connect(state.at('dataTable'), (m) => send({ type: 'dataTable', msg: m }), {
    id: 'dt-demo',
    paginationLabel: 'Table pages',
  })

  const accItem = (value: string, title: string, body: string): Mountable => {
    const p = ac.item(value)
    return div({ ...p.item }, [
      h3([button({ ...p.trigger }, [span([text(title)])])]),
      div({ ...p.content }, [text(body)]),
    ])
  }

  const pgItem = (page: number): Mountable => button({ ...pg.item(page) }, [text(String(page))])

  const slides = ['Mountains', 'Ocean', 'Forest', 'Desert']
  const colors = ['#0e7490', '#0369a1', '#14532d', '#b45309']

  // One reactive text node driven by the part's own `data-state` — the
  // baseline rule toggles only its colour, so the view picks the glyph.
  const checkboxGlyph = (
    dataState: ReadSignal<'checked' | 'unchecked' | 'indeterminate'>,
  ): Mountable =>
    text(dataState.map((s) => (s === 'checked' ? '✓' : s === 'indeterminate' ? '−' : '')))

  const headerCell = (parts: typeof tbl, colId: string, label: string): Mountable => {
    const selectAll = colId === 'name' ? parts.selectAllCheckbox(colId) : null
    return th({ ...parts.columnHeader(colId) }, [
      ...(selectAll === null
        ? []
        : [span({ ...selectAll }, [checkboxGlyph(selectAll['data-state'])])]),
      text(label),
    ])
  }

  // `index` stays the row's live handle: a keyed `each` REUSES a row on
  // reorder, so a frozen index would leave aria-rowindex/data-row-index and
  // the row's own dispatch at its ORIGINAL position.
  const bodyRow = (parts: typeof tbl, person: Person, index: Reactive<number>): Mountable => {
    const rowCheckbox = parts.rowCheckbox(person.id, index)
    return tr({ ...parts.row(person.id, index) }, [
      td({ ...parts.cell(index, 0) }, [
        span({ ...rowCheckbox }, [checkboxGlyph(rowCheckbox['data-state'])]),
        text(person.name),
      ]),
      td({ ...parts.cell(index, 1) }, [text(person.role)]),
      td({ ...parts.cell(index, 2) }, [text(person.status)]),
    ])
  }

  const tableHead = (parts: typeof tbl): Mountable =>
    thead([
      tr([
        headerCell(parts, 'name', 'Name'),
        headerCell(parts, 'role', 'Role'),
        headerCell(parts, 'status', 'Status'),
      ]),
    ])

  return [
    ta.directionSync,
    pg.directionSync,
    dt.pagination.directionSync,
    cr.directionSync,
    // A retained close on a skin with no exit motion never settles without
    // these placed — a discarded `onMount()`-backed Mountable is inert.
    ac.exitCompletion,
    cl.exitCompletion,
    div({ ...ta.root }, [
      div({ ...ta.list }, [
        button({ ...ta.item('overview').trigger }, [text('Overview')]),
        button({ ...ta.item('specs').trigger }, [text('Specs')]),
        button({ ...ta.item('reviews').trigger }, [text('Reviews')]),
      ]),
      div({ ...ta.item('overview').panel }, [text('Overview content.')]),
      div({ ...ta.item('specs').panel }, [text('Specs content.')]),
      div({ ...ta.item('reviews').panel }, [text('Reviews content.')]),
    ]),
    div({ ...pg.root }, [
      button({ ...pg.prevTrigger }, [text('‹')]),
      pgItem(1),
      pgItem(2),
      pgItem(3),
      pgItem(4),
      pgItem(5),
      span([text('…')]),
      pgItem(10),
      button({ ...pg.nextTrigger }, [text('›')]),
    ]),
    div({ ...cr.root }, [
      div({ ...cr.viewport }, [
        div(
          { ...cr.track },
          slides.map((s, i) =>
            div({ ...cr.slide(i).slide, style: `background:${colors[i]}` }, [text(s)]),
          ),
        ),
      ]),
      div([
        button({ ...cr.prevTrigger, class: 'btn btn-secondary btn-sm' }, [
          carouselChevron('previous'),
        ]),
        div(
          { ...cr.indicatorGroup },
          slides.map((_, i) => button({ ...cr.slide(i).indicator }, [])),
        ),
        button({ ...cr.nextTrigger, class: 'btn btn-secondary btn-sm' }, [carouselChevron('next')]),
      ]),
    ]),
    div({ ...cl.root }, [
      button({ ...cl.trigger, class: 'btn btn-secondary' }, [
        span([
          text(state.at('collapsible').map((c) => (c.open ? 'Hide details' : 'Show details'))),
        ]),
      ]),
      div({ ...cl.content }, [
        text('A single section with no keyboard navigation between siblings.'),
      ]),
    ]),
    div({ ...ac.root }, [
      accItem('what', 'What is LLui?', 'A compile-time-optimized TEA framework.'),
      accItem('why', 'Why another framework?', 'LLM-first authoring and explicit data flow.'),
      accItem('how', 'How does it work?', 'The compiler turns reads into chunked masks.'),
    ]),
    div({ ...tbl.viewport }, [
      tableEl({ ...tbl.root }, [
        tableHead(tbl),
        tbody([
          // Keyed over the machine's own row-id order, the display order after
          // a sort.
          each(state.at('table.rows'), {
            key: (id) => id,
            render: (idSignal, index) => {
              const person = tableRows.find((candidate) => candidate.id === idSignal.peek())
              return person === undefined ? [] : [bodyRow(tbl, person, index)]
            },
          }),
        ]),
      ]),
    ]),
    div({ ...dt.table.viewport }, [
      tableEl({ ...dt.table.root }, [
        tableHead(dt.table),
        tbody([
          each(state.at('dataTable.table.rows'), {
            key: (id) => id,
            render: (id, index) => {
              // A keyed row's id never changes for the life of the row.
              const person = dtById.get(id.peek())
              return person === undefined ? [] : [bodyRow(dt.table, person, index)]
            },
          }),
        ]),
      ]),
    ]),
    div({ ...dt.loadingOverlay }, [text('Loading…')]),
    div({ ...dt.emptyState }, [text('No rows.')]),
    div({ ...dt.errorState }, [text('Failed to load.')]),
    nav({ ...dt.pagination.root }, [
      button({ ...dt.pagination.prevTrigger, class: 'btn btn-secondary btn-sm' }, [text('‹ Prev')]),
      span([text('Page '), text(state.at('dataTable.pagination').map((p) => String(p.page)))]),
      button({ ...dt.pagination.nextTrigger, class: 'btn btn-secondary btn-sm' }, [text('Next ›')]),
    ]),
  ]
}

export const NavigationDataComposition = component<State, Msg, Effect>({
  name: 'BaselineNavigationDataComposition',
  init,
  update,
  onEffect: (effect, { send }) => onEffect(effect, send),
  view: ({ state, send }) => view(state, send),
})
