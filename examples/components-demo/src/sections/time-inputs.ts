import {
  component,
  mergeHandlers,
  sliceHandler,
  div,
  button,
  span,
  text,
  input,
  p,
  onMount,
} from '@llui/dom'
import { timer, type TimerState, type TimerMsg } from '@llui/components/timer'
import {
  angleSlider,
  type AngleSliderState,
  type AngleSliderMsg,
} from '@llui/components/angle-slider'
import {
  dateInput,
  type DateInputState,
  type DateInputMsg,
} from '@llui/components/date-input'
import { marquee, type MarqueeState, type MarqueeMsg } from '@llui/components/marquee'
import { sectionGroup, card } from '../shared/ui'

type State = {
  timer: TimerState
  angle: AngleSliderState
  date: DateInputState
  marquee: MarqueeState
}
type Msg =
  | { type: 'timer'; msg: TimerMsg }
  | { type: 'angle'; msg: AngleSliderMsg }
  | { type: 'date'; msg: DateInputMsg }
  | { type: 'marquee'; msg: MarqueeMsg }

const init = (): [State, never[]] => [
  {
    timer: timer.init({ direction: 'up' }),
    angle: angleSlider.init({ value: 45, step: 5 }),
    date: dateInput.init({
      value: new Date(2026, 0, 15),
      min: new Date(2026, 0, 1),
      max: new Date(2026, 11, 31),
    }),
    marquee: marquee.init({ direction: 'left', durationSec: 15, pauseOnHover: true }),
  },
  [],
]

const update = mergeHandlers<State, Msg, never>(
  sliceHandler({
    get: (s) => s.timer,
    set: (s, v) => ({ ...s, timer: v }),
    narrow: (m) => (m.type === 'timer' ? m.msg : null),
    sub: timer.update,
  }),
  sliceHandler({
    get: (s) => s.angle,
    set: (s, v) => ({ ...s, angle: v }),
    narrow: (m) => (m.type === 'angle' ? m.msg : null),
    sub: angleSlider.update,
  }),
  sliceHandler({
    get: (s) => s.date,
    set: (s, v) => ({ ...s, date: v }),
    narrow: (m) => (m.type === 'date' ? m.msg : null),
    sub: dateInput.update,
  }),
  sliceHandler({
    get: (s) => s.marquee,
    set: (s, v) => ({ ...s, marquee: v }),
    narrow: (m) => (m.type === 'marquee' ? m.msg : null),
    sub: marquee.update,
  }),
)

export const App = component<State, Msg, never>({
  name: 'TimeInputsSection',
  init,
  update,
  view: (send) => {
    const tm = timer.connect<State>(
      (s) => s.timer,
      (m) => send({ type: 'timer', msg: m }),
    )
    const ag = angleSlider.connect<State>(
      (s) => s.angle,
      (m) => send({ type: 'angle', msg: m }),
    )
    // Pointer-click on the angle-slider control: compute angle from the
    // click position relative to the control's center, dispatch setValue.
    // Ongoing drag (pointermove) is installed in onMount below.
    const onControlDown = (e: PointerEvent): void => {
      const el = e.currentTarget as HTMLElement
      el.setPointerCapture(e.pointerId)
      const setFromPointer = (ev: PointerEvent): void => {
        const rect = el.getBoundingClientRect()
        const angle = angleSlider.angleFromPoint(rect, ev.clientX, ev.clientY)
        send({ type: 'angle', msg: { type: 'setValue', value: angle } })
      }
      setFromPointer(e)
      const onMove = (ev: PointerEvent): void => {
        if (ev.pointerId === e.pointerId) setFromPointer(ev)
      }
      const onUp = (ev: PointerEvent): void => {
        if (ev.pointerId !== e.pointerId) return
        el.releasePointerCapture(e.pointerId)
        el.removeEventListener('pointermove', onMove)
        el.removeEventListener('pointerup', onUp)
        el.removeEventListener('pointercancel', onUp)
      }
      el.addEventListener('pointermove', onMove)
      el.addEventListener('pointerup', onUp)
      el.addEventListener('pointercancel', onUp)
    }
    const di = dateInput.connect<State>(
      (s) => s.date,
      (m) => send({ type: 'date', msg: m }),
      { placeholder: 'YYYY-MM-DD' },
    )
    const mq = marquee.connect<State>(
      (s) => s.marquee,
      (m) => send({ type: 'marquee', msg: m }),
    )

    // Timer tick loop — dispatches `tick` at 100ms intervals while running.
    onMount(() => {
      const id = window.setInterval(() => {
        send({ type: 'timer', msg: { type: 'tick', now: Date.now() } })
      }, 100)
      return () => window.clearInterval(id)
    })

    return [
      sectionGroup('Time + new inputs', [
        card('Timer', [
          div({ ...tm.root, class: 'flex items-center gap-3' }, [
            div(
              {
                ...tm.display,
                class: 'font-mono text-2xl tabular-nums min-w-[6ch]',
              },
              [text((s: State) => timer.formatMs(timer.display(s.timer), 'mm:ss.S'))],
            ),
            button({ ...tm.startTrigger, class: 'btn btn-primary text-xs' }, [text('Start')]),
            button({ ...tm.pauseTrigger, class: 'btn btn-secondary text-xs' }, [text('Pause')]),
            button({ ...tm.resetTrigger, class: 'btn btn-secondary text-xs' }, [text('Reset')]),
          ]),
        ]),
        card('Angle Slider', [
          div(
            {
              ...ag.root,
              class:
                'flex items-center gap-4 rounded focus:outline focus:outline-2 focus:outline-blue-300',
            },
            [
            div(
              {
                ...ag.control,
                class:
                  'relative h-20 w-20 rounded-full border-2 border-slate-300 flex items-center justify-center cursor-pointer touch-none',
                onPointerDown: onControlDown,
              },
              [
                div(
                  {
                    ...ag.thumb,
                    class: 'absolute h-3 w-3 bg-blue-600 rounded-full',
                    // Absolute center + radial offset via translate. 32px
                    // radius on a 76px inner circle keeps the thumb on the
                    // rim. CSS `left:50%;top:50%` centers the thumb's own
                    // origin, then translate offsets the corner back by
                    // half + adds the radial vector.
                    style: (s: State) => {
                      const { x, y } = angleSlider.pointFromAngle(s.angle.value)
                      const r = 32
                      return (
                        `left:50%;top:50%;` +
                        `transform:translate(calc(-50% + ${(x * r).toFixed(2)}px),calc(-50% + ${(y * r).toFixed(2)}px));`
                      )
                    },
                  },
                  [],
                ),
                div(
                  { ...ag.valueText, class: 'text-xs font-mono text-slate-600' },
                  [text((s: State) => `${Math.round(s.angle.value)}°`)],
                ),
              ],
            ),
            span({ class: 'text-xs text-slate-500' }, [
              text('Focus, then Arrow/PageUp/Down/Home/End'),
            ]),
          ]),
        ]),
        card('Date Input', [
          div({ ...di.root, class: 'flex flex-col gap-2' }, [
            p({ class: 'text-xs text-slate-500' }, [
              text('Masked text input that parses ISO dates and validates against min/max (2026).'),
            ]),
            input({
              ...di.input,
              class: 'w-full px-3 py-2 border rounded font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-200',
              style: (s: State) =>
                s.date.error
                  ? 'border-color:rgb(239 68 68);'
                  : 'border-color:rgb(203 213 225);',
            }),
            div({ class: 'flex items-center justify-between text-xs' }, [
              span({ class: 'text-slate-500' }, [
                text('Parsed: '),
                span({ class: 'font-mono text-slate-700' }, [
                  text((s: State) =>
                    s.date.value ? s.date.value.toDateString() : '(invalid or empty)',
                  ),
                ]),
              ]),
              span(
                { ...di.errorText, class: 'text-red-600 font-medium' },
                [
                  text((s: State) => {
                    const e = s.date.error
                    return e === 'invalid'
                      ? 'Invalid format'
                      : e === 'before-min'
                        ? 'Before 2026-01-01'
                        : e === 'after-max'
                          ? 'After 2026-12-31'
                          : ''
                  }),
                ],
              ),
            ]),
          ]),
        ]),
        card('Marquee', [
          div(
            {
              ...mq.root,
              class: 'overflow-hidden whitespace-nowrap border border-slate-200 rounded p-2',
            },
            [
              div(
                {
                  ...mq.content,
                  class: 'inline-block',
                  style:
                    'animation: marquee-scroll var(--marquee-duration) linear infinite; ' +
                    'animation-direction: var(--marquee-direction); ' +
                    'animation-play-state: var(--marquee-playstate);',
                },
                [
                  text(
                    '• llui • headless components • TEA architecture • compile-time bitmasks • hover to pause ',
                  ),
                ],
              ),
            ],
          ),
        ]),
      ]),
    ]
  },
})
