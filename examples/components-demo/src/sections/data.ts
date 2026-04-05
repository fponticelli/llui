import {
  component,
  mountApp,
  mergeHandlers,
  sliceHandler,
  div,
  button,
  span,
  text,
  h3,
  img,
} from '@llui/dom'
import { tabs, type TabsState, type TabsMsg } from '@llui/components/tabs'
import { accordion, type AccordionState, type AccordionMsg } from '@llui/components/accordion'
import { pagination, type PaginationState, type PaginationMsg } from '@llui/components/pagination'
import { stepper, type StepperState, type StepperMsg } from '@llui/components/stepper'
import { carousel, type CarouselState, type CarouselMsg } from '@llui/components/carousel'
import { avatar, type AvatarState, type AvatarMsg } from '@llui/components/avatar'
import { treeView, type TreeViewState, type TreeViewMsg } from '@llui/components/tree-view'
import { sectionGroup, card } from '../shared/ui'

type State = {
  tabs: TabsState
  accordion: AccordionState
  pagination: PaginationState
  stepper: StepperState
  carousel: CarouselState
  avatar: AvatarState
  treeView: TreeViewState
}
type Msg =
  | { type: 'tabs'; msg: TabsMsg }
  | { type: 'accordion'; msg: AccordionMsg }
  | { type: 'pagination'; msg: PaginationMsg }
  | { type: 'stepper'; msg: StepperMsg }
  | { type: 'carousel'; msg: CarouselMsg }
  | { type: 'avatar'; msg: AvatarMsg }
  | { type: 'treeView'; msg: TreeViewMsg }

const init = (): [State, never[]] => [
  {
    tabs: tabs.init({ items: ['overview', 'specs', 'reviews'], value: 'overview' }),
    accordion: accordion.init({
      items: ['what', 'why', 'how'],
      value: ['what'],
      collapsible: true,
    }),
    pagination: pagination.init({ total: 100, pageSize: 10, page: 3 }),
    stepper: stepper.init({ steps: ['Account', 'Profile', 'Review'], current: 0, linear: true }),
    carousel: carousel.init({ count: 4, current: 0, loop: true }),
    avatar: avatar.init(),
    treeView: treeView.init({
      expanded: ['root'],
      visibleItems: ['root', 'docs', 'src', 'tests'],
      selectionMode: 'single',
    }),
  },
  [],
]

const update = mergeHandlers<State, Msg, never>(
  sliceHandler({
    get: (s) => s.tabs,
    set: (s, v) => ({ ...s, tabs: v }),
    narrow: (m) => (m.type === 'tabs' ? m.msg : null),
    sub: tabs.update,
  }),
  sliceHandler({
    get: (s) => s.accordion,
    set: (s, v) => ({ ...s, accordion: v }),
    narrow: (m) => (m.type === 'accordion' ? m.msg : null),
    sub: accordion.update,
  }),
  sliceHandler({
    get: (s) => s.pagination,
    set: (s, v) => ({ ...s, pagination: v }),
    narrow: (m) => (m.type === 'pagination' ? m.msg : null),
    sub: pagination.update,
  }),
  sliceHandler({
    get: (s) => s.stepper,
    set: (s, v) => ({ ...s, stepper: v }),
    narrow: (m) => (m.type === 'stepper' ? m.msg : null),
    sub: stepper.update,
  }),
  sliceHandler({
    get: (s) => s.carousel,
    set: (s, v) => ({ ...s, carousel: v }),
    narrow: (m) => (m.type === 'carousel' ? m.msg : null),
    sub: carousel.update,
  }),
  sliceHandler({
    get: (s) => s.avatar,
    set: (s, v) => ({ ...s, avatar: v }),
    narrow: (m) => (m.type === 'avatar' ? m.msg : null),
    sub: avatar.update,
  }),
  sliceHandler({
    get: (s) => s.treeView,
    set: (s, v) => ({ ...s, treeView: v }),
    narrow: (m) => (m.type === 'treeView' ? m.msg : null),
    sub: treeView.update,
  }),
)

const App = component<State, Msg, never>({
  name: 'DataSection',
  init,
  update,
  view: (send) => {
    const ta = tabs.connect<State>(
      (s) => s.tabs,
      (m) => send({ type: 'tabs', msg: m }),
      { id: 'tabs-demo' },
    )
    const ac = accordion.connect<State>(
      (s) => s.accordion,
      (m) => send({ type: 'accordion', msg: m }),
      { id: 'acc-demo' },
    )
    const pg = pagination.connect<State>(
      (s) => s.pagination,
      (m) => send({ type: 'pagination', msg: m }),
    )
    const st = stepper.connect<State>(
      (s) => s.stepper,
      (m) => send({ type: 'stepper', msg: m }),
      { label: 'Progress' },
    )
    const cr = carousel.connect<State>(
      (s) => s.carousel,
      (m) => send({ type: 'carousel', msg: m }),
      { id: 'car-demo' },
    )
    const av = avatar.connect<State>(
      (s) => s.avatar,
      (m) => send({ type: 'avatar', msg: m }),
      { alt: 'User avatar' },
    )
    const tv = treeView.connect<State>(
      (s) => s.treeView,
      (m) => send({ type: 'treeView', msg: m }),
      { id: 'tree-demo' },
    )

    const accItem = (v: string, title: string, body: string): Node => {
      const p = ac.item(v)
      return div({ ...p.item }, [
        h3({}, [
          button({ ...p.trigger }, [
            span({}, [text(title)]),
            span(
              {
                class: 'ml-2 transition-transform',
                'data-state': (s: State) => (s.accordion.value.includes(v) ? 'open' : 'closed'),
                style: (s: State) =>
                  s.accordion.value.includes(v) ? 'transform:rotate(180deg);' : '',
              },
              [text('▾')],
            ),
          ]),
        ]),
        div({ ...p.content }, [text(body)]),
      ])
    }

    const stepItem = (idx: number, labelText: string): Node => {
      const p = st.item(idx)
      return div({ ...p.item, class: 'step-item' }, [
        button({ ...p.trigger, class: 'step-btn' }, [text(String(idx + 1))]),
        span({ class: 'step-label' }, [text(labelText)]),
        span({ ...p.separator, class: 'step-sep' }, []),
      ])
    }

    const pgItem = (page: number): Node =>
      button({ ...pg.item(page), class: 'pg-btn' }, [text(String(page))])

    const slides = ['Mountains', 'Ocean', 'Forest', 'Desert']
    const colors = ['#0891b2', '#0284c7', '#166534', '#d97706']
    const renderSlides = (): Node[] =>
      slides.map((s, i) =>
        div({ ...cr.slide(i).slide, class: 'carousel-slide', style: `background:${colors[i]}` }, [
          text(s),
        ]),
      )
    const renderIndicators = (): Node[] =>
      slides.map((_, i) => button({ ...cr.slide(i).indicator, class: 'carousel-dot' }, []))

    const treeBranch = (id: string, label: string, depth: number, children: Node[]): Node => {
      const p = tv.item(id, depth, true)
      return div({}, [
        div({ ...p.item, class: 'tree-item' }, [
          button({ ...p.branchTrigger, class: 'tree-caret' }, [text('▸')]),
          span({ class: 'tree-label' }, [text(label)]),
        ]),
        div(
          { class: 'tree-children', hidden: (s: State) => !s.treeView.expanded.includes(id) },
          children,
        ),
      ])
    }
    const treeLeaf = (id: string, label: string, depth: number): Node => {
      const p = tv.item(id, depth, false)
      return div({ ...p.item, class: 'tree-item tree-leaf' }, [
        span({ class: 'tree-label' }, [text(label)]),
      ])
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
            div({ ...ta.item('overview').panel, class: 'py-3 text-sm' }, [
              text('Overview content.'),
            ]),
            div({ ...ta.item('specs').panel, class: 'py-3 text-sm' }, [text('Specs content.')]),
            div({ ...ta.item('reviews').panel, class: 'py-3 text-sm' }, [text('Reviews content.')]),
          ]),
        ]),
        card('Pagination', [
          div({ ...pg.root, class: 'flex items-center gap-1' }, [
            button({ ...pg.prevTrigger, class: 'pg-btn' }, [text('‹')]),
            pgItem(1),
            pgItem(2),
            pgItem(3),
            pgItem(4),
            pgItem(5),
            span({ class: 'px-2 text-slate-400' }, [text('…')]),
            pgItem(10),
            button({ ...pg.nextTrigger, class: 'pg-btn' }, [text('›')]),
          ]),
          div({ class: 'mt-3 text-sm text-slate-600' }, [
            text('Page '),
            text((s: State) => String(s.pagination.page)),
            text(' of '),
            text((s: State) => String(Math.ceil(s.pagination.total / s.pagination.pageSize))),
          ]),
        ]),
        card('Stepper', [
          div({ ...st.root, class: 'step-root' }, [
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
          div({ ...cr.root, class: 'carousel' }, [
            div({ ...cr.viewport, class: 'carousel-viewport' }, renderSlides()),
            div({ class: 'carousel-controls' }, [
              button({ ...cr.prevTrigger, class: 'btn btn-secondary text-xs' }, [text('‹')]),
              div({ ...cr.indicatorGroup, class: 'carousel-indicators' }, renderIndicators()),
              button({ ...cr.nextTrigger, class: 'btn btn-secondary text-xs' }, [text('›')]),
            ]),
          ]),
        ]),
        card('Avatar', [
          div({ class: 'flex items-center gap-4' }, [
            div({ ...av.root, class: 'avatar' }, [
              img({
                ...av.image,
                src: 'https://example.invalid/not-an-avatar.png',
                alt: '',
                class: 'avatar__image',
              }),
              span({ ...av.fallback, class: 'avatar__fallback' }, [text('FP')]),
            ]),
            div({ class: 'text-sm text-slate-600' }, [
              text('Status: '),
              text((s: State) => s.avatar.status),
            ]),
          ]),
        ]),
        card('Tree View', [
          div({ ...tv.root, class: 'tree' }, [
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
  },
})

export function mount(container: HTMLElement): void {
  mountApp(container, App)
}
