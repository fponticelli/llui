import {
  div,
  button,
  span,
  a,
  nav,
  ol,
  li,
  h3,
  p,
  show,
  each,
  branch,
  onMount,
  text,
} from '@llui/dom'
import type { Send, Signal } from '@llui/dom'
import { tour, type TourStep } from '@llui/components/tour'
import { floatingPanel } from '@llui/components/floating-panel'
import { navigationMenu } from '@llui/components/navigation-menu'
import { scrollArea } from '@llui/components/scroll-area'
import { breadcrumbs } from '@llui/components/breadcrumbs'
import { menubar } from '@llui/components/menubar'
import { toolbar } from '@llui/components/toolbar'
import { sectionGroup, card } from '../shared/ui'
import {
  composeModules,
  mergeHandlers,
  type ModulesState,
  type ModulesMsg,
} from '../shared/modules'

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

const children = {
  tour,
  panel: floatingPanel,
  nav: navigationMenu,
  scroll: scrollArea,
  breadcrumbs,
  menubar,
  toolbar,
} as const

export type State = ModulesState<typeof children>
export type Msg = ModulesMsg<typeof children>

export const init = (): [State, never[]] => [
  {
    tour: tour.init({ steps: tourSteps }),
    panel: floatingPanel.init({
      position: { x: 50, y: 50 },
      size: { width: 280, height: 180 },
      open: false,
    }),
    nav: navigationMenu.init(),
    scroll: scrollArea.init({ visibility: 'hover' }),
    breadcrumbs: breadcrumbs.init({
      maxVisible: 3,
      items: [
        { id: 'home', label: 'Home' },
        { id: 'docs', label: 'Docs' },
        { id: 'components', label: 'Components' },
        { id: 'surfaces', label: 'Surfaces' },
        { id: 'breadcrumbs', label: 'Breadcrumbs' },
      ],
    }),
    menubar: menubar.init({
      menus: [
        {
          id: 'file',
          items: [
            { value: 'new', kind: 'action' },
            { value: 'open', kind: 'action' },
            { value: 'sep1', kind: 'separator' },
            { value: 'save', kind: 'action' },
          ],
        },
        {
          id: 'edit',
          items: [
            { value: 'undo', kind: 'action' },
            { value: 'redo', kind: 'action' },
            { value: 'sep2', kind: 'separator' },
            { value: 'find', kind: 'action' },
          ],
        },
        {
          id: 'view',
          items: [
            { value: 'zoom-in', kind: 'action' },
            { value: 'zoom-out', kind: 'action' },
          ],
        },
      ],
    }),
    toolbar: toolbar.init({
      items: ['bold', 'italic', 'underline', 'sep', 'left', 'center', 'right'],
      disabledItems: ['sep'],
    }),
  },
  [],
]

export const update = mergeHandlers<State, Msg, never>(composeModules<State, Msg, never>(children))

export function view(state: Signal<State>, send: Send<Msg>): Node[] {
  const tr = tour.connect(state.at('tour'), (m) => send({ type: 'tour', msg: m }), {
    id: 'tour-demo',
  })
  const fp = floatingPanel.connect(state.at('panel'), (m) => send({ type: 'panel', msg: m }), {
    label: 'Demo panel',
  })
  const nv = navigationMenu.connect(state.at('nav'), (m) => send({ type: 'nav', msg: m }), {
    id: 'nav-demo',
  })
  const sa = scrollArea.connect(state.at('scroll'), (m) => send({ type: 'scroll', msg: m }))
  const bc = breadcrumbs.connect(
    state.at('breadcrumbs'),
    (m) => send({ type: 'breadcrumbs', msg: m }),
    { label: 'Page trail' },
  )
  const mb = menubar.connect(state.at('menubar'), (m) => send({ type: 'menubar', msg: m }), {
    id: 'menubar-demo',
    label: 'Application menu',
  })
  const tb = toolbar.connect(state.at('toolbar'), (m) => send({ type: 'toolbar', msg: m }), {
    id: 'toolbar-demo',
    label: 'Formatting',
  })

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

  // ---- Menubar: label lookups + a per-menu trigger/dropdown renderer ----
  const menuLabels: Record<string, string> = {
    file: 'File',
    edit: 'Edit',
    view: 'View',
  }
  const itemLabels: Record<string, string> = {
    new: 'New File',
    open: 'Open…',
    save: 'Save',
    undo: 'Undo',
    redo: 'Redo',
    find: 'Find & Replace',
    'zoom-in': 'Zoom In',
    'zoom-out': 'Zoom Out',
  }

  // Render one top-level menu: its trigger plus a dropdown gated on
  // `state.open === id`, using the delegated `menu(id)` part bag.
  const renderMenu = (id: string, items: Array<{ value: string; kind: string }>): Node => {
    const menuParts = mb.menu(id)
    return div({ class: 'relative' }, [
      button(
        {
          ...mb.menuTrigger(id),
          class: 'px-3 py-1.5 rounded font-medium text-sm hover:bg-surface-hover',
        },
        [text(menuLabels[id] ?? id)],
      ),
      show(
        state.at('menubar').map((s) => s.open === id),
        () => [
          div(
            {
              ...menuParts.content,
              class:
                'absolute top-full left-0 mt-1 min-w-44 bg-surface border border-border rounded-md shadow-lg p-1 z-50 outline-none',
            },
            items.map((it) =>
              it.kind === 'separator'
                ? div({ ...menuParts.separator(), class: 'my-1 border-t border-border' }, [])
                : div(
                    {
                      ...menuParts.item(it.value).item,
                      class:
                        'px-2 py-1.5 rounded text-sm cursor-pointer data-[state=highlighted]:bg-surface-hover',
                    },
                    [text(itemLabels[it.value] ?? it.value)],
                  ),
            ),
          ),
        ],
      ),
    ])
  }

  const menuDefs: Array<{ id: string; items: Array<{ value: string; kind: string }> }> = [
    {
      id: 'file',
      items: [
        { value: 'new', kind: 'action' },
        { value: 'open', kind: 'action' },
        { value: 'sep1', kind: 'separator' },
        { value: 'save', kind: 'action' },
      ],
    },
    {
      id: 'edit',
      items: [
        { value: 'undo', kind: 'action' },
        { value: 'redo', kind: 'action' },
        { value: 'sep2', kind: 'separator' },
        { value: 'find', kind: 'action' },
      ],
    },
    {
      id: 'view',
      items: [
        { value: 'zoom-in', kind: 'action' },
        { value: 'zoom-out', kind: 'action' },
      ],
    },
  ]

  // ---- Toolbar: a roving-focus item button ----
  const toolbarBtn = (value: string, glyph: string, title: string): Node =>
    button(
      {
        ...tb.item(value).root,
        title,
        class:
          'w-8 h-8 grid place-items-center rounded text-sm border border-border bg-surface hover:bg-surface-hover data-[disabled]:opacity-40',
      },
      [text(glyph)],
    )

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
              text(state.at('tour').map((t) => tour.currentStep(t)?.title ?? '')),
            ]),
            p({ ...tr.description, class: 'mt-1 text-xs text-text-muted' }, [
              text(state.at('tour').map((t) => tour.currentStep(t)?.description ?? '')),
            ]),
            div({ class: 'mt-2 flex items-center gap-2' }, [
              span({ ...tr.progressText, class: 'text-xs text-text-muted' }, [
                text(
                  state.at('tour').map((t) => {
                    const p = tour.progress(t)
                    return `${p.current} / ${p.total}`
                  }),
                ),
              ]),
              button({ ...tr.prevTrigger, class: 'btn btn-secondary text-xs ml-auto' }, [
                text('Prev'),
              ]),
              button({ ...tr.nextTrigger, class: 'btn btn-primary text-xs' }, [
                text(state.at('tour').map((t) => (tour.isLast(t) ? 'Finish' : 'Next'))),
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
          text('Click Open → panel appears (static position — drag/resize needs pointer wiring).'),
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
              style: 'background: linear-gradient(135deg, transparent 50%, rgb(148 163 184) 50%);',
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
          text(state.at('nav').map((n) => (n.open.length > 0 ? n.open.join(' › ') : '(none)'))),
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
          text(state.at('scroll').map((s) => `scrollTop: ${Math.round(s.scrollTop)}px`)),
        ]),
      ]),
      card('Breadcrumbs', [
        // The trail collapses to first + ellipsis + last N (maxVisible 3).
        // Clicking the ellipsis (…) expands the hidden middle; Collapse re-hides it.
        nav({ ...bc.root }, [
          ol({ ...bc.list, class: 'flex flex-wrap items-center gap-1 text-sm' }, [
            each(
              state.at('breadcrumbs').map((s) => breadcrumbs.visibleItems(s)),
              {
                key: (entry) => (entry.type === 'ellipsis' ? '__ellipsis__' : entry.id),
                render: (entry, index) => [
                  li({ class: 'flex items-center gap-1' }, [
                    show(
                      index.map((i) => i > 0),
                      () => [span({ ...bc.separator, class: 'text-text-muted' }, [text('/')])],
                    ),
                    branch(entry, (e) => e.type, {
                      ellipsis: () => [
                        button(
                          {
                            ...bc.ellipsisTrigger,
                            class: 'px-1.5 rounded text-text-muted hover:bg-surface-hover',
                          },
                          [text('…')],
                        ),
                      ],
                      item: (it) => {
                        const id = it.peek().id
                        return [
                          a(
                            {
                              ...bc.link(id),
                              href: '#',
                              class: it.map((e) =>
                                e.current ? 'font-medium text-text' : 'text-accent hover:underline',
                              ),
                              onClick: (e: MouseEvent) => e.preventDefault(),
                            },
                            [text(it.at('label'))],
                          ),
                        ]
                      },
                    }),
                  ]),
                ],
              },
            ),
          ]),
        ]),
        div({ class: 'mt-3 flex gap-2' }, [
          button(
            {
              class: 'btn btn-secondary text-xs',
              onClick: () => send({ type: 'breadcrumbs', msg: { type: 'collapse' } }),
            },
            [text('Collapse')],
          ),
        ]),
      ]),
      card('Menubar', [
        div(
          { ...mb.root, class: 'flex gap-1' },
          menuDefs.map((m) => renderMenu(m.id, m.items)),
        ),
        div({ class: 'mt-3 text-xs text-text-muted' }, [
          text('Open menu: '),
          text(state.at('menubar').map((s) => s.open ?? '(none)')),
        ]),
      ]),
      card('Toolbar', [
        div({ ...tb.root, class: 'flex items-center gap-1' }, [
          div({ ...tb.group('format').root, class: 'flex gap-1' }, [
            span({ ...tb.group('format').label, class: 'sr-only' }, [text('Text format')]),
            toolbarBtn('bold', 'B', 'Bold'),
            toolbarBtn('italic', 'I', 'Italic'),
            toolbarBtn('underline', 'U', 'Underline'),
          ]),
          div({ ...tb.separator, class: 'mx-1 self-stretch w-px bg-border' }, []),
          div({ ...tb.group('align').root, class: 'flex gap-1' }, [
            span({ ...tb.group('align').label, class: 'sr-only' }, [text('Alignment')]),
            toolbarBtn('left', '⬅', 'Align left'),
            toolbarBtn('center', '↔', 'Align center'),
            toolbarBtn('right', '➡', 'Align right'),
          ]),
        ]),
        div({ class: 'mt-3 text-xs text-text-muted' }, [
          text('Focused item: '),
          text(state.at('toolbar').map((s) => s.focused ?? '(none)')),
          text(' — Tab in, then arrow keys to rove.'),
        ]),
      ]),
    ]),
  ]
}
