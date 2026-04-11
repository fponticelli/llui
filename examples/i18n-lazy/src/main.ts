import { component, mountApp, div, h1, h2, p, button, lazy, provide } from '@llui/dom'
import type { Send, View } from '@llui/dom'
import { LocaleContext, en, formatDate, formatRelativeTime, dialog } from '@llui/components'
import type { Locale, DialogState, DialogMsg } from '@llui/components'

// ── Custom locales ──────────────────────────────────────────────
// Spanish and Japanese overrides for @llui/components labels. Other
// locales fall back to English defaults via the context.

const ES_MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]

const JA_MONTHS = [
  '1月',
  '2月',
  '3月',
  '4月',
  '5月',
  '6月',
  '7月',
  '8月',
  '9月',
  '10月',
  '11月',
  '12月',
]

const es: Locale = {
  ...en,
  dialog: { close: 'Cerrar' },
  popover: { close: 'Cerrar' },
  drawer: { close: 'Cerrar' },
  tour: { close: 'Cerrar recorrido' },
  datePicker: {
    prev: 'Mes anterior',
    next: 'Mes siguiente',
    monthNames: ES_MONTHS,
    grid: (y, m) => `${ES_MONTHS[m - 1]} ${y}`,
  },
}

const ja: Locale = {
  ...en,
  dialog: { close: '閉じる' },
  popover: { close: '閉じる' },
  drawer: { close: '閉じる' },
  tour: { close: 'ツアーを閉じる' },
  datePicker: {
    prev: '前月',
    next: '翌月',
    monthNames: JA_MONTHS,
    grid: (y, m) => `${y}年${m}月`,
  },
}

type LocaleKey = 'en' | 'es' | 'ja'

function getLocale(key: LocaleKey): Locale {
  if (key === 'es') return es
  if (key === 'ja') return ja
  return en
}

function getBcp47(key: LocaleKey): string {
  if (key === 'es') return 'es-ES'
  if (key === 'ja') return 'ja-JP'
  return 'en-US'
}

function getLabel(key: LocaleKey): string {
  if (key === 'es') return 'Español'
  if (key === 'ja') return '日本語'
  return 'English'
}

function dialogGreeting(key: LocaleKey): string {
  if (key === 'es') return 'Hola, mundo'
  if (key === 'ja') return 'こんにちは、世界'
  return 'Hello, world'
}

// ── State ───────────────────────────────────────────────────────

type State = {
  localeKey: LocaleKey
  showStats: boolean
  dialog: DialogState
}

type Msg =
  | { type: 'setLocale'; key: LocaleKey }
  | { type: 'loadStats' }
  | { type: 'dialog'; msg: DialogMsg }

// ── Component ───────────────────────────────────────────────────

const App = component<State, Msg, never>({
  name: 'I18nLazyDemo',
  init: () => [{ localeKey: 'en' as LocaleKey, showStats: false, dialog: dialog.init() }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'setLocale':
        return [{ ...state, localeKey: msg.key }, []]
      case 'loadStats':
        return [{ ...state, showStats: true }, []]
      case 'dialog':
        return [{ ...state, dialog: dialog.update(state.dialog, msg.msg)[0] }, []]
    }
  },
  view: (h) => {
    const { send, text, show } = h
    const dlg = dialog.connect<State>(
      (s) => s.dialog,
      (m) => send({ type: 'dialog', msg: m }),
      { id: 'confirm' },
    )

    return [
      ...provide(
        LocaleContext,
        (s: State) => getLocale(s.localeKey),
        () => [
          h1([text('Locale + Lazy')]),
          p({ class: 'subtitle' }, [
            text((s: State) =>
              formatDate(new Date(), { locale: getBcp47(s.localeKey), dateStyle: 'full' }),
            ),
          ]),

          div({ class: 'locale-row' }, [
            localeBtn(text, send, 'en'),
            localeBtn(text, send, 'es'),
            localeBtn(text, send, 'ja'),
          ]),

          // Section 1: dialog reads close label from LocaleContext
          div({ class: 'card' }, [
            h2([text('LocaleContext → dialog component')]),
            p([
              text(
                "The dialog's close button reads its label from LocaleContext. Switch locale above, then open the dialog.",
              ),
            ]),
            div({ style: 'margin-top: 1rem' }, [
              button({ ...dlg.trigger, class: 'primary' }, [text('Open dialog')]),
            ]),
          ]),

          // Section 2: lazy-loaded stats module
          div({ class: 'card' }, [
            h2([text('lazy() → code-split component')]),
            p([
              text(
                'Click to lazy-load a stats module. The fallback shows while import() resolves, then the component mounts.',
              ),
            ]),
            div({ style: 'margin-top: 1rem' }, [
              ...show({
                when: (s) => !s.showStats,
                render: ({ text }) => [
                  button({ class: 'primary', onClick: () => send({ type: 'loadStats' }) }, [
                    text('Load stats'),
                  ]),
                ],
                fallback: () => [
                  ...lazy<State, Msg, never, { locale: string }>({
                    loader: () => import('./stats-module').then((m) => m.default),
                    fallback: ({ text }) => [
                      p({ class: 'loading' }, [text('Loading stats module...')]),
                    ],
                    error: (err, { text }) => [
                      p({ class: 'error' }, [text(`Error: ${err.message}`)]),
                    ],
                    data: (s: State) => ({ locale: getBcp47(s.localeKey) }),
                  }),
                ],
              }),
            ]),
          ]),

          // Dialog overlay
          ...dialog.overlay({
            get: (s) => s.dialog,
            send: (m) => send({ type: 'dialog', msg: m }),
            parts: dlg,
            content: () => [
              div({ ...dlg.content }, [
                div({ ...dlg.title, class: 'dialog-title' }, [
                  text((s: State) => dialogGreeting(s.localeKey)),
                ]),
                p([
                  text((s: State) =>
                    formatRelativeTime(-3, 'minute', {
                      locale: getBcp47(s.localeKey),
                      numeric: 'auto',
                    }),
                  ),
                ]),
                div({ class: 'dialog-actions' }, [
                  button({ ...dlg.closeTrigger, class: 'primary' }, []),
                ]),
              ]),
            ],
          }),
        ],
      ),
    ]
  },
})

type TextFn = View<State, Msg>['text']

function localeBtn(text: TextFn, send: Send<Msg>, key: LocaleKey): HTMLElement {
  return button(
    {
      class: (s: State) => `locale-btn${s.localeKey === key ? ' active' : ''}`,
      onClick: () => send({ type: 'setLocale', key }),
      'aria-pressed': (s: State) => s.localeKey === key,
    },
    [text(getLabel(key))],
  )
}

mountApp(document.getElementById('app')!, App)
