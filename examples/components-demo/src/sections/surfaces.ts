import {
  component,
  mergeHandlers,
  sliceHandler,
  div,
  button,
  span,
  text,
  h3,
  p,
  onMount,
} from '@llui/dom'
import { tour, type TourState, type TourMsg, type TourStep } from '@llui/components/tour'
import {
  floatingPanel,
  type FloatingPanelState,
  type FloatingPanelMsg,
} from '@llui/components/floating-panel'
import {
  navigationMenu,
  type NavMenuState,
  type NavMenuMsg,
} from '@llui/components/navigation-menu'
import { scrollArea, type ScrollAreaState, type ScrollAreaMsg } from '@llui/components/scroll-area'
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

type State = {
  tour: TourState
  panel: FloatingPanelState
  nav: NavMenuState
  scroll: ScrollAreaState
}
type Msg =
  | { type: 'tour'; msg: TourMsg }
  | { type: 'panel'; msg: FloatingPanelMsg }
  | { type: 'nav'; msg: NavMenuMsg }
  | { type: 'scroll'; msg: ScrollAreaMsg }

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

const update = mergeHandlers<State, Msg, never>(
  sliceHandler({
    get: (s) => s.tour,
    set: (s, v) => ({ ...s, tour: v }),
    narrow: (m) => (m.type === 'tour' ? m.msg : null),
    sub: tour.update,
  }),
  sliceHandler({
    get: (s) => s.panel,
    set: (s, v) => ({ ...s, panel: v }),
    narrow: (m) => (m.type === 'panel' ? m.msg : null),
    sub: floatingPanel.update,
  }),
  sliceHandler({
    get: (s) => s.nav,
    set: (s, v) => ({ ...s, nav: v }),
    narrow: (m) => (m.type === 'nav' ? m.msg : null),
    sub: navigationMenu.update,
  }),
  sliceHandler({
    get: (s) => s.scroll,
    set: (s, v) => ({ ...s, scroll: v }),
    narrow: (m) => (m.type === 'scroll' ? m.msg : null),
    sub: scrollArea.update,
  }),
)

export const App = component<State, Msg, never>({
  name: 'SurfacesSection',
  init,
  update,
  view: (send) => {
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
          div({ id: 'tour-target', class: 'p-4 bg-slate-50 rounded mb-3' }, [
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
              class: 'mt-3 border border-blue-200 rounded bg-blue-50 p-3',
            },
            [
              h3({ ...tr.title, class: 'font-semibold text-sm' }, [
                text((s: State) => tour.currentStep(s.tour)?.title ?? ''),
              ]),
              p({ ...tr.description, class: 'mt-1 text-xs text-slate-600' }, [
                text((s: State) => tour.currentStep(s.tour)?.description ?? ''),
              ]),
              div({ class: 'mt-2 flex items-center gap-2' }, [
                span({ ...tr.progressText, class: 'text-xs text-slate-500' }, [
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
          p({ class: 'text-xs text-slate-500' }, [
            text(
              'Click Open → panel appears (static position — drag/resize needs pointer wiring).',
            ),
          ]),
          div({ ...fp.root, class: 'border border-slate-300 bg-white shadow-xl rounded' }, [
            div(
              {
                ...fp.dragHandle,
                class:
                  'flex items-center justify-between px-2 py-1 bg-slate-100 rounded-t cursor-move text-xs',
              },
              [
                span([text('Floating Panel')]),
                div({ class: 'flex gap-1' }, [
                  button({ ...fp.minimizeTrigger, class: 'px-1 hover:bg-slate-200 rounded' }, [
                    text('–'),
                  ]),
                  button({ ...fp.maximizeTrigger, class: 'px-1 hover:bg-slate-200 rounded' }, [
                    text('□'),
                  ]),
                  button({ ...fp.closeTrigger, class: 'px-1 hover:bg-red-200 rounded' }, [
                    text('×'),
                  ]),
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
              class: 'flex gap-1 text-sm',
            },
            [
              button(
                {
                  ...nv.item('file', { isBranch: true }).trigger,
                  class: 'px-3 py-1 rounded hover:bg-slate-100',
                },
                [text('File')],
              ),
              button(
                {
                  ...nv.item('edit', { isBranch: true }).trigger,
                  class: 'px-3 py-1 rounded hover:bg-slate-100',
                },
                [text('Edit')],
              ),
              button(
                {
                  ...nv.item('help', { isBranch: false }).trigger,
                  class: 'px-3 py-1 rounded hover:bg-slate-100',
                },
                [text('Help')],
              ),
            ],
          ),
          div({ class: 'mt-2 text-xs text-slate-500' }, [
            text('Open: '),
            text((s: State) => (s.nav.open.length > 0 ? s.nav.open.join(' › ') : '(none)')),
          ]),
        ]),
        card('Scroll Area', [
          div(
            {
              ...sa.root,
              class: 'relative border border-slate-200 rounded',
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
                      class: 'p-3 text-sm text-slate-700',
                    },
                    Array.from({ length: 30 }, (_, i) =>
                      div({ class: 'py-1 border-b border-slate-100' }, [
                        text(`Scrollable item ${i + 1}`),
                      ]),
                    ),
                  ),
                ],
              ),
            ],
          ),
          div({ class: 'mt-2 text-xs text-slate-500' }, [
            text((s: State) => `scrollTop: ${Math.round(s.scroll.scrollTop)}px`),
          ]),
        ]),
      ]),
    ]
  },
})
