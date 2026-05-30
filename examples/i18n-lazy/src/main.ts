import { component, mountApp, div, h1, h2, p, button, text, show, lazy, provide } from '@llui/dom'
import type { Send, Signal } from '@llui/dom'
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

const AR_MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
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

const ar: Locale = {
  ...en,
  dialog: { close: 'إغلاق' },
  popover: { close: 'إغلاق' },
  drawer: { close: 'إغلاق' },
  tour: { close: 'إغلاق الجولة' },
  datePicker: {
    prev: 'الشهر السابق',
    next: 'الشهر التالي',
    monthNames: AR_MONTHS,
    grid: (y, m) => `${AR_MONTHS[m - 1]} ${y}`,
  },
}

type LocaleKey = 'en' | 'es' | 'ja' | 'ar'

function getLocale(key: LocaleKey): Locale {
  if (key === 'es') return es
  if (key === 'ja') return ja
  if (key === 'ar') return ar
  return en
}

function getBcp47(key: LocaleKey): string {
  if (key === 'es') return 'es-ES'
  if (key === 'ja') return 'ja-JP'
  if (key === 'ar') return 'ar-SA'
  return 'en-US'
}

function getLabel(key: LocaleKey): string {
  if (key === 'es') return 'Español'
  if (key === 'ja') return '日本語'
  if (key === 'ar') return 'العربية'
  return 'English'
}

function getDir(key: LocaleKey): 'ltr' | 'rtl' {
  return key === 'ar' ? 'rtl' : 'ltr'
}

function dialogGreeting(key: LocaleKey): string {
  if (key === 'es') return 'Hola, mundo'
  if (key === 'ja') return 'こんにちは、世界'
  if (key === 'ar') return 'مرحبًا بالعالم'
  return 'Hello, world'
}

// ── State ───────────────────────────────────────────────────────

type State = {
  localeKey: LocaleKey
  showStats: boolean
  dialog: DialogState
}

type Msg =
  /**
   * @intent("Set the locale for the application")
   * @example({"type":"setLocale","key":"fr"})
   * @emits("syncHtmlLocale")
   */
  | { type: 'setLocale'; key: LocaleKey }
  /** @intent("Load statistics asynchronously") */
  | { type: 'loadStats' }
  /**
   * @intent("Forward a sub-message to the dialog component")
   * @example({"type":"dialog","msg":{"type":"open"}})
   */
  | { type: 'dialog'; msg: DialogMsg }

// Mirrors `dir` + `lang` onto the document's <html> so RTL scripts
// flip the whole document layout. Imperative DOM is a side effect;
// updates return it as an Effect instead of mutating directly.
type Effect = { kind: 'syncHtmlLocale'; key: LocaleKey }

// ── Component ───────────────────────────────────────────────────

const App = component<State, Msg, Effect>({
  name: 'I18nLazyDemo',
  init: () => [{ localeKey: 'en' as LocaleKey, showStats: false, dialog: dialog.init() }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'setLocale':
        return [{ ...state, localeKey: msg.key }, [{ kind: 'syncHtmlLocale', key: msg.key }]]
      case 'loadStats':
        return [{ ...state, showStats: true }, []]
      case 'dialog':
        return [{ ...state, dialog: dialog.update(state.dialog, msg.msg)[0] }, []]
    }
  },
  onEffect: (effect) => {
    if (effect.kind === 'syncHtmlLocale' && typeof document !== 'undefined') {
      document.documentElement.dir = getDir(effect.key)
      document.documentElement.lang = getBcp47(effect.key)
    }
  },
  view: ({ state, send }) => {
    // connect() runs inside the provider so dialog's default closeLabel
    // resolves the LocaleContext. The context value is build-time, so the
    // initial locale's close label is used; the close button's visible text
    // tracks the locale reactively below via state.map.
    const dlg = dialog.connect(state.at('dialog'), (m) => send({ type: 'dialog', msg: m }), {
      id: 'confirm',
    })

    // LocaleContext is a build-time value (the signal runtime resolves
    // useContext() once when the view is built). Provide the initial locale's
    // labels; the close button's visible text tracks the locale reactively
    // below via state.map. (Reactive context is a known signal gap — see the
    // migration notes.)
    return [
      provide(LocaleContext, getLocale('en'), () => [
        h1([text('Locale + Lazy')]),
        p({ class: 'subtitle' }, [
          text(
            state
              .at('localeKey')
              .map((key) => formatDate(new Date(), { locale: getBcp47(key), dateStyle: 'full' })),
          ),
        ]),

        div({ class: 'locale-row' }, [
          localeBtn(state.at('localeKey'), send, 'en'),
          localeBtn(state.at('localeKey'), send, 'es'),
          localeBtn(state.at('localeKey'), send, 'ja'),
          localeBtn(state.at('localeKey'), send, 'ar'),
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
            show(
              state.at('showStats').map((shown) => !shown),
              () => [
                button({ class: 'primary', onClick: () => send({ type: 'loadStats' }) }, [
                  text('Load stats'),
                ]),
              ],
              () => [
                lazy({
                  // lazy() infers the loaded component's S/M/E from the loader,
                  // so `initialState` is typed (StatsState) with no cast.
                  loader: () => import('./stats-module').then((m) => m.default),
                  fallback: () => [p({ class: 'loading' }, [text('Loading stats module...')])],
                  error: (err) => [p({ class: 'error' }, [text(`Error: ${err.message}`)])],
                  initialState: {
                    locale: getBcp47(state.at('localeKey').peek()),
                  },
                }),
              ],
            ),
          ]),
        ]),

        // Dialog overlay
        dialog.overlay({
          state: state.at('dialog'),
          send: (m) => send({ type: 'dialog', msg: m }),
          parts: dlg,
          content: () => [
            div({ ...dlg.content }, [
              div({ ...dlg.title, class: 'dialog-title' }, [
                text(state.at('localeKey').map(dialogGreeting)),
              ]),
              p([
                text(
                  state.at('localeKey').map((key) =>
                    formatRelativeTime(-3, 'minute', {
                      locale: getBcp47(key),
                      numeric: 'auto',
                    }),
                  ),
                ),
              ]),
              div({ class: 'dialog-actions' }, [
                button({ ...dlg.closeTrigger, class: 'primary' }, [
                  text(state.at('localeKey').map((key) => getLocale(key).dialog.close)),
                ]),
              ]),
            ]),
          ],
        }),
      ]),
    ]
  },
})

function localeBtn(localeKey: Signal<LocaleKey>, send: Send<Msg>, key: LocaleKey): Node {
  return button(
    {
      class: localeKey.map((k) => `locale-btn${k === key ? ' active' : ''}`),
      onClick: () => send({ type: 'setLocale', key }),
      'aria-pressed': localeKey.map((k) => k === key),
    },
    [text(getLabel(key))],
  )
}

document.documentElement.dir = 'ltr'
document.documentElement.lang = 'en-US'
mountApp(document.getElementById('app')!, App)
