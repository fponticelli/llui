import { div, each, onMount, span, text, type Mountable, type Send, type Signal } from '@llui/dom'
import * as scrollAreaC from '@llui/components/scroll-area'
import * as splitterC from '@llui/components/splitter'
import * as treeViewC from '@llui/components/tree-view'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '../components/ui/scroll-area'
import {
  ResizableHandle,
  ResizableHandleGrip,
  ResizablePanel,
  ResizablePanelGroup,
} from '../components/ui/resizable'
import { TreeView, TreeViewBranchTrigger, TreeViewItem } from '../components/ui/tree-view'
import { ChevronRightIcon } from '../components/ui/icons'
import { section } from './shared'

// A flat adjacency record is the tree's own shape — `visibleItems` is what the
// roving tab stop and every arrow key read, so it has to list the rows that are
// actually rendered, in render order, and be kept in step with `expanded`.
const NODES = {
  src: { label: 'src', children: ['components', 'lib'] },
  components: { label: 'components', children: ['button', 'card'] },
  button: { label: 'button.ts', children: [] },
  card: { label: 'card.ts', children: [] },
  lib: { label: 'lib', children: ['utils'] },
  utils: { label: 'utils.ts', children: [] },
  readme: { label: 'README.md', children: [] },
} as const
type NodeId = keyof typeof NODES
const ROOTS: readonly NodeId[] = ['src', 'readme']

/** Depth-first walk of the rows an `expanded` set actually renders. */
interface TreeRow {
  id: NodeId
  depth: number
}

function visibleRows(expanded: readonly string[]): TreeRow[] {
  const out: TreeRow[] = []
  const walk = (ids: readonly NodeId[], depth: number): void => {
    for (const id of ids) {
      out.push({ id, depth })
      if (expanded.includes(id)) walk(NODES[id].children as readonly NodeId[], depth + 1)
    }
  }
  walk(ROOTS, 0)
  return out
}

const INITIAL_EXPANDED = ['src', 'components']

export interface State {
  scroll: scrollAreaC.ScrollAreaState
  split: splitterC.SplitterState
  tree: treeViewC.TreeViewState
}
export type Msg =
  | { type: 'scroll'; msg: scrollAreaC.ScrollAreaMsg }
  | { type: 'split'; msg: splitterC.SplitterMsg }
  | { type: 'tree'; msg: treeViewC.TreeViewMsg }

export const init = (): [State, never[]] => [
  {
    scroll: scrollAreaC.init(),
    split: splitterC.init({ position: 35, min: 20, max: 70 }),
    tree: treeViewC.init({
      expanded: INITIAL_EXPANDED,
      visibleItems: visibleRows(INITIAL_EXPANDED).map((r) => r.id),
      visibleLabels: visibleRows(INITIAL_EXPANDED).map((r) => NODES[r.id].label),
    }),
  },
  [],
]

export function update(state: State, msg: Msg): [State, never[]] {
  switch (msg.type) {
    case 'scroll':
      return [{ ...state, scroll: scrollAreaC.update(state.scroll, msg.msg)[0] }, []]
    case 'split':
      return [{ ...state, split: splitterC.update(state.split, msg.msg)[0] }, []]
    case 'tree': {
      const next = treeViewC.update(state.tree, msg.msg)[0]
      // `visibleItems`/`visibleLabels` are the CONSUMER's to maintain — the
      // machine reads them for roving focus and typeahead but cannot derive
      // them, because only the app knows which rows it renders. Recomputing
      // here after every message is what keeps arrow keys landing on real rows
      // when a branch opens or closes.
      const rows = visibleRows(next.expanded)
      return [
        {
          ...state,
          tree: {
            ...next,
            visibleItems: rows.map((r) => r.id),
            visibleLabels: rows.map((r) => NODES[r.id as NodeId].label),
          },
        },
        [],
      ]
    }
  }
}

export function view(state: Signal<State>, send: Send<Msg>): readonly Mountable[] {
  const sa = scrollAreaC.connect(state.at('scroll'), (m) => send({ type: 'scroll', msg: m }))
  const sp = splitterC.connect(state.at('split'), (m) => send({ type: 'split', msg: m }))
  const tv = treeViewC.connect(state.at('tree'), (m) => send({ type: 'tree', msg: m }), {
    id: 'demo-tree',
    expandOnClick: true,
  })
  const rows = state.at('tree').at('expanded').map(visibleRows)

  return [
    section(
      'Scroll Area',
      'The viewport is a real scroll container — the machine only measures it. Both scrollbars are ordinary elements positioned from `style`, so they are styleable and never overlay-painted.',
      [
        ScrollArea({ ...sa.root, class: 'h-40 w-full rounded-md border' }, [
          // The machine measures only what a `setScroll` tells it, so before the
          // first scroll event the thumb has height 0 — invisible on a scrollable
          // list, which reads as a missing scrollbar rather than an unscrolled
          // one. One mount-time measurement is the whole fix; the marker node
          // must be PLACED in the view array or it registers nothing.
          onMount((root) => {
            const el = root.querySelector('[data-part="viewport"]')
            if (!(el instanceof HTMLElement)) return
            send({
              type: 'scroll',
              msg: {
                type: 'setScroll',
                scrollTop: el.scrollTop,
                scrollLeft: el.scrollLeft,
                scrollWidth: el.scrollWidth,
                scrollHeight: el.scrollHeight,
                clientWidth: el.clientWidth,
                clientHeight: el.clientHeight,
              },
            })
          }),
          ScrollAreaViewport({ ...sa.viewport, class: 'h-40' }, [
            ScrollAreaContent({ ...sa.content, class: 'p-4' }, [
              div(
                { class: 'flex flex-col gap-2 text-sm' },
                Array.from({ length: 16 }, (_, i) =>
                  div({ class: 'rounded-sm bg-muted/50 px-3 py-2' }, [text(`Row ${i + 1}`)]),
                ),
              ),
            ]),
          ]),
          ScrollAreaScrollbar({ ...sa.scrollbarY, class: 'absolute top-0 right-0' }, [
            ScrollAreaThumb({ ...sa.thumbY }),
          ]),
        ]),
      ],
    ),
    section(
      'Resizable',
      "shadcn's Resizable over `@llui/components/splitter`. Both `aria-orientation` and `data-orientation` are bound, so the upstream classes apply verbatim and the LLui machine still drives them.",
      [
        ResizablePanelGroup({ ...sp.root, class: 'h-40 rounded-lg border' }, [
          ResizablePanel({ ...sp.primaryPanel, class: 'grid place-items-center' }, [
            span({ class: 'text-sm text-muted-foreground' }, [text('Panel one')]),
          ]),
          ResizableHandle({ ...sp.resizeTrigger }, [ResizableHandleGrip()]),
          ResizablePanel({ ...sp.secondaryPanel, class: 'grid place-items-center' }, [
            span({ class: 'text-sm text-muted-foreground' }, [text('Panel two')]),
          ]),
        ]),
      ],
    ),
    section(
      'Tree View',
      'No shadcn equivalent. Full `role="tree"` keyboard navigation: arrows move and open/close, Home/End jump, typeahead matches `visibleLabels`. `data-depth` drives the indent.',
      [
        TreeView({ ...tv.root, class: 'rounded-md border p-2' }, [
          each(rows, {
            key: (r: TreeRow) => r.id,
            render: (row: Signal<TreeRow>) => {
              // A row's parts depend on its id/depth/branch-ness, which are ROW
              // state — read once here, not reactively, because `each` rebuilds
              // the row when its key changes and the key IS the id.
              const r = row.peek()
              const meta = NODES[r.id]
              const isBranch = meta.children.length > 0
              const parts = tv.item(r.id, r.depth, isBranch)
              return [
                TreeViewItem(
                  {
                    ...parts.item,
                    style: `padding-left: ${0.5 + r.depth * 1}rem`,
                  },
                  [
                    isBranch
                      ? TreeViewBranchTrigger({ ...parts.branchTrigger }, [
                          ChevronRightIcon({ class: 'size-3.5' }),
                        ])
                      : span({ class: 'size-4 shrink-0' }),
                    span([text(meta.label)]),
                  ],
                ),
              ]
            },
          }),
        ]),
      ],
    ),
  ]
}
