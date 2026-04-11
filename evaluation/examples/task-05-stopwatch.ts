/**
 * Task 05 — Stopwatch (Tier 6)
 * Idiomatic score: 6/6
 */
import { component, div, button } from '@llui/dom'

type State = {
  running: boolean
  elapsed: number
  bestLap: number | null
}

type Msg = { type: 'start' } | { type: 'stop' } | { type: 'reset' } | { type: 'tick' }

type Effect = { type: 'delay'; ms: number; onDone: Msg }

const TICK_MS = 10

function formatTime(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  const millis = ms % 1000
  return (
    String(minutes).padStart(2, '0') +
    ':' +
    String(seconds).padStart(2, '0') +
    ':' +
    String(millis).padStart(3, '0')
  )
}

export const Stopwatch = component<State, Msg, Effect>({
  name: 'Stopwatch',
  init: () => [{ running: false, elapsed: 0, bestLap: null }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'start':
        return [
          { ...state, running: true },
          [{ type: 'delay', ms: TICK_MS, onDone: { type: 'tick' } }],
        ]
      case 'stop': {
        const bestLap =
          state.bestLap === null ? state.elapsed : Math.min(state.bestLap, state.elapsed)
        return [{ ...state, running: false, bestLap }, []]
      }
      case 'reset':
        return [{ ...state, elapsed: 0, running: false }, []]
      case 'tick':
        if (state.running === false) return [state, []]
        return [
          { ...state, elapsed: state.elapsed + TICK_MS },
          [{ type: 'delay', ms: TICK_MS, onDone: { type: 'tick' } }],
        ]
    }
  },
  view: ({ send, text, show }) => [
    div({ class: 'stopwatch' }, [
      div({ class: 'display' }, [text((s) => formatTime(s.elapsed))]),
      div({ class: 'controls' }, [
        button(
          {
            onClick: () => send({ type: 'start' }),
            disabled: (s: State) => s.running,
          },
          [text('Start')],
        ),
        button(
          {
            onClick: () => send({ type: 'stop' }),
            disabled: (s: State) => s.running === false,
          },
          [text('Stop')],
        ),
        button({ onClick: () => send({ type: 'reset' }) }, [text('Reset')]),
      ]),
      ...show({
        when: (s) => s.bestLap !== null,
        render: () => [
          div({ class: 'best-lap' }, [text((s) => `Best lap: ${formatTime(s.bestLap!)}`)]),
        ],
      }),
    ]),
  ],
  onEffect: ({ effect, send }) => {
    if (effect.type === 'delay') {
      setTimeout(() => send(effect.onDone), effect.ms)
    }
  },
})
