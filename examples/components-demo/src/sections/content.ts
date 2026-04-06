import {
  component,
  mergeHandlers,
  sliceHandler,
  div,
  button,
  span,
  text,
  p,
  a,
  ul,
  li,
  img,
  input,
  each,
} from '@llui/dom'
import { toc, type TocState, type TocMsg } from '@llui/components/toc'
import {
  cascadeSelect,
  type CascadeSelectState,
  type CascadeSelectMsg,
} from '@llui/components/cascade-select'
import { asyncList, type AsyncListState, type AsyncListMsg } from '@llui/components/async-list'
import { presence, type PresenceState, type PresenceMsg } from '@llui/components/presence'
import { qrCode, type QrCodeState, type QrCodeMsg } from '@llui/components/qr-code'
import { encode as uqrEncode } from 'uqr'
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
  | { type: 'qrInput'; value: string }
  | { type: 'loadPage' }

// uqr returns { data: boolean[][], size, version } — we just need the 2D
// array in llui's matrix shape.
function encodeQr(value: string): boolean[][] {
  if (!value) return []
  const result = uqrEncode(value, { ecc: 'M' })
  // result.data is boolean[][] already
  return result.data
}

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
        // Region options are swapped in by the consumer based on the
        // currently-selected country — see the view for the filtering.
        { id: 'region', label: 'Region', options: [] },
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
    qr: qrCode.init({ value: 'https://llui.dev', matrix: encodeQr('https://llui.dev') }),
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
  // Typing in the input box: re-encode on every keystroke and update
  // both value + matrix in one step.
  (state, msg) => {
    if (msg.type !== 'qrInput') return null
    const matrix = encodeQr(msg.value)
    return [{ ...state, qr: { ...state.qr, value: msg.value, matrix } }, []]
  },
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
  view: ({ send }) => {
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
          div({ ...cs.root, class: 'flex flex-col gap-3' }, [
            p({ class: 'text-xs text-text-muted' }, [
              text(
                'Region options depend on the selected country; choosing a new country resets the region.',
              ),
            ]),
            // Country buttons
            div({ class: 'flex items-center gap-2' }, [
              span({ class: 'text-xs font-semibold text-text-muted w-16' }, [text('Country:')]),
              button(
                {
                  class: 'btn text-xs',
                  style: (s: State) =>
                    s.cascade.values[0] === 'US'
                      ? 'background:rgb(37 99 235);color:white;'
                      : 'background:rgb(241 245 249);',
                  onClick: () =>
                    send({
                      type: 'cascade',
                      msg: { type: 'setValue', levelIndex: 0, value: 'US' },
                    }),
                },
                [text('United States')],
              ),
              button(
                {
                  class: 'btn text-xs',
                  style: (s: State) =>
                    s.cascade.values[0] === 'IT'
                      ? 'background:rgb(37 99 235);color:white;'
                      : 'background:rgb(241 245 249);',
                  onClick: () =>
                    send({
                      type: 'cascade',
                      msg: { type: 'setValue', levelIndex: 0, value: 'IT' },
                    }),
                },
                [text('Italy')],
              ),
            ]),
            // Region buttons — filtered by country
            div({ class: 'flex items-center gap-2 flex-wrap' }, [
              span({ class: 'text-xs font-semibold text-text-muted w-16' }, [text('Region:')]),
              // Branch-per-country so the visible button set depends on
              // the value. Buttons without a country get data-ready=false.
              button(
                {
                  class: 'btn text-xs',
                  style: (s: State) => {
                    const country = s.cascade.values[0]
                    if (country !== 'US') return 'display:none;'
                    return s.cascade.values[1] === 'CA'
                      ? 'background:rgb(37 99 235);color:white;'
                      : 'background:rgb(241 245 249);'
                  },
                  onClick: () =>
                    send({
                      type: 'cascade',
                      msg: { type: 'setValue', levelIndex: 1, value: 'CA' },
                    }),
                },
                [text('California')],
              ),
              button(
                {
                  class: 'btn text-xs',
                  style: (s: State) => {
                    if (s.cascade.values[0] !== 'US') return 'display:none;'
                    return s.cascade.values[1] === 'NY'
                      ? 'background:rgb(37 99 235);color:white;'
                      : 'background:rgb(241 245 249);'
                  },
                  onClick: () =>
                    send({
                      type: 'cascade',
                      msg: { type: 'setValue', levelIndex: 1, value: 'NY' },
                    }),
                },
                [text('New York')],
              ),
              button(
                {
                  class: 'btn text-xs',
                  style: (s: State) => {
                    if (s.cascade.values[0] !== 'IT') return 'display:none;'
                    return s.cascade.values[1] === 'MI'
                      ? 'background:rgb(37 99 235);color:white;'
                      : 'background:rgb(241 245 249);'
                  },
                  onClick: () =>
                    send({
                      type: 'cascade',
                      msg: { type: 'setValue', levelIndex: 1, value: 'MI' },
                    }),
                },
                [text('Milan')],
              ),
              button(
                {
                  class: 'btn text-xs',
                  style: (s: State) => {
                    if (s.cascade.values[0] !== 'IT') return 'display:none;'
                    return s.cascade.values[1] === 'RM'
                      ? 'background:rgb(37 99 235);color:white;'
                      : 'background:rgb(241 245 249);'
                  },
                  onClick: () =>
                    send({
                      type: 'cascade',
                      msg: { type: 'setValue', levelIndex: 1, value: 'RM' },
                    }),
                },
                [text('Rome')],
              ),
              span(
                {
                  class: 'text-xs text-text-muted italic',
                  style: (s: State) => (s.cascade.values[0] === null ? '' : 'display:none;'),
                },
                [text('(pick a country first)')],
              ),
            ]),
            // Current selection readout
            div({ class: 'text-sm font-mono text-text bg-surface-muted px-2 py-1 rounded' }, [
              text('Selection: '),
              text(
                (s: State) =>
                  s.cascade.values.filter((v): v is string => v !== null).join(' → ') || '(none)',
              ),
            ]),
            div({ class: 'flex gap-2' }, [
              button({ ...cs.clearTrigger, class: 'btn btn-secondary text-xs' }, [text('Clear')]),
            ]),
          ]),
        ]),
        card('Async List', [
          div({ ...al.root, class: 'flex flex-col gap-1' }, [
            ...each<State, Item, AsyncListMsg<Item>>({
              items: (s) => s.list.items,
              key: (i) => i.id,
              render: ({ item }) => [
                div({ class: 'px-2 py-1 rounded bg-surface-muted text-sm' }, [
                  text(() => item.label()),
                ]),
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
              span({ class: 'text-xs text-text-muted' }, [
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
                class: 'rounded border border-border px-3 py-2 text-sm transition-opacity',
                style: (s: State) =>
                  presence.isVisible(s.presence) ? 'opacity: 1;' : 'opacity: 0;',
              },
              [text((s: State) => `Status: ${s.presence.status}`)],
            ),
          ]),
        ]),
        card('QR Code', [
          div({ class: 'flex flex-col gap-3' }, [
            p({ class: 'text-xs text-text-muted' }, [
              text("Type in the box to re-encode. llui's qr-code component holds the matrix; "),
              text('this demo uses '),
              span({ class: 'font-mono' }, [text('uqr')]),
              text(' for the encoding.'),
            ]),
            // Text input — encodes on every keystroke.
            input({
              type: 'text',
              class:
                'w-full px-3 py-2 border border-border rounded font-mono text-sm ' +
                'focus:outline-none focus:ring-2 focus:ring-blue-200',
              placeholder: 'Type URL or text…',
              value: (s: State) => s.qr.value,
              onInput: (e: Event) =>
                send({ type: 'qrInput', value: (e.target as HTMLInputElement).value }),
            }),
            div({ class: 'flex items-center gap-4' }, [
              img({
                alt: 'QR code',
                class: 'w-32 h-32 border border-border rounded bg-white',
                src: (s: State) =>
                  s.qr.matrix.length > 0 ? qrCode.toDataUrl(s.qr.matrix, '#0f172a', '#ffffff') : '',
              }),
              div({ class: 'flex flex-col gap-1 text-xs text-text-muted' }, [
                div([
                  text('Size: '),
                  span({ class: 'font-mono text-text' }, [
                    text((s: State) => `${qrCode.size(s.qr)}×${qrCode.size(s.qr)}`),
                  ]),
                ]),
                div([
                  text('Value: '),
                  span({ class: 'font-mono text-text break-all' }, [
                    text((s: State) => s.qr.value || '(empty)'),
                  ]),
                ]),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]
  },
})
