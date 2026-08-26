import { div, each, text, type Mountable, type Send, type Signal } from '@llui/dom'
import * as progressC from '@llui/components/progress'
import * as meterC from '@llui/components/meter'
import * as ratingGroup from '@llui/components/rating-group'
import * as avatarC from '@llui/components/avatar'
import * as breadcrumbs from '@llui/components/breadcrumbs'
import * as paginationC from '@llui/components/pagination'
import * as stepsC from '@llui/components/steps'
import { Badge } from '../components/ui/badge'
import { Avatar, AvatarFallback } from '../components/ui/avatar'
import { Progress, ProgressRange, ProgressTrack } from '../components/ui/progress'
import { Meter, MeterRange, MeterTrack } from '../components/ui/meter'
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
  tableStatus: TableStatus
}

export type Msg =
  | { type: 'rating'; msg: ratingGroup.RatingGroupMsg }
  | { type: 'avatar'; msg: avatarC.AvatarMsg }
  | { type: 'crumbs'; msg: breadcrumbs.BreadcrumbsMsg }
  | { type: 'page'; msg: paginationC.PaginationMsg }
  | { type: 'steps'; msg: stepsC.StepsMsg }
  | { type: 'tableStatus'; status: TableStatus }

const CRUMBS = [
  { id: 'home', label: 'Home' },
  { id: 'docs', label: 'Docs' },
  { id: 'registry', label: 'Registry' },
]
const STEP_LABELS = ['Install', 'Configure', 'Add components']

export const init = (): [State, never[]] => [
  {
    progress: progressC.init({ value: 62 }),
    storage: meterC.init({ value: 78, min: 0, max: 100, low: 40, high: 75, optimum: 20 }),
    rating: ratingGroup.init({ value: 4, count: 5 }),
    avatar: avatarC.init(),
    crumbs: breadcrumbs.init({ items: CRUMBS }),
    page: paginationC.init({ page: 3, pageSize: 10, total: 96 }),
    tableStatus: 'ready',
    steps: stepsC.init({ steps: STEP_LABELS, current: 1, completed: [0] }),
  },
  [],
]

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
    case 'tableStatus':
      return [{ ...state, tableStatus: msg.status }, []]
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

export function view(state: Signal<State>, send: Send<Msg>): readonly Mountable[] {
  const status = state.at('tableStatus')
  // `progress` and `meter` are READ-ONLY: their `connect` takes a `send` and
  // ignores it (`_send`), because neither produces a message. The parameter is
  // there so every component's `connect` has the same shape.
  const noop = (): void => undefined
  const progress = progressC.connect(state.at('progress'), noop)
  const storage = meterC.connect(state.at('storage'), noop)
  const rating = ratingGroup.connect(state.at('rating'), (m) => send({ type: 'rating', msg: m }))
  const avatar = avatarC.connect(state.at('avatar'), (m) => send({ type: 'avatar', msg: m }))
  const crumbs = breadcrumbs.connect(state.at('crumbs'), (m) => send({ type: 'crumbs', msg: m }))
  const page = paginationC.connect(state.at('page'), (m) => send({ type: 'page', msg: m }))
  const steps = stepsC.connect(state.at('steps'), (m) => send({ type: 'steps', msg: m }))

  return [
    section(
      'Table & Data Table',
      'The three status surfaces belong to `patterns/data-table`; the grid stays the plain `Table`. Each carries its own reactive `hidden`, and the two live regions must stay MOUNTED — `show` would unmount them and announce nothing.',
      [
        Table([
          TableCaption([text('A slice of the registry.')]),
          TableHeader([
            TableRow([
              TableHead([text('Item')]),
              TableHead([text('Kind')]),
              TableHead({ class: 'text-right' }, [text('Status')]),
            ]),
          ]),
          TableBody(
            ROWS.map((r) =>
              TableRow([
                TableCell({ class: 'font-medium' }, [text(r.item)]),
                TableCell({ class: 'text-muted-foreground' }, [text(r.kind)]),
                TableCell({ class: 'text-right' }, [
                  Badge({ variant: r.status === 'shipped' ? 'secondary' : 'outline' }, [
                    text(r.status),
                  ]),
                ]),
              ]),
            ),
          ),
        ]),
        // `relative` is the CONSUMER's: the overlay is `absolute inset-0`, and
        // only the app knows how much of the surface it should cover. It sits
        // OVER the table rather than replacing it, so a page-to-page load keeps
        // the previous rows visible instead of collapsing to a spinner and back.
        div({ class: 'relative' }, [
          DataTableLoadingOverlay(
            {
              'data-scope': 'data-table',
              'data-part': 'loading-overlay',
              'aria-live': 'polite',
              hidden: status.map((s) => s !== 'loading'),
              class: 'static rounded-md border py-10',
            },
            [Spinner({ class: 'size-5' })],
          ),
          DataTableEmptyState(
            {
              role: 'status',
              'aria-live': 'polite',
              'data-scope': 'data-table',
              'data-part': 'empty-state',
              hidden: status.map((s) => s !== 'empty'),
              class: 'rounded-md border',
            },
            [
              DataTableEmptyTitle([text('No results')]),
              DataTableEmptyDescription([text('Try a different filter.')]),
            ],
          ),
          DataTableErrorState(
            {
              role: 'alert',
              'aria-live': 'polite',
              'data-scope': 'data-table',
              'data-part': 'error-state',
              hidden: status.map((s) => s !== 'error'),
            },
            [text('Could not load rows.')],
          ),
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
                    ? [
                        PaginationLink({ ...page.item(item.page), href: '#' }, [
                          text(String(item.page)),
                        ]),
                      ]
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
