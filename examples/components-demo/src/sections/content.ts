import { div, button, span, p, a, ul, li, img, input, each, text } from '@llui/dom'
import type { Send, Signal } from '@llui/dom'
import { toc } from '@llui/components/toc'
import { cascadeSelect } from '@llui/components/cascade-select'
import { asyncList, type AsyncListState, type AsyncListMsg } from '@llui/components/async-list'
import { presence } from '@llui/components/presence'
import { qrCode } from '@llui/components/qr-code'
import { encode as uqrEncode } from 'uqr'
import { sectionGroup, card } from '../shared/ui'
import {
  composeModules,
  mergeHandlers,
  type ModulesState,
  type ModulesMsg,
} from '../shared/modules'

type Item = { id: number; label: string }

const children = { toc, cascade: cascadeSelect, list: asyncList, presence, qr: qrCode } as const

// `asyncList`'s generic defaults to `unknown` in the composed type, so pin the
// `list` slice (state + msgs) to our `Item` shape explicitly.
export type State = Omit<ModulesState<typeof children>, 'list'> & {
  list: AsyncListState<Item>
}
export type Msg =
  | Exclude<ModulesMsg<typeof children>, { type: 'list' }>
  | { type: 'list'; msg: AsyncListMsg<Item> }
  /**
   * @intent("Update the input value for the QR code")
   * @example({"type":"qrInput","value":"https://llui.dev"})
   */
  | { type: 'qrInput'; value: string }
  /** @intent("Load the next page of async list items") */
  | { type: 'loadPage' }

// uqr returns { data: boolean[][], size, version } — we just need the 2D
// array in llui's matrix shape.
function encodeQr(value: string): boolean[][] {
  if (!value) return []
  const result = uqrEncode(value, { ecc: 'M' })
  // result.data is boolean[][] already
  return result.data
}

export const init = (): [State, never[]] => [
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

export const update = mergeHandlers<State, Msg, never>(
  composeModules<State, Msg, never>(children),
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

export function view(state: Signal<State>, send: Send<Msg>): Node[] {
  const tc = toc.connect(state.at('toc'), (m) => send({ type: 'toc', msg: m }))
  const cs = cascadeSelect.connect(state.at('cascade'), (m) => send({ type: 'cascade', msg: m }), {
    id: 'cs-demo',
  })
  const al = asyncList.connect<Item>(state.at('list'), (m) => send({ type: 'list', msg: m }))
  const pr = presence.connect(state.at('presence'), (m) => send({ type: 'presence', msg: m }))
  // qrCode.connect exposed for full usage; here we use the static
  // toDataUrl helper directly for brevity.
  void qrCode.connect(state.at('qr'), (m) => send({ type: 'qr', msg: m }))

  return [
    sectionGroup('Content + data', [
      card('Table of Contents', [
        div({ ...tc.root }, [
          ul(
            { ...tc.list, class: 'flex flex-col gap-1 text-sm' },
            ['intro', 'install', 'install-npm', 'install-cdn', 'api'].map((id) => {
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
                    style: state
                      .at('toc')
                      .map(
                        (t) =>
                          `padding-left: ${entry.level * 0.75}rem; ` +
                          (t.activeId === id
                            ? 'background: rgb(219 234 254); color: rgb(29 78 216); font-weight: 600;'
                            : 'color: rgb(71 85 105);'),
                      ),
                  },
                  [text(entry.label)],
                ),
              ])
            }),
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
                class: state
                  .at('cascade')
                  .map((c) =>
                    c.values[0] === 'US' ? 'btn text-xs btn-primary' : 'btn text-xs btn-secondary',
                  ),
                onClick: () =>
                  send({ type: 'cascade', msg: { type: 'setValue', levelIndex: 0, value: 'US' } }),
              },
              [text('United States')],
            ),
            button(
              {
                class: state
                  .at('cascade')
                  .map((c) =>
                    c.values[0] === 'IT' ? 'btn text-xs btn-primary' : 'btn text-xs btn-secondary',
                  ),
                onClick: () =>
                  send({ type: 'cascade', msg: { type: 'setValue', levelIndex: 0, value: 'IT' } }),
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
                class: state.at('cascade').map((c) => {
                  const country = c.values[0]
                  if (country !== 'US') return 'btn text-xs btn-secondary hidden'
                  return c.values[1] === 'CA'
                    ? 'btn text-xs btn-primary'
                    : 'btn text-xs btn-secondary'
                }),
                onClick: () =>
                  send({ type: 'cascade', msg: { type: 'setValue', levelIndex: 1, value: 'CA' } }),
              },
              [text('California')],
            ),
            button(
              {
                class: state.at('cascade').map((c) => {
                  if (c.values[0] !== 'US') return 'btn text-xs btn-secondary hidden'
                  return c.values[1] === 'NY'
                    ? 'btn text-xs btn-primary'
                    : 'btn text-xs btn-secondary'
                }),
                onClick: () =>
                  send({ type: 'cascade', msg: { type: 'setValue', levelIndex: 1, value: 'NY' } }),
              },
              [text('New York')],
            ),
            button(
              {
                class: state.at('cascade').map((c) => {
                  if (c.values[0] !== 'IT') return 'btn text-xs btn-secondary hidden'
                  return c.values[1] === 'MI'
                    ? 'btn text-xs btn-primary'
                    : 'btn text-xs btn-secondary'
                }),
                onClick: () =>
                  send({ type: 'cascade', msg: { type: 'setValue', levelIndex: 1, value: 'MI' } }),
              },
              [text('Milan')],
            ),
            button(
              {
                class: 'btn text-xs',
                style: state.at('cascade').map((c) => {
                  if (c.values[0] !== 'IT') return 'display:none;'
                  return c.values[1] === 'RM'
                    ? 'background:rgb(37 99 235);color:white;'
                    : 'background:rgb(241 245 249);'
                }),
                onClick: () =>
                  send({ type: 'cascade', msg: { type: 'setValue', levelIndex: 1, value: 'RM' } }),
              },
              [text('Rome')],
            ),
            span(
              {
                class: 'text-xs text-text-muted italic',
                style: state
                  .at('cascade')
                  .map((c) => (c.values[0] === null ? '' : 'display:none;')),
              },
              [text('(pick a country first)')],
            ),
          ]),
          // Current selection readout
          div({ class: 'text-sm font-mono text-text bg-surface-muted px-2 py-1 rounded' }, [
            text('Selection: '),
            text(
              state
                .at('cascade')
                .map(
                  (c) => c.values.filter((v): v is string => v !== null).join(' → ') || '(none)',
                ),
            ),
          ]),
          div({ class: 'flex gap-2' }, [
            button({ ...cs.clearTrigger, class: 'btn btn-secondary text-xs' }, [text('Clear')]),
          ]),
        ]),
      ]),
      card('Async List', [
        div({ ...al.root, class: 'flex flex-col gap-1' }, [
          each(state.at('list.items'), {
            key: (i) => i.id,
            render: (item) => [
              div({ class: 'px-2 py-1 rounded bg-surface-muted text-sm' }, [
                text(item.at('label')),
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
                text(
                  state
                    .at('list')
                    .map((l) => (l.hasMore ? `Load page ${l.page + 1}` : 'No more pages')),
                ),
              ],
            ),
            span({ class: 'text-xs text-text-muted' }, [
              text(state.at('list').map((l) => `status: ${l.status} · ${l.items.length} items`)),
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
            [text(state.at('presence').map((p) => (presence.isVisible(p) ? 'Hide' : 'Show')))],
          ),
          div(
            {
              ...pr.root,
              class: 'rounded border border-border px-3 py-2 text-sm transition-opacity',
              style: state
                .at('presence')
                .map((p) => (presence.isVisible(p) ? 'opacity: 1;' : 'opacity: 0;')),
            },
            [text(state.at('presence').map((p) => `Status: ${p.status}`))],
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
            value: state.at('qr.value'),
            onInput: (e: Event) =>
              send({ type: 'qrInput', value: (e.target as HTMLInputElement).value }),
          }),
          div({ class: 'flex items-center gap-4' }, [
            img({
              alt: 'QR code',
              class: 'w-32 h-32 border border-border rounded bg-white',
              src: state
                .at('qr')
                .map((qr) =>
                  qr.matrix.length > 0 ? qrCode.toDataUrl(qr.matrix, '#0f172a', '#ffffff') : '',
                ),
            }),
            div({ class: 'flex flex-col gap-1 text-xs text-text-muted' }, [
              div([
                text('Size: '),
                span({ class: 'font-mono text-text' }, [
                  text(state.at('qr').map((qr) => `${qrCode.size(qr)}×${qrCode.size(qr)}`)),
                ]),
              ]),
              div([
                text('Value: '),
                span({ class: 'font-mono text-text break-all' }, [
                  text(state.at('qr.value').map((v) => v || '(empty)')),
                ]),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]),
  ]
}
