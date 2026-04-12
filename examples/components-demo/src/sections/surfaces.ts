import {
  component,
  mergeHandlers,
  childHandlers,
  div,
  button,
  span,
  text,
  h3,
  p,
  onMount,
} from '@llui/dom'
import type { ChildState, ChildMsg } from '@llui/dom'
import { tour, type TourStep } from '@llui/components/tour'
import { floatingPanel } from '@llui/components/floating-panel'
import { navigationMenu } from '@llui/components/navigation-menu'
import { scrollArea } from '@llui/components/scroll-area'
import { sectionGroup, card } from '../shared/ui'

const tourSteps: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to LLui',
    description: 'This is a walkthrough of the components demo.',
    target: '#tour-target',
  },
  {
    id: 'bitmasks',
    title: 'Compile-time bitmasks',
    description: 'Every reactive accessor gets its own bit for zero runtime tracking overhead.',
    target: '#tour-target',
  },
  {
    id: 'done',
    title: "That's a wrap",
    description: 'Explore the other sections for more patterns.',
    target: '#tour-target',
  },
]

const children = { tour, panel: floatingPanel, nav: navigationMenu, scroll: scrollArea } as const

type State = ChildState<typeof children>
type Msg = ChildMsg<typeof children>

const init = (): [State, never[]] => [
  {
    tour: tour.init({ steps: tourSteps }),
    panel: floatingPanel.init({
      position: { x: 50, y: 50 },
      size: { width: 280, height: 180 },
      open: false,
    }),
    nav: navigationMenu.init(),
    scroll: scrollArea.init({ visibility: 'hover' }),
  },
  [],
]

const update = mergeHandlers<State, Msg, never>(childHandlers<State, Msg, never>(children))

export const App = component<State, Msg, never>({
  name: 'SurfacesSection',
  init,
  update,
  view: ({ send }) => {
    const tr = tour.connect<State>(
      (s) => s.tour,
      (m) => send({ type: 'tour', msg: m }),
      { id: 'tour-demo' },
    )
    const fp = floatingPanel.connect<State>(
      (s) => s.panel,
      (m) => send({ type: 'panel', msg: m }),
      { label: 'Demo panel' },
    )
    const nv = navigationMenu.connect<State>(
      (s) => s.nav,
      (m) => send({ type: 'nav', msg: m }),
      { id: 'nav-demo' },
    )
    const sa = scrollArea.connect<State>(
      (s) => s.scroll,
      (m) => send({ type: 'scroll', msg: m }),
    )

    // Wire drag-move/resize-move to the document so the panel keeps
    // following the pointer even when it leaves the handle (dragMove
    // sends deltas, so we track last position).
    onMount(() => {
      let last: { x: number; y: number } | null = null
      let mode: 'drag' | 'resize' | null = null
      const down = (e: PointerEvent): void => {
        const el = e.target as HTMLElement | null
        const dragHandle = el?.closest('[data-scope="floating-panel"][data-part="drag-handle"]')
        const resizeHandle = el?.closest('[data-scope="floating-panel"][data-part="resize-handle"]')
        if (dragHandle) {
          mode = 'drag'
          last = { x: e.clientX, y: e.clientY }
        } else if (resizeHandle) {
          mode = 'resize'
          last = { x: e.clientX, y: e.clientY }
        }
      }
      const move = (e: PointerEvent): void => {
        if (last === null || mode === null) return
        const dx = e.clientX - last.x
        const dy = e.clientY - last.y
        last = { x: e.clientX, y: e.clientY }
        if (mode === 'drag') send({ type: 'panel', msg: { type: 'dragMove', dx, dy } })
        else if (mode === 'resize') send({ type: 'panel', msg: { type: 'resizeMove', dx, dy } })
      }
      const up = (): void => {
        if (mode === 'drag') send({ type: 'panel', msg: { type: 'dragEnd' } })
        else if (mode === 'resize') send({ type: 'panel', msg: { type: 'resizeEnd' } })
        last = null
        mode = null
      }
      document.addEventListener('pointerdown', down)
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', up)
      document.addEventListener('pointercancel', up)
      return () => {
        document.removeEventListener('pointerdown', down)
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', up)
        document.removeEventListener('pointercancel', up)
      }
    })

    return [
      sectionGroup('Surfaces + navigation', [
        card('Tour', [
          div({ id: 'tour-target', class: 'p-4 bg-surface-muted rounded mb-3' }, [
            text('Target element for the tour walkthrough.'),
          ]),
          div({ class: 'flex gap-2' }, [
            button(
              {
                class: 'btn btn-primary text-xs',
                onClick: () => send({ type: 'tour', msg: { type: 'start' } }),
              },
              [text('Start tour')],
            ),
          ]),
          // Simplified inline tour UI — dialog shows the current step
          div(
            {
              ...tr.root,
              class: 'mt-3 border border-border rounded bg-surface-muted p-3',
            },
            [
              h3({ ...tr.title, class: 'font-semibold text-sm' }, [
                text((s: State) => tour.currentStep(s.tour)?.title ?? ''),
              ]),
              p({ ...tr.description, class: 'mt-1 text-xs text-text-muted' }, [
                text((s: State) => tour.currentStep(s.tour)?.description ?? ''),
              ]),
              div({ class: 'mt-2 flex items-center gap-2' }, [
                span({ ...tr.progressText, class: 'text-xs text-text-muted' }, [
                  text((s: State) => {
                    const p = tour.progress(s.tour)
                    return `${p.current} / ${p.total}`
                  }),
                ]),
                button({ ...tr.prevTrigger, class: 'btn btn-secondary text-xs ml-auto' }, [
                  text('Prev'),
                ]),
                button({ ...tr.nextTrigger, class: 'btn btn-primary text-xs' }, [
                  text((s: State) => (tour.isLast(s.tour) ? 'Finish' : 'Next')),
                ]),
              ]),
            ],
          ),
        ]),
        card('Floating Panel', [
          div({ class: 'flex gap-2 mb-2' }, [
            button(
              {
                class: 'btn btn-primary text-xs',
                onClick: () => send({ type: 'panel', msg: { type: 'open' } }),
              },
              [text('Open panel')],
            ),
          ]),
          p({ class: 'text-xs text-text-muted' }, [
            text(
              'Click Open → panel appears (static position — drag/resize needs pointer wiring).',
            ),
          ]),
          div({ ...fp.root, class: 'border border-border bg-surface shadow-xl rounded' }, [
            div(
              {
                ...fp.dragHandle,
                class:
                  'flex items-center justify-between px-2 py-1 bg-surface-hover rounded-t cursor-move text-xs',
              },
              [
                span([text('Floating Panel')]),
                div({ class: 'flex gap-1' }, [
                  button({ ...fp.minimizeTrigger, class: 'px-1 hover:bg-surface-hover rounded' }, [
                    text('–'),
                  ]),
                  button({ ...fp.maximizeTrigger, class: 'px-1 hover:bg-surface-hover rounded' }, [
                    text('□'),
                  ]),
                  button(
                    {
                      ...fp.closeTrigger,
                      class: 'px-1 hover:bg-destructive hover:text-text-inverted rounded',
                    },
                    [text('×')],
                  ),
                ]),
              ],
            ),
            div({ ...fp.content, class: 'p-3 text-xs' }, [
              text('Drag the title bar to move. Resize from the bottom-right corner.'),
            ]),
            div(
              {
                ...fp.resizeHandle('se'),
                class: 'absolute bottom-0 right-0 w-4 h-4 cursor-se-resize',
                style:
                  'background: linear-gradient(135deg, transparent 50%, rgb(148 163 184) 50%);',
              },
              [],
            ),
          ]),
        ]),
        card('Navigation Menu', [
          div(
            {
              ...nv.root,
              class: 'relative flex gap-1 text-sm',
            },
            [
              div({ class: 'relative' }, [
                button(
                  {
                    ...nv.item('file', { isBranch: true }).trigger,
                    class: 'px-3 py-1.5 rounded font-medium hover:bg-surface-hover',
                  },
                  [text('File')],
                ),
                div(
                  {
                    ...nv.item('file', { isBranch: true }).content,
                    class:
                      'absolute top-full left-0 mt-1 min-w-36 bg-surface border border-border rounded-md shadow-lg p-1 z-50',
                  },
                  [
                    div({ class: 'px-2 py-1.5 rounded cursor-pointer hover:bg-surface-hover' }, [
                      text('New File'),
                    ]),
                    div({ class: 'px-2 py-1.5 rounded cursor-pointer hover:bg-surface-hover' }, [
                      text('Open...'),
                    ]),
                    div({ class: 'px-2 py-1.5 rounded cursor-pointer hover:bg-surface-hover' }, [
                      text('Save'),
                    ]),
                  ],
                ),
              ]),
              div({ class: 'relative' }, [
                button(
                  {
                    ...nv.item('edit', { isBranch: true }).trigger,
                    class: 'px-3 py-1.5 rounded font-medium hover:bg-surface-hover',
                  },
                  [text('Edit')],
                ),
                div(
                  {
                    ...nv.item('edit', { isBranch: true }).content,
                    class:
                      'absolute top-full left-0 mt-1 min-w-36 bg-surface border border-border rounded-md shadow-lg p-1 z-50',
                  },
                  [
                    div({ class: 'px-2 py-1.5 rounded cursor-pointer hover:bg-surface-hover' }, [
                      text('Undo'),
                    ]),
                    div({ class: 'px-2 py-1.5 rounded cursor-pointer hover:bg-surface-hover' }, [
                      text('Redo'),
                    ]),
                    div({ class: 'px-2 py-1.5 rounded cursor-pointer hover:bg-surface-hover' }, [
                      text('Find & Replace'),
                    ]),
                  ],
                ),
              ]),
              button(
                {
                  ...nv.item('help', { isBranch: false }).trigger,
                  class: 'px-3 py-1.5 rounded font-medium hover:bg-surface-hover',
                },
                [text('Help')],
              ),
            ],
          ),
          div({ class: 'mt-2 text-xs text-text-muted' }, [
            text('Open: '),
            text((s: State) => (s.nav.open.length > 0 ? s.nav.open.join(' › ') : '(none)')),
          ]),
        ]),
        card('Scroll Area', [
          div(
            {
              ...sa.root,
              class: 'relative border border-border rounded',
            },
            [
              div(
                {
                  ...sa.viewport,
                  class: 'h-40 overflow-auto',
                },
                [
                  div(
                    {
                      ...sa.content,
                      class: 'p-3 text-sm text-text',
                    },
                    Array.from({ length: 30 }, (_, i) =>
                      div({ class: 'py-1 border-b border-border' }, [
                        text(`Scrollable item ${i + 1}`),
                      ]),
                    ),
                  ),
                ],
              ),
            ],
          ),
          div({ class: 'mt-2 text-xs text-text-muted' }, [
            text((s: State) => `scrollTop: ${Math.round(s.scroll.scrollTop)}px`),
          ]),
        ]),
      ]),
    ]
  },
})
