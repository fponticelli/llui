import {
  div,
  button,
  span,
  a,
  nav,
  ol,
  ul,
  li,
  h3,
  p,
  show,
  each,
  branch,
  onMount,
  text,
} from '@llui/dom'
import type { Send, Signal, Renderable, Mountable } from '@llui/dom'
import { tour, type TourStep } from '@llui/components/tour'
import { floatingPanel } from '@llui/components/floating-panel'
import { navigationMenu } from '@llui/components/navigation-menu'
import { scrollArea } from '@llui/components/scroll-area'
import { breadcrumbs } from '@llui/components/breadcrumbs'
import { menubar } from '@llui/components/menubar'
import { watchSubmenuPositioning, type MenuItem, type MenuParts } from '@llui/components/menu'
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
    id: 'chunked-mask',
    title: 'Chunked-mask reactivity',
    description:
      'Each binding carries a sparse mask of the state-path chunks it reads, so an update commits only the values that actually changed — no runtime dependency tracking.',
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
            {
              value: 'more',
              kind: 'action',
              children: [
                { value: 'reset-zoom', kind: 'action' },
                { value: 'fit-width', kind: 'action' },
              ],
            },
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

/**
 * One row of the button card's per-row action list — a quiet neutral action and
 * a quiet destructive one, which is how shadcn's own tables offer a Delete.
 */
function rowAction(name: string): Mountable {
  return div({ class: 'flex items-center justify-between gap-2 px-3 py-2' }, [
    span({ class: 'text-sm' }, [text(name)]),
    div({ class: 'flex items-center gap-1' }, [
      button({ type: 'button', class: 'btn btn-ghost btn-sm' }, [text('Rename')]),
      button({ type: 'button', class: 'btn btn-danger-ghost btn-sm' }, [text('Delete')]),
    ]),
  ])
}

export function view(state: Signal<State>, send: Send<Msg>): Renderable {
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
  const panelDragMount = onMount(() => {
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
    more: 'More',
    'reset-zoom': 'Reset Zoom',
    'fit-width': 'Fit Width',
  }

  // Recursive: mirrors the `overlays` section's real submenu renderer. A
  // `children` node is a real subTrigger + a real anchored submenu
  // (subPositioner/subContent), gated `show`n only while its value is a
  // member of the delegated menu's OWN `openPath` — the machine tracks one
  // per top-level entry (`state.menuStates[id].openPath`), so the gate reads
  // that slice specifically rather than the bar's `open` field (which only
  // names WHICH top-level menu is open, not its submenu chain).
  const renderMenuItems = (items: MenuItem[], menuId: string, parts: MenuParts): Renderable =>
    items.flatMap((it): Renderable => {
      if (it.kind === 'separator') {
        return [div({ ...parts.separator(), class: 'my-1 border-t border-border' }, [])]
      }
      if (it.children && it.children.length > 0) {
        const isOpen = state
          .at('menubar')
          .map((s) => s.menuStates[menuId]?.openPath.includes(it.value) ?? false)
        return [
          div(
            {
              ...parts.subTrigger(it.value),
              class:
                'px-2 py-1.5 rounded text-sm cursor-pointer flex items-center justify-between gap-2 data-[highlighted]:bg-accent',
            },
            [text(itemLabels[it.value] ?? it.value), text('›')],
          ),
          show(isOpen, () => [
            div({ ...parts.subPositioner(it.value) }, [
              div(
                {
                  ...parts.subContent(it.value),
                  class:
                    'min-w-44 bg-card border border-border rounded-md shadow-lg p-1 outline-none',
                },
                renderMenuItems(it.children!, menuId, parts),
              ),
            ]),
          ]),
        ]
      }
      return [
        div(
          {
            ...parts.item(it.value).item,
            class: 'px-2 py-1.5 rounded text-sm cursor-pointer data-[highlighted]:bg-accent',
          },
          [text(itemLabels[it.value] ?? it.value)],
        ),
      ]
    })

  // Render one top-level menu: its bar trigger (placed inline in `mb.root`)
  // and a REAL floating overlay (placed as a top-level sibling, portalled to
  // body) — replacing a prior hand-rolled fixed-corner div with no floating
  // geometry, no dismiss layer, no focus trap and no submenu support (#265
  // finding 9).
  const renderMenuTrigger = (id: string): Mountable =>
    button(
      { ...mb.menuTrigger(id), class: 'px-3 py-1.5 rounded font-medium text-sm hover:bg-accent' },
      [text(menuLabels[id] ?? id)],
    )
  const renderMenuOverlay = (id: string, items: MenuItem[]): Mountable => {
    const menuParts = mb.menu(id)
    return menubar.overlay({
      state: state.at('menubar'),
      send: (m) => send({ type: 'menubar', msg: m }),
      menuId: id,
      parts: menuParts,
      positionerClass: 'z-50',
      content: () => [
        div(
          {
            ...menuParts.content,
            class: 'min-w-44 bg-card border border-border rounded-md shadow-lg p-1 outline-none',
          },
          [
            onMount((root) => watchSubmenuPositioning(root as HTMLElement)),
            ...renderMenuItems(items, id, menuParts),
          ],
        ),
      ],
    })
  }

  const menuDefs: Array<{ id: string; items: MenuItem[] }> = [
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
        {
          value: 'more',
          kind: 'action',
          children: [
            { value: 'reset-zoom', kind: 'action' },
            { value: 'fit-width', kind: 'action' },
          ],
        },
      ],
    },
  ]
  const menubarOverlays = menuDefs.map((m) => renderMenuOverlay(m.id, m.items))

  // ---- Toolbar: a roving-focus item button ----
  const toolbarBtn = (value: string, glyph: string, title: string): Mountable =>
    button(
      {
        ...tb.item(value).root,
        title,
        class:
          'w-8 h-8 grid place-items-center rounded text-sm border border-border bg-card hover:bg-accent data-[disabled]:opacity-40',
      },
      [text(glyph)],
    )

  return [
    // Placed so the onMount drag-wiring callback registers (a discarded
    // onMount() is inert — its lazy Mountable never materializes).
    panelDragMount,
    sectionGroup('Surfaces + navigation', [
      card('Tour', [
        div({ id: 'tour-target', class: 'p-4 bg-muted rounded mb-3' }, [
          text('Target element for the tour walkthrough.'),
        ]),
        div({ class: 'flex gap-2' }, [
          button(
            {
              class: 'btn btn-primary btn-sm',
              onClick: () => send({ type: 'tour', msg: { type: 'start' } }),
            },
            [text('Start tour')],
          ),
        ]),
        // Simplified inline tour UI — dialog shows the current step
        div(
          {
            ...tr.root,
            class: 'mt-3 border border-border rounded bg-muted p-3',
          },
          [
            h3({ ...tr.title, class: 'font-semibold text-sm' }, [
              text(state.at('tour').map((t) => tour.currentStep(t)?.title ?? '')),
            ]),
            p({ ...tr.description, class: 'mt-1 text-xs text-muted-foreground' }, [
              text(state.at('tour').map((t) => tour.currentStep(t)?.description ?? '')),
            ]),
            div({ class: 'mt-2 flex items-center gap-2' }, [
              span({ ...tr.progressText, class: 'text-xs text-muted-foreground' }, [
                text(
                  state.at('tour').map((t) => {
                    const p = tour.progress(t)
                    return `${p.current} / ${p.total}`
                  }),
                ),
              ]),
              button({ ...tr.prevTrigger, class: 'btn btn-secondary btn-sm ms-auto' }, [
                text('Prev'),
              ]),
              button({ ...tr.nextTrigger, class: 'btn btn-primary btn-sm' }, [
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
              class: 'btn btn-primary btn-sm',
              onClick: () => send({ type: 'panel', msg: { type: 'open' } }),
            },
            [text('Open panel')],
          ),
        ]),
        p({ class: 'text-xs text-muted-foreground' }, [
          text('Click Open → panel appears (static position — drag/resize needs pointer wiring).'),
        ]),
        div({ ...fp.root, class: 'border border-border bg-card shadow-xl rounded' }, [
          div(
            {
              ...fp.dragHandle,
              class:
                'flex items-center justify-between px-2 py-1 bg-accent rounded-t cursor-move text-xs',
            },
            [
              span([text('Floating Panel')]),
              div({ class: 'flex gap-1' }, [
                button({ ...fp.minimizeTrigger, class: 'px-1 hover:bg-accent rounded' }, [
                  text('–'),
                ]),
                button({ ...fp.maximizeTrigger, class: 'px-1 hover:bg-accent rounded' }, [
                  text('□'),
                ]),
                button(
                  {
                    ...fp.closeTrigger,
                    class: 'px-1 hover:bg-destructive hover:text-primary-foreground rounded',
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
              class: 'absolute bottom-0 end-0 w-4 h-4 cursor-se-resize',
              style: 'background: linear-gradient(135deg, transparent 50%, rgb(148 163 184) 50%);',
            },
            [],
          ),
        ]),
      ]),
      card('Navigation Menu', [
        // A native `nav` landmark, `ul`/`li` list, and real `a` links inside
        // each panel — NOT menubar/menu roles, since site navigation is not
        // an application menu (registry's own doc comment on this
        // component). Panels render inline (`data-viewport="false"`) rather
        // than into a shared viewport. #265 finding 9: the prior version used
        // `div`s throughout, with no indicator and no landmark/list/link
        // semantics for assistive tech or keyboard users to find.
        nav(
          {
            ...nv.root,
            id: 'nav-demo',
            'data-viewport': 'false',
            class: 'relative flex gap-1 text-sm',
          },
          [
            // The machine answers WHETHER the arrow shows (`indicator`'s
            // `data-state`); WHERE it sits is layout, so the watcher measures
            // the open trigger and writes `--indicator-left`/`--indicator-width`
            // onto the track below. `onMount` hands the callback the BUILD's
            // root container, not the element the call sits inside, so this
            // is scoped to `#nav-demo` — handing it the raw root would let a
            // second nav on the page track this one's arrow (#123's shape).
            onMount((root) => {
              const el = (root as HTMLElement).querySelector('#nav-demo')
              return el instanceof HTMLElement
                ? navigationMenu.watchNavMenuIndicator(el)
                : undefined
            }),
            // Keeps `dir` synchronized with the mounted root's live ancestor
            // `dir` attribute through the shared `@llui/interactions`
            // direction-sync seam (#265 finding 6) — a discarded Mountable is
            // inert, so this must be placed too, not just called for effect.
            nv.directionSync,
            ul({ class: 'flex list-none gap-1' }, [
              li({ class: 'relative' }, [
                button(
                  {
                    ...nv.item('file', { isBranch: true }).trigger,
                    class: 'px-3 py-1.5 rounded font-medium hover:bg-accent',
                  },
                  [text('File')],
                ),
                div(
                  {
                    ...nv.item('file', { isBranch: true }).content,
                    class:
                      'absolute top-full start-0 mt-1 min-w-36 bg-card border border-border rounded-md shadow-lg p-1 z-50',
                  },
                  [
                    ul({ class: 'grid gap-0.5 list-none' }, [
                      li([
                        a({ href: '#', class: 'block px-2 py-1.5 rounded hover:bg-accent' }, [
                          text('New File'),
                        ]),
                      ]),
                      li([
                        a({ href: '#', class: 'block px-2 py-1.5 rounded hover:bg-accent' }, [
                          text('Open...'),
                        ]),
                      ]),
                      li([
                        a({ href: '#', class: 'block px-2 py-1.5 rounded hover:bg-accent' }, [
                          text('Save'),
                        ]),
                      ]),
                    ]),
                  ],
                ),
              ]),
              li({ class: 'relative' }, [
                button(
                  {
                    ...nv.item('edit', { isBranch: true }).trigger,
                    class: 'px-3 py-1.5 rounded font-medium hover:bg-accent',
                  },
                  [text('Edit')],
                ),
                div(
                  {
                    ...nv.item('edit', { isBranch: true }).content,
                    class:
                      'absolute top-full start-0 mt-1 min-w-36 bg-card border border-border rounded-md shadow-lg p-1 z-50',
                  },
                  [
                    ul({ class: 'grid gap-0.5 list-none' }, [
                      li([
                        a({ href: '#', class: 'block px-2 py-1.5 rounded hover:bg-accent' }, [
                          text('Undo'),
                        ]),
                      ]),
                      li([
                        a({ href: '#', class: 'block px-2 py-1.5 rounded hover:bg-accent' }, [
                          text('Redo'),
                        ]),
                      ]),
                      li([
                        a({ href: '#', class: 'block px-2 py-1.5 rounded hover:bg-accent' }, [
                          text('Find & Replace'),
                        ]),
                      ]),
                    ]),
                  ],
                ),
              ]),
              li([
                button(
                  {
                    ...nv.item('help', { isBranch: false }).trigger,
                    class: 'px-3 py-1.5 rounded font-medium hover:bg-accent',
                  },
                  [text('Help')],
                ),
              ]),
            ]),
            // A sibling of the list, inside the positioned root: the track is
            // `absolute` and resolves its offset against the `nav` — driven
            // purely by the `--indicator-left`/`--indicator-width` custom
            // properties the watcher above writes, never a JS-computed class.
            div(
              {
                ...nv.indicator,
                class:
                  'absolute left-0 top-full z-[1] flex h-1.5 w-(--indicator-width) translate-x-(--indicator-left) items-end justify-center overflow-hidden opacity-0 transition-[translate,width,opacity] duration-200 data-[state=visible]:opacity-100',
              },
              [
                div(
                  { class: 'relative top-[60%] size-2 rotate-45 rounded-tl-sm bg-border shadow' },
                  [],
                ),
              ],
            ),
          ],
        ),
        div({ class: 'mt-2 text-xs text-muted-foreground' }, [
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
                    class: 'p-3 text-sm text-foreground',
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
        div({ class: 'mt-2 text-xs text-muted-foreground' }, [
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
                      () => [
                        span({ ...bc.separator, class: 'text-muted-foreground' }, [text('/')]),
                      ],
                    ),
                    branch(entry, (e) => e.type, {
                      ellipsis: () => [
                        button(
                          {
                            ...bc.ellipsisTrigger,
                            class: 'px-1.5 rounded text-muted-foreground hover:bg-accent',
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
                                e.current
                                  ? 'font-medium text-foreground'
                                  : 'text-accent hover:underline',
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
              class: 'btn btn-secondary btn-sm',
              onClick: () => send({ type: 'breadcrumbs', msg: { type: 'collapse' } }),
            },
            [text('Collapse')],
          ),
        ]),
      ]),
      card('Menubar', [
        div(
          { ...mb.root, class: 'flex gap-1' },
          menuDefs.map((m) => renderMenuTrigger(m.id)),
        ),
        div({ class: 'mt-3 text-xs text-muted-foreground' }, [
          text('Open menu: '),
          text(state.at('menubar').map((s) => s.open ?? '(none)')),
        ]),
        ...menubarOverlays,
      ]),
      /*
       * The baseline stylesheet's `.btn` recipe, in full. Not a component — it is
       * the plain-CSS button `theme.css` ships for app chrome, and it is here so
       * `scripts/test/tailwind-classes.test.ts` compiles every one of these class
       * names against the demo's own entry CSS. A variant that names a rule the
       * theme does not define is dead CSS the type-check cannot see.
       */
      card('Buttons (baseline recipe)', [
        div({ class: 'flex flex-wrap items-center gap-2' }, [
          button({ type: 'button', class: 'btn btn-primary' }, [text('Primary')]),
          button({ type: 'button', class: 'btn btn-secondary' }, [text('Secondary')]),
          button({ type: 'button', class: 'btn btn-ghost' }, [text('Ghost')]),
          button({ type: 'button', class: 'btn btn-danger' }, [text('Delete account')]),
          button({ type: 'button', class: 'btn btn-primary btn-sm' }, [text('Small')]),
          button({ type: 'button', class: 'btn btn-primary', disabled: '' }, [text('Disabled')]),
          button({ type: 'button', class: 'btn btn-secondary', 'aria-disabled': 'true' }, [
            text('aria-disabled'),
          ]),
        ]),
        /*
         * The row-action case the filled `.btn-danger` above is wrong for: a
         * column of filled red buttons dominates the page and destroys the
         * visual hierarchy, so a per-row destructive is quiet and the filled one
         * is reserved for THE confirming button in a confirm dialog.
         */
        div({ class: 'mt-4 divide-y divide-border rounded-md border border-border' }, [
          rowAction('config.yaml'),
          rowAction('secrets.env'),
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
        div({ class: 'mt-3 text-xs text-muted-foreground' }, [
          text('Focused item: '),
          text(state.at('toolbar').map((s) => s.focused ?? '(none)')),
          text(' — Tab in, then arrow keys to rove.'),
        ]),
      ]),
    ]),
  ]
}
