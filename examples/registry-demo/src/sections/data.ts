import {
  constant,
  div,
  each,
  noSend,
  text,
  type Mountable,
  type Reactive,
  type Send,
  type Signal,
} from '@llui/dom'
import * as progressC from '@llui/components/progress'
import * as meterC from '@llui/components/meter'
import * as ratingGroup from '@llui/components/rating-group'
import * as avatarC from '@llui/components/avatar'
import * as breadcrumbs from '@llui/components/breadcrumbs'
import * as paginationC from '@llui/components/pagination'
import * as stepsC from '@llui/components/steps'
import * as tableC from '@llui/components/table'
import * as dataTableC from '@llui/components/patterns/data-table'
import { Badge } from '../components/ui/badge'
import { Checkbox, CheckboxIndicator } from '../components/ui/checkbox'
import { Avatar, AvatarFallback } from '../components/ui/avatar'
import { Progress, ProgressRange, ProgressTrack } from '../components/ui/progress'
import {
  Meter,
  MeterBand,
  MeterLabel,
  MeterMarker,
  MeterRange,
  MeterTrack,
} from '../components/ui/meter'
import { RatingGroup, RatingGroupItem } from '../components/ui/rating-group'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '../components/ui/breadcrumb'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  PaginationEllipsis,
} from '../components/ui/pagination'
import { Steps, StepsItem, StepsSeparator, StepsTrigger } from '../components/ui/steps'
import { Button } from '../components/ui/button'
import { Spinner } from '../components/ui/spinner'
import {
  DataTableEmptyDescription,
  DataTableEmptyState,
  DataTableEmptyTitle,
  DataTableErrorState,
  DataTableLoadingOverlay,
} from '../components/ui/data-table'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'
import { row, section } from './shared'

export type TableStatus = 'ready' | 'loading' | 'empty' | 'error'

export interface State {
  progress: progressC.ProgressState
  storage: meterC.MeterState
  rating: ratingGroup.RatingGroupState
  avatar: avatarC.AvatarState
  crumbs: breadcrumbs.BreadcrumbsState
  page: paginationC.PaginationState
  steps: stepsC.StepsState
  table: tableC.TableState
  dataTable: dataTableC.DataTableState
}

export type Msg =
  | { type: 'rating'; msg: ratingGroup.RatingGroupMsg }
  | { type: 'avatar'; msg: avatarC.AvatarMsg }
  | { type: 'crumbs'; msg: breadcrumbs.BreadcrumbsMsg }
  | { type: 'page'; msg: paginationC.PaginationMsg }
  | { type: 'steps'; msg: stepsC.StepsMsg }
  | { type: 'table'; msg: tableC.TableMsg }
  | { type: 'dataTable'; msg: dataTableC.DataTableMsg }
  | { type: 'tableStatus'; status: TableStatus }

const CRUMBS = [
  { id: 'home', label: 'Home' },
  { id: 'docs', label: 'Docs' },
  { id: 'registry', label: 'Registry' },
]
const STEP_LABELS = ['Install', 'Configure', 'Add components']

const TABLE_COLUMNS = [
  { id: 'item', sortable: true },
  { id: 'kind', sortable: true },
  { id: 'status', sortable: true },
]

export const init = (): [State, never[]] => {
  const dataTable = dataTableC.init({
    columns: TABLE_COLUMNS,
    selectionMode: 'multiple',
    pageSize: 2,
  })
  const [loadedDataTable] = dataTableC.update(dataTable, {
    type: 'pageLoaded',
    queryId: dataTable.queryId,
    rows: ROWS.slice(0, 2).map(({ item }) => item),
    total: ROWS.length,
  })
  return [
    {
      progress: progressC.init({ value: 62 }),
      storage: meterC.init({ value: 78, min: 0, max: 100, low: 40, high: 75, optimum: 20 }),
      rating: ratingGroup.init({ value: 4, count: 5 }),
      avatar: avatarC.init(),
      crumbs: breadcrumbs.init({ items: CRUMBS }),
      page: paginationC.init({ page: 3, pageSize: 10, total: 96 }),
      steps: stepsC.init({ steps: STEP_LABELS, current: 1, completed: [0] }),
      table: tableC.init({
        columns: TABLE_COLUMNS,
        rows: ROWS.map(({ item }) => item),
        selectionMode: 'multiple',
      }),
      dataTable: loadedDataTable,
    },
    [],
  ]
}

/**
 * `table.ts` (unlike `data-table.ts`) is NOT paged: it tracks only sort
 * STATE, and the machine's own doc says so — "the consumer ... performs the
 * actual data sort ... by feeding pre-sorted `rows` back in." A `toggleSort`
 * that only flips `state.sort` without this follow-up would set `aria-sort`
 * on the header while every row stayed in its original DOM position.
 */
function resolveTableSort(state: tableC.TableState): tableC.TableState {
  const sort = state.sort
  const sortedIds =
    sort === null
      ? ROWS.map((r) => r.item)
      : [...ROWS]
          .sort((a, b) => {
            const key = sort.columnId as keyof RegistryRow
            const cmp = String(a[key]).localeCompare(String(b[key]))
            return sort.direction === 'asc' ? cmp : -cmp
          })
          .map((r) => r.item)
  return tableC.update(state, { type: 'setRows', rows: sortedIds })[0]
}

function resolveDataTable(
  state: dataTableC.DataTableState,
  msg: dataTableC.DataTableMsg,
): dataTableC.DataTableState {
  const [pending, effects] = dataTableC.update(state, msg)
  const load = effects[0]
  if (load === undefined) return pending
  const sorted = [...ROWS]
  if (load.sort !== null) {
    const direction = load.sort.direction === 'asc' ? 1 : -1
    const key = load.sort.columnId as keyof RegistryRow
    sorted.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * direction)
  }
  const start = (load.page - 1) * load.pageSize
  return dataTableC.update(pending, {
    type: 'pageLoaded',
    queryId: load.queryId,
    rows: sorted.slice(start, start + load.pageSize).map(({ item }) => item),
    total: sorted.length,
  })[0]
}

export function update(state: State, msg: Msg): [State, never[]] {
  switch (msg.type) {
    case 'rating':
      return [{ ...state, rating: ratingGroup.update(state.rating, msg.msg)[0] }, []]
    case 'avatar':
      return [{ ...state, avatar: avatarC.update(state.avatar, msg.msg)[0] }, []]
    case 'crumbs':
      return [{ ...state, crumbs: breadcrumbs.update(state.crumbs, msg.msg)[0] }, []]
    case 'page':
      return [{ ...state, page: paginationC.update(state.page, msg.msg)[0] }, []]
    case 'steps':
      return [{ ...state, steps: stepsC.update(state.steps, msg.msg)[0] }, []]
    case 'table': {
      const [next] = tableC.update(state.table, msg.msg)
      const resorted =
        msg.msg.type === 'toggleSort' || msg.msg.type === 'setSort' ? resolveTableSort(next) : next
      return [{ ...state, table: resorted }, []]
    }
    case 'dataTable':
      return [{ ...state, dataTable: resolveDataTable(state.dataTable, msg.msg) }, []]
    case 'tableStatus': {
      const pending = dataTableC.update(state.dataTable, { type: 'reload' })[0]
      if (msg.status === 'loading') return [{ ...state, dataTable: pending }, []]
      if (msg.status === 'error') {
        return [
          {
            ...state,
            dataTable: dataTableC.update(pending, {
              type: 'pageFailed',
              queryId: pending.queryId,
              error: 'Could not load rows.',
            })[0],
          },
          [],
        ]
      }
      const rows = msg.status === 'empty' ? [] : ROWS.slice(0, pending.pagination.pageSize)
      return [
        {
          ...state,
          dataTable: dataTableC.update(pending, {
            type: 'pageLoaded',
            queryId: pending.queryId,
            rows: rows.map(({ item }) => item),
            total: msg.status === 'empty' ? 0 : ROWS.length,
          })[0],
        },
        [],
      ]
    }
  }
}

interface RegistryRow {
  item: string
  kind: string
  status: 'shipped' | 'planned'
}

const ROWS: readonly RegistryRow[] = [
  { item: 'button', kind: 'presentational', status: 'shipped' },
  { item: 'dropdown-menu', kind: 'skin', status: 'shipped' },
  { item: 'calendar', kind: 'skin', status: 'shipped' },
  { item: 'chart', kind: 'presentational', status: 'planned' },
]

/** A thyroid panel: three bands of unequal width, over 0–8 mIU/L. */
const TSH = meterC.init({
  value: 2.1,
  min: 0,
  max: 8,
  bands: [
    { id: 'low', to: 0.4, tone: 'critical', label: 'low' },
    { id: 'ref', from: 0.4, to: 4, tone: 'optimal', label: 'optimal' },
    { id: 'high', from: 4, tone: 'critical', label: 'high' },
  ],
})

export function view(state: Signal<State>, send: Send<Msg>): readonly Mountable[] {
  // `progress` and `meter` are READ-ONLY: their `connect` takes a `send` and
  // ignores it (`_send`), because neither produces a message. The parameter is
  // there so every component's `connect` has the same shape.
  const noop = (): void => undefined
  const progress = progressC.connect(state.at('progress'), noop)
  const storage = meterC.connect(state.at('storage'), noop)
  // A reference range (#235). The reading is fixed for the life of the node, so
  // it needs no slice in `State` at all — `constant()` + `noSend` drive the same
  // `connect`, and the banded track is drawn from the derived layout.
  const tsh = meterC.connect(constant(TSH), noSend, {
    label: 'TSH',
    format: (v) => `${v} mIU/L`,
  })
  const rating = ratingGroup.connect(state.at('rating'), (m) => send({ type: 'rating', msg: m }))
  const avatar = avatarC.connect(state.at('avatar'), (m) => send({ type: 'avatar', msg: m }))
  const crumbs = breadcrumbs.connect(state.at('crumbs'), (m) => send({ type: 'crumbs', msg: m }))
  const page = paginationC.connect(state.at('page'), (m) => send({ type: 'page', msg: m }), {
    id: 'registry-pagination-demo',
  })
  const steps = stepsC.connect(state.at('steps'), (m) => send({ type: 'steps', msg: m }))
  const table = tableC.connect(state.at('table'), (msg) => send({ type: 'table', msg }), {
    id: 'registry-table',
  })
  const dataTable = dataTableC.connect(
    state.at('dataTable'),
    (msg) => send({ type: 'dataTable', msg }),
    { id: 'registry-data-table', paginationLabel: 'Registry data-table pages' },
  )

  // The select-all header renders the SAME `Checkbox`/`CheckboxIndicator`
  // pair used everywhere else in this registry: the machine's `data-state`
  // (`checked`/`indeterminate`/`unchecked`) drives which glyph is visible in
  // CSS, so this is never a hardcoded "✓" — a mixed selection genuinely shows
  // the indeterminate dash, not a checkmark that lies about the state.
  const header = (parts: tableC.TableParts, columnId: string, label: string): Mountable =>
    TableHead({ ...parts.columnHeader(columnId) }, [
      ...(columnId === 'item'
        ? [Checkbox({ ...parts.selectAllCheckbox(columnId), class: 'me-2' }, [CheckboxIndicator()])]
        : []),
      text(label),
    ])

  // `rowIndex` is `Reactive<number>` — a live Signal handle when the row comes
  // from a keyed `each` (both tables below), never `.peek()`'d. A keyed row is
  // REUSED (moved, not rebuilt) on reorder, so freezing the index at build
  // time would leave aria-rowindex/data-row-index and the row's own
  // toggleRow/selectRange dispatch stuck at its ORIGINAL position forever.
  const machineRow = (
    parts: tableC.TableParts,
    rowValue: RegistryRow,
    rowIndex: Reactive<number>,
    selection: Signal<readonly string[]>,
  ): Mountable =>
    TableRow({ ...parts.row(rowValue.item, rowIndex) }, [
      TableCell({ ...parts.cell(rowIndex, 0), class: 'font-medium' }, [
        Checkbox({ ...parts.rowCheckbox(rowValue.item, rowIndex), class: 'me-2' }, [
          CheckboxIndicator(),
        ]),
        text(rowValue.item),
      ]),
      TableCell({ ...parts.cell(rowIndex, 1), class: 'text-muted-foreground' }, [
        text(rowValue.kind),
      ]),
      TableCell({ ...parts.cell(rowIndex, 2), class: 'text-end' }, [
        Badge({ variant: rowValue.status === 'shipped' ? 'secondary' : 'outline' }, [
          text(rowValue.status),
        ]),
      ]),
    ])

  // Shared by both tables: resolve a row id to its display data and render it
  // through `machineRow`, over a keyed `each` on the machine's OWN row-id
  // order (`table.rows`) — the authoritative display order after sort, not a
  // fixed `ROWS.map`, which is what let `aria-sort` change while every row
  // stayed exactly where it started.
  const machineRows = (
    parts: tableC.TableParts,
    rowsSignal: Signal<readonly string[]>,
    selection: Signal<readonly string[]>,
  ): Mountable =>
    TableBody([
      each(rowsSignal, {
        key: (id) => id,
        render: (idSignal, index) => {
          const id = idSignal.peek()
          const registryRow = ROWS.find((candidate) => candidate.item === id)
          return registryRow === undefined ? [] : [machineRow(parts, registryRow, index, selection)]
        },
      }),
    ])

  return [
    page.directionSync,
    dataTable.pagination.directionSync,
    section(
      'Table & Data Table',
      'Both examples spread the live machine parts into the registry skin. The native grid is placed directly inside the machine-owned viewport, and the data-table keeps its status live regions mounted.',
      [
        Table({ viewport: table.viewport, ...table.root }, [
          TableCaption([text('A live sortable and selectable grid.')]),
          TableHeader([
            TableRow([
              header(table, 'item', 'Item'),
              header(table, 'kind', 'Kind'),
              header(table, 'status', 'Status'),
            ]),
          ]),
          machineRows(table, state.at('table.rows'), state.at('table.selection')),
        ]),
        div({ class: 'relative' }, [
          Table({ viewport: dataTable.table.viewport, ...dataTable.table.root }, [
            TableCaption([text('A machine-composed paged data table.')]),
            TableHeader([
              TableRow([
                header(dataTable.table, 'item', 'Item'),
                header(dataTable.table, 'kind', 'Kind'),
                header(dataTable.table, 'status', 'Status'),
              ]),
            ]),
            machineRows(
              dataTable.table,
              state.at('dataTable.table.rows'),
              state.at('dataTable.table.selection'),
            ),
          ]),
          DataTableEmptyState(
            {
              ...dataTable.emptyState,
              class: 'rounded-md border',
            },
            [
              DataTableEmptyTitle([text('No results')]),
              DataTableEmptyDescription([text('Try a different filter.')]),
            ],
          ),
          DataTableErrorState(
            {
              ...dataTable.errorState,
            },
            [text('Could not load rows.')],
          ),
          DataTableLoadingOverlay(
            {
              ...dataTable.loadingOverlay,
            },
            [Spinner({ class: 'size-5' })],
          ),
        ]),
        Pagination({ ...dataTable.pagination.root }, [
          PaginationContent([
            PaginationItem([
              PaginationPrevious({ ...dataTable.pagination.prevTrigger }, [text('Prev')]),
            ]),
            PaginationItem([PaginationLink({ ...dataTable.pagination.item(1) }, [text('1')])]),
            PaginationItem([PaginationLink({ ...dataTable.pagination.item(2) }, [text('2')])]),
            PaginationItem([
              PaginationNext({ ...dataTable.pagination.nextTrigger }, [text('Next')]),
            ]),
          ]),
        ]),
        row(
          'Status',
          (['ready', 'loading', 'empty', 'error'] as const).map((s) =>
            Button(
              {
                variant: 'outline',
                size: 'sm',
                onClick: () => send({ type: 'tableStatus', status: s }),
              },
              [text(s)],
            ),
          ),
        ),
      ],
    ),

    section('Progress, Meter, Rating & Avatar', 'Read-only indicators and small displays.', [
      row('Progress', [
        div({ class: 'w-64' }, [
          Progress({ ...progress.root }, [
            ProgressTrack({ ...progress.track }, [ProgressRange({ ...progress.range })]),
          ]),
        ]),
      ]),
      row('Meter (78% of quota)', [
        div({ class: 'w-64' }, [
          Meter({ ...storage.root }, [
            MeterTrack({ ...storage.track }, [MeterRange({ ...storage.range })]),
          ]),
        ]),
      ]),
      row('Meter (reference range)', [
        div({ class: 'w-64' }, [
          Meter({ ...tsh.root }, [
            MeterTrack({ ...tsh.track }, [
              each(tsh.bands, {
                key: (b: meterC.MeterBandGeometry) => b.id,
                render: (b: Signal<meterC.MeterBandGeometry>) => [
                  MeterBand({ ...tsh.bandProps(b) }),
                ],
              }),
              MeterMarker({ ...tsh.marker }),
            ]),
            MeterLabel({ ...tsh.label }, [text(tsh.valueText)]),
          ]),
        ]),
      ]),
      row('Rating', [
        RatingGroup(
          { ...rating.root },
          [0, 1, 2, 3, 4].map((i) => RatingGroupItem({ ...rating.item(i).root }, [text('★')])),
        ),
      ]),
      row('Avatar', [
        Avatar({ ...avatar.root }, [AvatarFallback({ ...avatar.fallback }, [text('FP')])]),
        Avatar({ ...avatar.root, class: 'size-12' }, [
          AvatarFallback({ ...avatar.fallback, class: 'text-base' }, [text('LL')]),
        ]),
      ]),
    ]),

    section('Breadcrumb, Pagination & Steps', 'Position and navigation indicators.', [
      Breadcrumb({ ...crumbs.root }, [
        BreadcrumbList(
          { ...crumbs.list },
          CRUMBS.flatMap((c, i) => [
            BreadcrumbItem({ ...crumbs.item(c.id) }, [
              BreadcrumbLink({ ...crumbs.link(c.id), href: '#' }, [text(c.label)]),
            ]),
            ...(i < CRUMBS.length - 1
              ? // No children: the separator renders its own chevron, as shadcn's does.
                [BreadcrumbSeparator({ ...crumbs.separator })]
              : []),
          ]),
        ),
      ]),
      Pagination({ ...page.root }, [
        PaginationContent([
          PaginationItem([
            // The arrow is the component's own; pass only the label.
            PaginationPrevious({ ...page.prevTrigger }, [text('Prev')]),
          ]),
          // The visible window (siblings + boundaries + ellipsis) is computed by
          // the machine's own `pageItems`, so the view never derives a window of
          // its own. It is a pure function of state, so it belongs in an `each`
          // over a derived signal rather than a `.peek()` read that would freeze.
          each(state.at('page').map(paginationC.pageItems), {
            key: (p: paginationC.PageItem) => (p.type === 'page' ? `p${p.page}` : `e${p.position}`),
            render: (p: Signal<paginationC.PageItem>) => {
              const item = p.peek()
              return [
                PaginationItem(
                  item.type === 'page'
                    ? [PaginationLink({ ...page.item(item.page) }, [text(String(item.page))])]
                    : [PaginationEllipsis([text('…')])],
                ),
              ]
            },
          }),
          PaginationItem([PaginationNext({ ...page.nextTrigger }, [text('Next')])]),
        ]),
      ]),
      Steps(
        { ...steps.root },
        STEP_LABELS.flatMap((label, i) => {
          const parts = steps.item(i)
          return [
            StepsItem({ ...parts.item }, [
              StepsTrigger({ ...parts.trigger }, [
                Badge({ variant: 'outline', class: 'size-5 justify-center p-0' }, [
                  text(String(i + 1)),
                ]),
                text(label),
              ]),
              ...(i < STEP_LABELS.length - 1 ? [StepsSeparator({ ...parts.separator })] : []),
            ]),
          ]
        }),
      ),
    ]),
  ]
}
