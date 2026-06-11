import type { Send, Signal } from '@llui/dom'
import {
  init as tableInit,
  update as tableUpdate,
  connect as tableConnect,
  isAllSelected as tableIsAllSelected,
  type TableState,
  type TableMsg,
  type TableSort,
  type TableColumn,
  type TableSelectionMode,
  type TableParts,
} from '../components/table.js'
import {
  init as paginationInit,
  update as paginationUpdate,
  connect as paginationConnect,
  totalPages as paginationTotalPages,
  type PaginationState,
  type PaginationMsg,
  type PaginationParts,
} from '../components/pagination.js'
import type { AsyncStatus } from '../components/async-list.js'

/**
 * DataTable — a pre-wired pattern for server-paginated, sortable, selectable
 * lists. It COMPOSES the headless `table` machine (sort / selection /
 * grid-keyboard), `pagination` (page / pageSize / total), and the async-list
 * status vocabulary (`idle | loading | loaded | error`) into a single slice.
 *
 * The value of the pattern is the GLUE:
 *
 *  - changing the sort resets to page 1 and reloads,
 *  - changing the page or page size reloads,
 *  - every reload bumps a `queryId` version counter and emits a `loadPage`
 *    effect carrying `{ page, pageSize, sort, queryId }`; the consumer fetches
 *    and replies `pageLoaded { queryId, rows, total }`. The reducer DROPS any
 *    `pageLoaded` whose `queryId` is stale (an older in-flight request), so a
 *    slow response can never clobber a newer one.
 *
 * Row DATA stays in the consumer (the `table` machine only tracks row IDs in
 * display order). Server-side sort works for free: feed the pre-sorted IDs back
 * in via `pageLoaded`.
 *
 * Usage in the consumer's `onEffect`:
 *
 * ```ts
 * onEffect: (effect, send) => {
 *   if (effect.type === 'data-table:loadPage') {
 *     const { page, pageSize, sort, queryId } = effect
 *     fetchRows({ page, pageSize, sort })
 *       .then(({ ids, total, data }) => {
 *         setRowData(data)
 *         send({ type: 'dt', msg: { type: 'pageLoaded', queryId, rows: ids, total } })
 *       })
 *       .catch((e) => send({ type: 'dt', msg: { type: 'pageFailed', queryId, error: String(e) } }))
 *   }
 * }
 * ```
 */

export interface DataTableState {
  table: TableState
  pagination: PaginationState
  /** Async status of the current page request. */
  status: AsyncStatus
  /** Error message from the last failed request, or null. */
  error: string | null
  /**
   * Version counter for the in-flight request. Bumped on every reload; a
   * `pageLoaded`/`pageFailed` whose `queryId` differs from this is stale and
   * dropped.
   */
  queryId: number
  /**
   * Selection policy. When true (default), the selection is cleared on every
   * page change and select-all scopes to the current page. When false, the
   * selection persists across pages (cross-page selection).
   */
  clearOnPageChange: boolean
}

/** The `loadPage` effect — carried out of `update`, fulfilled by the consumer. */
export interface LoadPageEffect {
  type: 'data-table:loadPage'
  page: number
  pageSize: number
  sort: TableSort | null
  queryId: number
}

export type DataTableEffect = LoadPageEffect

export type DataTableMsg =
  /** @intent("Cycle the sort on the given column; resets to page 1 and reloads") */
  | { type: 'toggleSort'; columnId: string }
  /** @intent("Set an explicit sort (or null to clear); resets to page 1 and reloads") */
  | { type: 'setSort'; sort: TableSort | null }
  /** @intent("Jump to a specific 1-based page and reload") */
  | { type: 'setPage'; page: number }
  /** @intent("Advance to the next page and reload") */
  | { type: 'nextPage' }
  /** @intent("Go back to the previous page and reload") */
  | { type: 'prevPage' }
  /** @intent("Change the page size; preserves the first visible item and reloads") */
  | { type: 'setPageSize'; pageSize: number }
  /** @intent("Re-request the current page (e.g. after a failure)") */
  | { type: 'reload' }
  /** @humanOnly */
  | { type: 'pageLoaded'; queryId: number; rows: string[]; total: number }
  /** @humanOnly */
  | { type: 'pageFailed'; queryId: number; error: string }
  /** @intent("Toggle selection of the row with the given id at the given display index") */
  | { type: 'toggleRow'; id: string; index: number }
  /** @intent("Toggle between select-all and clear for the current scope") */
  | { type: 'toggleAll' }
  /** @intent("Clear the entire selection") */
  | { type: 'clearSelection' }
  /** @intent("Select the inclusive range from the current anchor to the given index (Shift+click)") */
  | { type: 'selectRange'; index: number }
  /** @intent("Activate (open/confirm) the row with the given id at the given index") */
  | { type: 'activateRow'; id: string; index: number }
  /** @humanOnly */
  | { type: 'focusCell'; rowIndex: number; colIndex: number }
  /** @humanOnly */
  | { type: 'tableKey'; msg: TableMsg }

export interface DataTableInit {
  columns?: TableColumn[]
  selectionMode?: TableSelectionMode
  sort?: TableSort | null
  page?: number
  pageSize?: number
  total?: number
  siblings?: number
  boundaries?: number
  descFirst?: boolean
  clearOnPageChange?: boolean
}

export function init(opts: DataTableInit = {}): DataTableState {
  return {
    table: tableInit({
      columns: opts.columns ?? [],
      rows: [],
      sort: opts.sort ?? null,
      selectionMode: opts.selectionMode ?? 'none',
      descFirst: opts.descFirst ?? false,
      pageSize: opts.pageSize ?? 10,
    }),
    pagination: paginationInit({
      page: opts.page ?? 1,
      pageSize: opts.pageSize ?? 10,
      total: opts.total ?? 0,
      siblings: opts.siblings,
      boundaries: opts.boundaries,
    }),
    status: 'idle',
    error: null,
    queryId: 0,
    clearOnPageChange: opts.clearOnPageChange ?? true,
  }
}

/** Build the `loadPage` effect for the current pagination + table sort, after
 * bumping the queryId. Returns the next state and the effect. */
function reload(state: DataTableState): [DataTableState, DataTableEffect[]] {
  const queryId = state.queryId + 1
  const next: DataTableState = { ...state, status: 'loading', error: null, queryId }
  const effect: LoadPageEffect = {
    type: 'data-table:loadPage',
    page: next.pagination.page,
    pageSize: next.pagination.pageSize,
    sort: next.table.sort,
    queryId,
  }
  return [next, [effect]]
}

/** Apply a pagination change, optionally clearing the selection, then reload. */
function withPagination(
  state: DataTableState,
  pagination: PaginationState,
): [DataTableState, DataTableEffect[]] {
  const pageChanged = pagination.page !== state.pagination.page
  const table =
    pageChanged && state.clearOnPageChange
      ? { ...state.table, selection: [], rangeAnchor: null }
      : state.table
  return reload({ ...state, pagination, table })
}

export function update(
  state: DataTableState,
  msg: DataTableMsg,
): [DataTableState, DataTableEffect[]] {
  switch (msg.type) {
    case 'toggleSort': {
      const [table] = tableUpdate(state.table, { type: 'toggleSort', columnId: msg.columnId })
      if (table.sort === state.table.sort) return [state, []]
      // Sort changed → reset to page 1, clear selection in clear-on-change mode.
      const [pagination] = paginationUpdate(state.pagination, { type: 'first' })
      const cleared = state.clearOnPageChange
        ? { ...table, selection: [], rangeAnchor: null }
        : table
      return reload({ ...state, table: cleared, pagination })
    }
    case 'setSort': {
      const [table] = tableUpdate(state.table, { type: 'setSort', sort: msg.sort })
      const [pagination] = paginationUpdate(state.pagination, { type: 'first' })
      const cleared = state.clearOnPageChange
        ? { ...table, selection: [], rangeAnchor: null }
        : table
      return reload({ ...state, table: cleared, pagination })
    }
    case 'setPage': {
      const [pagination] = paginationUpdate(state.pagination, { type: 'goTo', page: msg.page })
      if (pagination.page === state.pagination.page) return [state, []]
      return withPagination(state, pagination)
    }
    case 'nextPage': {
      const [pagination] = paginationUpdate(state.pagination, { type: 'next' })
      if (pagination.page === state.pagination.page) return [state, []]
      return withPagination(state, pagination)
    }
    case 'prevPage': {
      const [pagination] = paginationUpdate(state.pagination, { type: 'prev' })
      if (pagination.page === state.pagination.page) return [state, []]
      return withPagination(state, pagination)
    }
    case 'setPageSize': {
      const [pagination] = paginationUpdate(state.pagination, {
        type: 'setPageSize',
        pageSize: msg.pageSize,
      })
      // pageSize change always reloads; clear selection in clear-on-change mode.
      const table = state.clearOnPageChange
        ? { ...state.table, selection: [], rangeAnchor: null }
        : state.table
      return reload({ ...state, pagination, table })
    }
    case 'reload':
      return reload(state)
    case 'pageLoaded': {
      // Stale-response protection: drop responses for older requests.
      if (msg.queryId !== state.queryId) return [state, []]
      const [table] = tableUpdate(state.table, { type: 'setRows', rows: msg.rows })
      const [pagination] = paginationUpdate(state.pagination, {
        type: 'setTotal',
        total: msg.total,
      })
      return [{ ...state, table, pagination, status: 'loaded', error: null }, []]
    }
    case 'pageFailed': {
      if (msg.queryId !== state.queryId) return [state, []]
      return [{ ...state, status: 'error', error: msg.error }, []]
    }
    case 'toggleRow': {
      const [table] = tableUpdate(state.table, {
        type: 'toggleRow',
        id: msg.id,
        index: msg.index,
      })
      return [{ ...state, table }, []]
    }
    case 'toggleAll': {
      // In clear-on-change mode select-all already scopes to the current page,
      // because `table.rows` only ever holds the current page's IDs.
      const [table] = tableUpdate(state.table, { type: 'toggleAll' })
      return [{ ...state, table }, []]
    }
    case 'clearSelection': {
      const [table] = tableUpdate(state.table, { type: 'clearSelection' })
      return [{ ...state, table }, []]
    }
    case 'selectRange': {
      const [table] = tableUpdate(state.table, { type: 'selectRange', index: msg.index })
      return [{ ...state, table }, []]
    }
    case 'activateRow': {
      const [table] = tableUpdate(state.table, {
        type: 'activateRow',
        id: msg.id,
        index: msg.index,
      })
      return [{ ...state, table }, []]
    }
    case 'focusCell': {
      const [table] = tableUpdate(state.table, {
        type: 'focusCell',
        rowIndex: msg.rowIndex,
        colIndex: msg.colIndex,
      })
      return [{ ...state, table }, []]
    }
    case 'tableKey': {
      // Pass-through for grid-keyboard navigation messages (moveCell, rowStart,
      // pageDown, …) that don't change the page/sort/data.
      const [table] = tableUpdate(state.table, msg.msg)
      return [{ ...state, table }, []]
    }
  }
}

export function isLoading(state: DataTableState): boolean {
  return state.status === 'loading'
}

export function isError(state: DataTableState): boolean {
  return state.status === 'error'
}

/** Empty == a settled (not-loading) request that yielded zero rows. */
export function isEmpty(state: DataTableState): boolean {
  return state.status === 'loaded' && state.table.rows.length === 0
}

export function isAllSelected(state: DataTableState): boolean {
  return tableIsAllSelected(state.table)
}

export function totalPages(state: DataTableState): number {
  return paginationTotalPages(state.pagination)
}

/** ARIA live-region overlay parts derived from async-list conventions. */
export interface DataTableStatusParts {
  /** Spinner / overlay shown while loading. `aria-busy` mirrors loading. */
  loadingOverlay: {
    'data-scope': 'data-table'
    'data-part': 'loading-overlay'
    'aria-busy': Signal<'true' | undefined>
    'aria-live': 'polite'
    hidden: Signal<boolean>
  }
  /** Empty-state region — shown when a settled request has zero rows. */
  emptyState: {
    role: 'status'
    'aria-live': 'polite'
    'data-scope': 'data-table'
    'data-part': 'empty-state'
    hidden: Signal<boolean>
  }
  /** Error-state region — shown when the last request failed. */
  errorState: {
    role: 'alert'
    'aria-live': 'polite'
    'data-scope': 'data-table'
    'data-part': 'error-state'
    hidden: Signal<boolean>
  }
}

export interface DataTableParts extends DataTableStatusParts {
  table: TableParts
  pagination: PaginationParts
}

export interface ConnectOptions {
  /** Element id base for the table (`grid`) root. */
  id: string
  /** Accessible label for the pagination nav. */
  paginationLabel?: string
}

export function connect(
  state: Signal<DataTableState>,
  send: Send<DataTableMsg>,
  opts: ConnectOptions,
): DataTableParts {
  const tableParts = tableConnect(
    state.map((s) => s.table),
    (m: TableMsg) => {
      switch (m.type) {
        case 'toggleSort':
          send({ type: 'toggleSort', columnId: m.columnId })
          return
        case 'setSort':
          send({ type: 'setSort', sort: m.sort })
          return
        case 'toggleRow':
          send({ type: 'toggleRow', id: m.id, index: m.index })
          return
        case 'toggleAll':
          send({ type: 'toggleAll' })
          return
        case 'clearSelection':
          send({ type: 'clearSelection' })
          return
        case 'selectRange':
          send({ type: 'selectRange', index: m.index })
          return
        case 'activateRow':
          send({ type: 'activateRow', id: m.id, index: m.index })
          return
        case 'focusCell':
          send({ type: 'focusCell', rowIndex: m.rowIndex, colIndex: m.colIndex })
          return
        default:
          // grid-keyboard navigation + structural messages pass through.
          send({ type: 'tableKey', msg: m })
      }
    },
    { id: opts.id },
  )

  const paginationParts = paginationConnect(
    state.map((s) => s.pagination),
    (m: PaginationMsg) => {
      switch (m.type) {
        case 'goTo':
          send({ type: 'setPage', page: m.page })
          return
        case 'next':
          send({ type: 'nextPage' })
          return
        case 'prev':
          send({ type: 'prevPage' })
          return
        case 'first':
          send({ type: 'setPage', page: 1 })
          return
        case 'last':
          send({ type: 'setPage', page: totalPages(state.peek()) })
          return
        case 'setPageSize':
          send({ type: 'setPageSize', pageSize: m.pageSize })
          return
        case 'setTotal':
          // total is owned by the data-table reducer (set via pageLoaded).
          return
      }
    },
    { label: opts.paginationLabel },
  )

  return {
    table: tableParts,
    pagination: paginationParts,
    loadingOverlay: {
      'data-scope': 'data-table',
      'data-part': 'loading-overlay',
      'aria-busy': state.map((s) => (s.status === 'loading' ? 'true' : undefined)),
      'aria-live': 'polite',
      hidden: state.map((s) => s.status !== 'loading'),
    },
    emptyState: {
      role: 'status',
      'aria-live': 'polite',
      'data-scope': 'data-table',
      'data-part': 'empty-state',
      hidden: state.map((s) => !(s.status === 'loaded' && s.table.rows.length === 0)),
    },
    errorState: {
      role: 'alert',
      'aria-live': 'polite',
      'data-scope': 'data-table',
      'data-part': 'error-state',
      hidden: state.map((s) => s.status !== 'error'),
    },
  }
}

export const dataTable = {
  init,
  update,
  connect,
  isLoading,
  isError,
  isEmpty,
  isAllSelected,
  totalPages,
}
