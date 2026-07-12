// Markdown showcase — a single LLui component wiring a live editor to a reactive
// markdown() preview, plus a streaming demo, a custom-renderers toggle, and a
// light/dark theme toggle.

import { component, div, header, button, span, text, label, input, show, foreign } from '@llui/dom'
import { markdown } from '@llui/markdown'
import { delay, handleEffects, asOnEffect, type TimeoutEffect } from '@llui/effects'
import { SAMPLE } from './sample.js'
import { fancyRenderers } from './renderers.js'

interface State {
  /** the editor's current content — the single source of truth for the preview */
  source: string
  dark: boolean
  /** when true, the preview uses the custom (fancy) renderers */
  fancy: boolean
  streaming: boolean
  /** words still queued for the streaming demo */
  queue: string[]
}

type Msg =
  | { type: 'edit'; value: string }
  | { type: 'toggleTheme' }
  | { type: 'toggleFancy' }
  | { type: 'reset' }
  | { type: 'startStream' }
  | { type: 'streamTick' }
  | { type: 'stopStream' }

// The streaming demo advances one token per timer tick. Scheduling the next tick
// is a side effect, expressed as data via @llui/effects `delay(ms, msg)` and run
// by the `handleEffects` chain in `onEffect` — the timer auto-cancels on unmount.
type Effect = TimeoutEffect

const STREAM_MS = 45

export const App = component<State, Msg, Effect>({
  init: () => ({ source: SAMPLE, dark: false, fancy: false, streaming: false, queue: [] }),

  update: (s, m) => {
    switch (m.type) {
      case 'edit':
        // a manual edit cancels any in-flight stream
        return [{ ...s, source: m.value, streaming: false, queue: [] }, []]
      case 'toggleTheme':
        return [{ ...s, dark: !s.dark }, []]
      case 'toggleFancy':
        return [{ ...s, fancy: !s.fancy }, []]
      case 'reset':
        return [{ ...s, source: SAMPLE, streaming: false, queue: [] }, []]
      case 'startStream': {
        // tokenize the sample into words (keeping whitespace) and stream them in
        const tokens = SAMPLE.match(/\s+|\S+/g) ?? []
        return [
          { ...s, source: '', streaming: true, queue: tokens },
          [delay(STREAM_MS, { type: 'streamTick' })],
        ]
      }
      case 'streamTick': {
        if (!s.streaming || s.queue.length === 0) return [{ ...s, streaming: false, queue: [] }, []]
        const [next, ...rest] = s.queue
        const done = rest.length === 0
        return [
          { ...s, source: s.source + next, queue: rest, streaming: !done },
          done ? [] : [delay(STREAM_MS, { type: 'streamTick' })],
        ]
      }
      case 'stopStream':
        return [{ ...s, streaming: false, queue: [] }, []]
    }
  },

  onEffect: asOnEffect(handleEffects<Effect, Msg>().else(() => {})),

  view: ({ state, send }) => [
    div({ class: state.at('dark').map((d) => (d ? 'app dark' : 'app')) }, [
      header({ class: 'toolbar' }, [
        div({ class: 'brand' }, [
          span({ class: 'logo' }, [text('◆')]),
          span({ class: 'title' }, [text('LLui Markdown')]),
        ]),
        div({ class: 'actions' }, [
          button(
            {
              class: 'btn primary',
              disabled: state.at('streaming'),
              onClick: () => send({ type: 'startStream' }),
            },
            [text(state.at('streaming').map((on) => (on ? 'Streaming…' : '▶ Stream demo')))],
          ),
          show(
            state.at('streaming'),
            () => [
              button({ class: 'btn', onClick: () => send({ type: 'stopStream' }) }, [
                text('■ Stop'),
              ]),
            ],
            () => [
              button({ class: 'btn', onClick: () => send({ type: 'reset' }) }, [text('↺ Reset')]),
            ],
          ),
          label({ class: 'toggle' }, [
            input({
              type: 'checkbox',
              checked: state.at('fancy'),
              onChange: () => send({ type: 'toggleFancy' }),
            }),
            text('Custom renderers'),
          ]),
          button({ class: 'btn ghost', onClick: () => send({ type: 'toggleTheme' }) }, [
            text(state.at('dark').map((d) => (d ? '☀ Light' : '☾ Dark'))),
          ]),
        ]),
      ]),

      div({ class: 'panes' }, [
        // ── Editor (imperative textarea kept in sync with state.source) ──
        div({ class: 'pane editor-pane' }, [
          div({ class: 'pane-label' }, [text('Markdown')]),
          foreign({
            tag: 'div',
            state: { source: state.at('source') },
            mount: ({ el, state: sig }) => {
              const ta = el.ownerDocument.createElement('textarea')
              ta.className = 'editor'
              ta.spellcheck = false
              el.appendChild(ta)
              ta.addEventListener('input', () => send({ type: 'edit', value: ta.value }))
              // push state → textarea only when they differ (avoids clobbering typing)
              sig.source.bind((v) => {
                if (ta.value !== v) ta.value = v
              })
              return ta
            },
          }),
        ]),

        // ── Reactive preview ──
        div({ class: 'pane preview-pane' }, [
          div({ class: 'pane-label' }, [
            text('Preview'),
            span({ class: 'pill' }, [
              text(state.at('fancy').map((f) => (f ? 'custom renderers' : 'default'))),
            ]),
          ]),
          div(
            { class: 'preview', 'data-theme': state.at('dark').map((d) => (d ? 'dark' : 'light')) },
            [
              // Swap renderer sets via show(): toggling rebuilds the preview, while
              // editing/streaming within a set reuses unchanged blocks.
              show(
                state.at('fancy'),
                () => [markdown(state.at('source'), { renderers: fancyRenderers })],
                () => [markdown(state.at('source'))],
              ),
            ],
          ),
        ]),
      ]),
    ]),
  ],
})
