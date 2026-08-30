import { div, each, span, tbody, text, thead } from '@llui/dom'
import type { Mountable, Send, Signal } from '@llui/dom'
import * as carouselC from '@llui/components/carousel'
import * as datePickerC from '@llui/components/date-picker'
import * as popoverC from '@llui/components/popover'
import * as toastC from '@llui/components/toast'
import {
  Carousel,
  CarouselContent,
  CarouselIndicator,
  CarouselIndicatorGroup,
  CarouselNext,
  CarouselPrevious,
  CarouselSlide,
  CarouselViewport,
} from '../components/ui/carousel'
import {
  Calendar,
  CalendarCaption,
  CalendarCaptionLabel,
  CalendarDay,
  CalendarDayButton,
  CalendarGrid,
  CalendarMonth,
  CalendarMonths,
  CalendarNav,
  CalendarNext,
  CalendarPrevious,
  CalendarRow,
  CalendarWeekday,
  CalendarWeekdays,
} from '../components/ui/calendar'
import {
  DatePickerCalendar,
  DatePickerCaption,
  DatePickerCaptionLabel,
  DatePickerContent,
  DatePickerDay,
  DatePickerDayButton,
  DatePickerGrid,
  DatePickerMonth,
  DatePickerMonths,
  DatePickerNav,
  DatePickerNext,
  DatePickerPrevious,
  DatePickerRow,
  DatePickerTrigger,
  DatePickerWeekday,
  DatePickerWeekdays,
} from '../components/ui/date-picker'
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastRegion,
  ToastTitle,
} from '../components/ui/sonner'
import { Button } from '../components/ui/button'
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from '../components/ui/icons'
import { section, row } from './shared'

const SLIDES = ['Slide one', 'Slide two', 'Slide three']

export interface State {
  carousel: carouselC.CarouselState
  calendar: datePickerC.DatePickerState
  toaster: toastC.ToasterState
  pickerOpen: popoverC.PopoverState
  picker: datePickerC.DatePickerState
  /** Monotonic id source. `Date.now()` would make State non-reproducible
   * between a record and a replay, which the harness relies on. */
  nextToast: number
}

export type Msg =
  | { type: 'carousel'; msg: carouselC.CarouselMsg }
  | { type: 'calendar'; msg: datePickerC.DatePickerMsg }
  | { type: 'toaster'; msg: toastC.ToasterMsg }
  | { type: 'pickerOpen'; msg: popoverC.PopoverMsg }
  | { type: 'picker'; msg: datePickerC.DatePickerMsg }
  | { type: 'pushToast'; variant: 'default' | 'destructive' }

export const init = (): [State, never[]] => [
  {
    // Autoplay off: the demo page is long, and a slide that moves on its own
    // while the reader is elsewhere is noise. Every other affordance is live.
    carousel: carouselC.init({ count: SLIDES.length, loop: true }),
    calendar: datePickerC.init({ mode: 'range' }),
    toaster: toastC.init({ max: 3 }),
    pickerOpen: popoverC.init(),
    picker: datePickerC.init({ mode: 'single' }),
    nextToast: 1,
  },
  [],
]

export function update(state: State, msg: Msg): [State, never[]] {
  switch (msg.type) {
    case 'carousel':
      return [{ ...state, carousel: carouselC.update(state.carousel, msg.msg)[0] }, []]
    case 'calendar':
      return [{ ...state, calendar: datePickerC.update(state.calendar, msg.msg)[0] }, []]
    case 'toaster':
      return [{ ...state, toaster: toastC.update(state.toaster, msg.msg)[0] }, []]
    case 'pickerOpen':
      return [{ ...state, pickerOpen: popoverC.update(state.pickerOpen, msg.msg)[0] }, []]
    case 'picker': {
      const picker = datePickerC.update(state.picker, msg.msg)[0]
      // Picking a day closes the popover — the two machines are independent, so
      // that coupling is the CONSUMER's and belongs here in the reducer rather
      // than in either component.
      const closed =
        msg.msg.type === 'selectFocused' || msg.msg.type === 'setValue'
          ? popoverC.update(state.pickerOpen, { type: 'close' })[0]
          : state.pickerOpen
      return [{ ...state, picker, pickerOpen: closed }, []]
    }
    case 'pushToast': {
      const id = `t${state.nextToast}`
      const [toaster] = toastC.update(state.toaster, {
        type: 'create',
        toast: {
          id,
          type: msg.variant === 'destructive' ? 'error' : 'info',
          title: msg.variant === 'destructive' ? 'Deploy failed' : 'Changes saved',
          description:
            msg.variant === 'destructive'
              ? 'The build exited with status 1.'
              : 'Your workspace is up to date.',
          // Sticky. The countdown advances on `tick`, which needs a timer this
          // section has no effect channel for — a duration nothing ticks would
          // simply never fire, so the honest shape is an explicit dismiss.
          duration: null,
          dismissable: true,
        },
      })
      return [{ ...state, toaster, nextToast: state.nextToast + 1 }, []]
    }
  }
}

export function view(state: Signal<State>, send: Send<Msg>): readonly Mountable[] {
  const carSend = (m: carouselC.CarouselMsg): void => send({ type: 'carousel', msg: m })
  const calSend = (m: datePickerC.DatePickerMsg): void => send({ type: 'calendar', msg: m })
  const toastSend = (m: toastC.ToasterMsg): void => send({ type: 'toaster', msg: m })

  const car = carouselC.connect(state.at('carousel'), carSend, { id: 'demo-carousel' })
  const pickSend = (m: popoverC.PopoverMsg): void => send({ type: 'pickerOpen', msg: m })
  const pickOpen = popoverC.connect(state.at('pickerOpen'), pickSend, { id: 'demo-date-picker' })
  const pick = datePickerC.connect(state.at('picker'), (m) => send({ type: 'picker', msg: m }), {
    mode: 'single',
  })
  const pickWeeks = state.at('picker').map((s) => datePickerC.weekRows(datePickerC.monthGrid(s)))
  const pickWeekdays = state.at('picker').map((s) => datePickerC.weekdayLabels(s.weekStartsOn))
  const cal = datePickerC.connect(state.at('calendar'), calSend, { mode: 'range' })
  const toaster = toastC.connect(state.at('toaster'), toastSend, {})

  // `monthGrid`/`weekRows` are pure functions of state, so the grid is a derived
  // signal rather than a peeked snapshot — a month change re-renders it.
  const weeks = state.at('calendar').map((s) => datePickerC.weekRows(datePickerC.monthGrid(s)))
  const weekdays = state.at('calendar').map((s) => datePickerC.weekdayLabels(s.weekStartsOn))

  return [
    section(
      'Carousel',
      "shadcn wraps Embla and ships no dots; `@llui/components/carousel` owns the index, so the indicators are LLui's. Arrows, dots, drag and the APG tablist keyboard model all drive one `current`.",
      [
        div({ class: 'px-12' }, [
          Carousel({ ...car.root }, [
            CarouselViewport({ ...car.viewport }, [
              CarouselContent(
                SLIDES.map((label, i) =>
                  CarouselSlide({ ...car.slide(i).slide }, [
                    div(
                      {
                        class:
                          'grid aspect-[3/1] place-items-center rounded-md border bg-muted/40 text-sm',
                      },
                      [text(label)],
                    ),
                  ]),
                ),
              ),
            ]),
            CarouselPrevious({ ...car.prevTrigger }, [ChevronLeftIcon({ class: 'size-4' })]),
            CarouselNext({ ...car.nextTrigger }, [ChevronRightIcon({ class: 'size-4' })]),
            CarouselIndicatorGroup({ ...car.indicatorGroup }, [
              ...SLIDES.map((_, i) => CarouselIndicator({ ...car.slide(i).indicator })),
            ]),
          ]),
        ]),
      ],
    ),

    section(
      'Calendar',
      'Range mode. Every day state is a `data-*` flag on the CELL — the day button has no part bag of its own, so its selection fill and focus ring are driven through `group-data-…/day`.',
      [
        Calendar({ ...cal.root }, [
          CalendarMonths([
            CalendarMonth([
              CalendarNav([
                CalendarPrevious({ ...cal.prevMonthTrigger }, [
                  ChevronLeftIcon({ class: 'size-4' }),
                ]),
                CalendarNext({ ...cal.nextMonthTrigger }, [ChevronRightIcon({ class: 'size-4' })]),
              ]),
              CalendarCaption([CalendarCaptionLabel([text(cal.grid()['aria-label'])])]),
              CalendarGrid({ ...cal.grid(), class: 'w-full' }, [
                thead([
                  CalendarWeekdays([
                    each(weekdays, {
                      key: (d: string) => d,
                      render: (d: Signal<string>) => [CalendarWeekday([text(d)])],
                    }),
                  ]),
                ]),
                tbody([
                  each(weeks, {
                    key: (w: datePickerC.DayCell[]) => w[0]?.iso ?? '',
                    render: (w: Signal<datePickerC.DayCell[]>) => {
                      // Snapshotted in a BLOCK body, which is the shape the
                      // `peek-in-slot` compiler rule asks for. Safe here because
                      // a row's key is its first ISO date, so a month change
                      // rebuilds the row — and every per-day flag inside the
                      // cell bag is a Signal, so selection, focus and range
                      // preview stay live without any rebuild at all.
                      const cells = w.peek()
                      return [
                        CalendarRow({ ...cal.row }, [
                          ...cells.map((c) =>
                            CalendarDay({ ...cal.dayCell(c).cell }, [
                              CalendarDayButton({ type: 'button' }, [text(String(c.day))]),
                            ]),
                          ),
                        ]),
                      ]
                    },
                  }),
                ]),
              ]),
            ]),
          ]),
        ]),
      ],
    ),

    section(
      'Date Picker',
      "shadcn ships no `date-picker.tsx` — its docs compose Button + Popover + Calendar, so the registry item carries only what that composition adds: the trigger recipe and the content's `w-auto p-0`.",
      [
        DatePickerTrigger(
          {
            ...pickOpen.trigger,
            // Upstream's own spelling for "nothing chosen yet". The machine has
            // no trigger part — the trigger belongs to whatever surface hosts
            // the calendar — so this is the consumer's to set.
            'data-empty': state.at('picker').map((s) => (s.value === null ? 'true' : undefined)),
          },
          [text(state.at('picker').map((s) => s.value ?? 'Pick a date'))],
        ),
      ],
    ),
    popoverC.overlay({
      state: state.at('pickerOpen'),
      send: pickSend,
      parts: pickOpen,
      positionerClass: 'z-popover',
      content: () => [
        DatePickerContent({ ...pickOpen.content }, [
          DatePickerCalendar({ ...pick.root }, [
            DatePickerMonths([
              DatePickerMonth([
                DatePickerNav([
                  DatePickerPrevious({ ...pick.prevMonthTrigger }, [
                    ChevronLeftIcon({ class: 'size-4' }),
                  ]),
                  DatePickerNext({ ...pick.nextMonthTrigger }, [
                    ChevronRightIcon({ class: 'size-4' }),
                  ]),
                ]),
                DatePickerCaption([DatePickerCaptionLabel([text(pick.grid()['aria-label'])])]),
                DatePickerGrid({ ...pick.grid(), class: 'w-full' }, [
                  thead([
                    DatePickerWeekdays([
                      each(pickWeekdays, {
                        key: (d: string) => d,
                        render: (d: Signal<string>) => [DatePickerWeekday([text(d)])],
                      }),
                    ]),
                  ]),
                  tbody([
                    each(pickWeeks, {
                      key: (w: datePickerC.DayCell[]) => w[0]?.iso ?? '',
                      render: (w: Signal<datePickerC.DayCell[]>) => {
                        const cells = w.peek()
                        return [
                          DatePickerRow({ ...pick.row }, [
                            ...cells.map((c) =>
                              DatePickerDay({ ...pick.dayCell(c).cell }, [
                                DatePickerDayButton({ type: 'button' }, [text(String(c.day))]),
                              ]),
                            ),
                          ]),
                        ]
                      },
                    }),
                  ]),
                ]),
              ]),
            ]),
          ]),
        ]),
      ],
    }),

    section(
      'Toast (Sonner)',
      "shadcn's `sonner.tsx` has no recipes of its own — it hands the sonner library theme variables. `@llui/components/toast` owns the queue, the cap and the live region, so these recipes are built from shadcn's token vocabulary.",
      [
        row('Push', [
          Button(
            { variant: 'outline', onClick: () => send({ type: 'pushToast', variant: 'default' }) },
            [text('Show toast')],
          ),
          Button(
            {
              variant: 'destructive',
              onClick: () => send({ type: 'pushToast', variant: 'destructive' }),
            },
            [text('Show error')],
          ),
          span({ class: 'text-xs text-muted-foreground' }, [text('Capped at 3.')]),
        ]),
      ],
    ),
    // ONE region for the page, placed as a sibling of the section so it is
    // fixed-positioned against the viewport rather than trapped in a card.
    ToastRegion({ ...toaster.region }, [
      each(state.at('toaster').at('toasts'), {
        key: (t: toastC.Toast) => t.id,
        render: (t: Signal<toastC.Toast>) => {
          const parts = toaster.toast(t)
          const item = t.peek()
          return [
            Toast({ ...parts.root, variant: item.type === 'error' ? 'destructive' : 'default' }, [
              div({ class: 'flex flex-col gap-1' }, [
                ToastTitle({ ...parts.title }, [text(item.title ?? '')]),
                ToastDescription({ ...parts.description }, [text(item.description ?? '')]),
              ]),
              ToastClose({ ...parts.closeTrigger }, [XIcon({ class: 'size-4' })]),
            ]),
          ]
        },
      }),
    ]),
  ]
}
