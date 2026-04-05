import {
  component,
  mergeHandlers,
  sliceHandler,
  div,
  button,
  span,
  text,
  a,
  ul,
  li,
  img,
  each,
} from '@llui/dom'
import { toc, type TocState, type TocMsg } from '@llui/components/toc'
import {
  cascadeSelect,
  type CascadeSelectState,
  type CascadeSelectMsg,
} from '@llui/components/cascade-select'
import {
  asyncList,
  type AsyncListState,
  type AsyncListMsg,
} from '@llui/components/async-list'
import { presence, type PresenceState, type PresenceMsg } from '@llui/components/presence'
import { qrCode, type QrCodeState, type QrCodeMsg } from '@llui/components/qr-code'
import { sectionGroup, card } from '../shared/ui'

type Item = { id: number; label: string }

type State = {
  toc: TocState
  cascade: CascadeSelectState
  list: AsyncListState<Item>
  presence: PresenceState
  qr: QrCodeState
}
type Msg =
  | { type: 'toc'; msg: TocMsg }
  | { type: 'cascade'; msg: CascadeSelectMsg }
  | { type: 'list'; msg: AsyncListMsg<Item> }
  | { type: 'presence'; msg: PresenceMsg }
  | { type: 'qr'; msg: QrCodeMsg }
  | { type: 'loadPage' }

// Simulated QR matrix — in a real app this comes from a QR encoder library.
// Here we draw a recognizable pattern so the demo has something to show.
const demoQrMatrix: boolean[][] = (() => {
  const n = 21
  const m: boolean[][] = []
  for (let y = 0; y < n; y++) {
    const row: boolean[] = []
    for (let x = 0; x < n; x++) {
      // Finder patterns at corners
      const finder =
        (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7)
      const onFinder =
        finder &&
        ((x === 0 || x === 6 || y === 0 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4)) &&
          !((x === n - 7 && x >= 0) || (y === n - 7 && y >= 0)))
      row.push(onFinder || (!finder && ((x * 7 + y * 13) % 3 === 0)))
    }
    m.push(row)
  }
  return m
})()

const init = (): [State, never[]] => [
  {
    toc: toc.init({
      items: [
        { id: 'intro', label: 'Introduction', level: 1 },
        { id: 'install', label: 'Installation', level: 1 },
        { id: 'install-npm', label: 'via npm', level: 2 },
        { id: 'install-cdn', label: 'via CDN', level: 2 },
        { id: 'api', label: 'API Reference', level: 1 },
      ],
      activeId: 'install',
    }),
    cascade: cascadeSelect.init({
      levels: [
        {
          id: 'country',
          label: 'Country',
          options: [
            { value: 'US', label: 'United States' },
            { value: 'IT', label: 'Italy' },
          ],
        },
        {
          id: 'region',
          label: 'Region',
          options: [
            { value: 'CA', label: 'California' },
            { value: 'NY', label: 'New York' },
            { value: 'MI', label: 'Milan' },
            { value: 'RM', label: 'Rome' },
          ],
        },
      ],
    }),
    list: asyncList.init({
      items: [
        { id: 1, label: 'First item' },
        { id: 2, label: 'Second item' },
        { id: 3, label: 'Third item' },
      ],
    }),
    presence: presence.init({ present: true, unmountOnExit: false }),
    qr: qrCode.init({ value: 'https://llui.dev', matrix: demoQrMatrix }),
  },
  [],
]

const update = mergeHandlers<State, Msg, never>(
  sliceHandler({
    get: (s) => s.toc,
    set: (s, v) => ({ ...s, toc: v }),
    narrow: (m) => (m.type === 'toc' ? m.msg : null),
    sub: toc.update,
  }),
  sliceHandler({
    get: (s) => s.cascade,
    set: (s, v) => ({ ...s, cascade: v }),
    narrow: (m) => (m.type === 'cascade' ? m.msg : null),
    sub: cascadeSelect.update,
  }),
  sliceHandler({
    get: (s) => s.list,
    set: (s, v) => ({ ...s, list: v }),
    narrow: (m) => (m.type === 'list' ? m.msg : null),
    sub: asyncList.update,
  }),
  sliceHandler({
    get: (s) => s.presence,
    set: (s, v) => ({ ...s, presence: v }),
    narrow: (m) => (m.type === 'presence' ? m.msg : null),
    sub: presence.update,
  }),
  sliceHandler({
    get: (s) => s.qr,
    set: (s, v) => ({ ...s, qr: v }),
    narrow: (m) => (m.type === 'qr' ? m.msg : null),
    sub: qrCode.update,
  }),
  // Simulate an async page load by transitioning through loading then
  // pageLoaded synchronously. In a real app this would fire an effect
  // and dispatch pageLoaded from the response handler.
  (state, msg) => {
    if (msg.type !== 'loadPage') return null
    const nextPage = state.list.page + 1
    const fakeItems: Item[] = Array.from({ length: 3 }, (_, i) => ({
      id: state.list.items.length + i + 1,
      label: `Page ${nextPage} item ${i + 1}`,
    }))
    const [ls] = asyncList.update(state.list, { type: 'loadMore' })
    const [done] = asyncList.update(ls, {
      type: 'pageLoaded',
      items: fakeItems,
      hasMore: nextPage < 3,
    })
    return [{ ...state, list: done }, []]
  },
)

export const App = component<State, Msg, never>({
  name: 'ContentSection',
  init,
  update,
  view: (send) => {
    const tc = toc.connect<State>(
      (s) => s.toc,
      (m) => send({ type: 'toc', msg: m }),
    )
    const cs = cascadeSelect.connect<State>(
      (s) => s.cascade,
      (m) => send({ type: 'cascade', msg: m }),
      { id: 'cs-demo' },
    )
    const al = asyncList.connect<State, Item>(
      (s) => s.list,
      (m) => send({ type: 'list', msg: m }),
    )
    const pr = presence.connect<State>(
      (s) => s.presence,
      (m) => send({ type: 'presence', msg: m }),
    )
    // qrCode.connect exposed for full usage; here we use the static
    // toDataUrl helper directly for brevity.
    void qrCode.connect<State>(
      (s) => s.qr,
      (m) => send({ type: 'qr', msg: m }),
    )

    return [
      sectionGroup('Content + data', [
        card('Table of Contents', [
          div({ ...tc.root }, [
            ul(
              { ...tc.list, class: 'flex flex-col gap-1 text-sm' },
              tc.root['data-scope']
                ? ['intro', 'install', 'install-npm', 'install-cdn', 'api'].map((id) => {
                    const entry = {
                      id,
                      label: id.replace('-', ' '),
                      level: id.includes('-') ? 2 : 1,
                    }
                    const p = tc.item(entry)
                    return li({ ...p.item, class: 'flex items-center' }, [
                      a(
                        {
                          ...p.link,
                          class: 'block px-2 py-1 rounded',
                          style: (s: State) =>
                            `padding-left: ${entry.level * 0.75}rem; ` +
                            (s.toc.activeId === id
                              ? 'background: rgb(219 234 254); color: rgb(29 78 216); font-weight: 600;'
                              : 'color: rgb(71 85 105);'),
                        },
                        [text(entry.label)],
                      ),
                    ])
                  })
                : [],
            ),
          ]),
          div({ class: 'mt-2 flex gap-2' }, [
            button(
              {
                class: 'btn btn-secondary text-xs',
                onClick: () => send({ type: 'toc', msg: { type: 'setActive', id: 'intro' } }),
              },
              [text('Activate intro')],
            ),
            button(
              {
                class: 'btn btn-secondary text-xs',
                onClick: () => send({ type: 'toc', msg: { type: 'setActive', id: 'api' } }),
              },
              [text('Activate API')],
            ),
          ]),
        ]),
        card('Cascade Select', [
          div({ ...cs.root, class: 'flex flex-col gap-2' }, [
            span({ class: 'text-xs text-slate-600' }, [
              text('Country → Region (selecting a country resets the region)'),
            ]),
            div({ class: 'text-sm text-slate-700' }, [
              text('Selected: '),
              text((s: State) => s.cascade.values.filter(Boolean).join(' → ') || '(none)'),
            ]),
            div({ class: 'flex gap-2' }, [
              button(
                {
                  class: 'btn btn-secondary text-xs',
                  onClick: () =>
                    send({ type: 'cascade', msg: { type: 'setValue', levelIndex: 0, value: 'US' } }),
                },
                [text('US')],
              ),
              button(
                {
                  class: 'btn btn-secondary text-xs',
                  onClick: () =>
                    send({ type: 'cascade', msg: { type: 'setValue', levelIndex: 0, value: 'IT' } }),
                },
                [text('Italy')],
              ),
              button(
                {
                  class: 'btn btn-secondary text-xs',
                  onClick: () =>
                    send({ type: 'cascade', msg: { type: 'setValue', levelIndex: 1, value: 'MI' } }),
                  disabled: (s: State) => !cascadeSelect.isLevelReady(s.cascade, 1),
                },
                [text('Milan')],
              ),
              button(
                { ...cs.clearTrigger, class: 'btn btn-secondary text-xs' },
                [text('Clear')],
              ),
            ]),
          ]),
        ]),
        card('Async List', [
          div({ ...al.root, class: 'flex flex-col gap-1' }, [
            ...each<State, Item, AsyncListMsg<Item>>({
              items: (s) => s.list.items,
              key: (i) => i.id,
              render: ({ item }) => [
                div({ class: 'px-2 py-1 rounded bg-slate-50 text-sm' }, [text(() => item.label())]),
              ],
            }),
            div({ class: 'mt-2 flex gap-2' }, [
              button(
                {
                  ...al.loadMoreTrigger,
                  class: 'btn btn-primary text-xs',
                  onClick: () => send({ type: 'loadPage' }),
                },
                [
                  text((s: State) =>
                    s.list.hasMore ? `Load page ${s.list.page + 1}` : 'No more pages',
                  ),
                ],
              ),
              span({ class: 'text-xs text-slate-500' }, [
                text((s: State) => `status: ${s.list.status} · ${s.list.items.length} items`),
              ]),
            ]),
          ]),
        ]),
        card('Presence', [
          div({ class: 'flex items-center gap-3' }, [
            button(
              {
                class: 'btn btn-secondary text-xs',
                onClick: () => send({ type: 'presence', msg: { type: 'toggle' } }),
              },
              [text((s: State) => (presence.isVisible(s.presence) ? 'Hide' : 'Show'))],
            ),
            div(
              {
                ...pr.root,
                class: 'rounded border border-slate-300 px-3 py-2 text-sm transition-opacity',
                style: (s: State) =>
                  presence.isVisible(s.presence) ? 'opacity: 1;' : 'opacity: 0;',
              },
              [text((s: State) => `Status: ${s.presence.status}`)],
            ),
          ]),
        ]),
        card('QR Code', [
          div({ class: 'flex items-center gap-4' }, [
            img({
              alt: 'QR code',
              class: 'w-24 h-24',
              src: () => qrCode.toDataUrl(demoQrMatrix, '#0f172a', '#f8fafc'),
            }),
            div({ class: 'flex flex-col gap-1 text-xs text-slate-600' }, [
              text('Matrix: '),
              text((s: State) => `${qrCode.size(s.qr)}×${qrCode.size(s.qr)}`),
              text('Value: '),
              span({ class: 'font-mono' }, [text((s: State) => s.qr.value)]),
            ]),
          ]),
        ]),
      ]),
    ]
  },
})
