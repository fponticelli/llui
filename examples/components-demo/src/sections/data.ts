import { div, button, span, h3, img, svg, path, text } from '@llui/dom/signals'
import type { Send, Signal } from '@llui/dom/signals'
import { tabs } from '@llui/components/tabs'
import { accordion } from '@llui/components/accordion'
import { collapsible } from '@llui/components/collapsible'
import { pagination } from '@llui/components/pagination'
import { steps } from '@llui/components/steps'
import { carousel } from '@llui/components/carousel'
import { avatar } from '@llui/components/avatar'
import { treeView } from '@llui/components/tree-view'
import { listbox } from '@llui/components/listbox'
import { sectionGroup, card } from '../shared/ui'
import {
  composeModules,
  mergeHandlers,
  type ModulesState,
  type ModulesMsg,
} from '../shared/modules'

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
} as const

export type State = ModulesState<typeof children>
export type Msg = ModulesMsg<typeof children>

export const init = (): [State, never[]] => [
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
  },
  [],
]

export const update = mergeHandlers<State, Msg, never>(composeModules<State, Msg, never>(children))

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

  return [
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
            text(state.at('avatar').map((a) => a.status)),
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
  ]
}
