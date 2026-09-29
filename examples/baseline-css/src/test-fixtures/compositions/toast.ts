// TEST-ONLY composition (registry/test/toast-live-demos.browser.test.ts). A
// consumer-authored Toast on the Baseline path — `theme.css` alone, no
// Tailwind, no registry skin — driven the way an application drives it:
//
//  - the CONSUMER ticks the countdown (the machine owns no interval by design),
//  - a placement control and a direction toggle reach all six placements and
//    their LTR/RTL logical mirroring,
//  - one trigger per `ToastType`, and an async trigger that creates a
//    `loading` toast and PATCHES the same mounted row to `success`.
//
// The Component Gallery's toast cases are static states; this is the live
// lifecycle (create -> tick -> closing -> animationend -> removal, pause on
// hover and focus) that only a real driver exercises. It replaces the toast
// section of the retired `examples/components-demo`.
import { button, component, div, each, onMount, option, select, span, text } from '@llui/dom'
import type { Mountable, Renderable, Send, Signal } from '@llui/dom'
import { toast, nextToastId } from '@llui/components/toast'
import type { ToastPlacement, ToastType } from '@llui/components/toast'

// A non-colour cue per `ToastType`; `menus-overlays.css` shows only the one
// matching the row's live `data-type`.
const TOAST_TYPE_GLYPHS: Record<ToastType, string> = {
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
  error: '✕',
  loading: '⟳',
  custom: '✦',
}

const TRIGGERS: { type: ToastType; label: string; title: string; description: string }[] = [
  {
    type: 'info',
    label: 'Info',
    title: 'For your information',
    description: 'This is an informational message.',
  },
  {
    type: 'success',
    label: 'Success',
    title: 'Saved!',
    description: 'Your changes have been saved.',
  },
  {
    type: 'warning',
    label: 'Warning',
    title: 'Quota nearly full',
    description: 'Storage is above 90%.',
  },
  {
    type: 'error',
    label: 'Error',
    title: 'Something went wrong',
    description: 'Please try again later.',
  },
  {
    type: 'custom',
    label: 'Custom',
    title: 'Review requested',
    description: 'A teammate requested your review.',
  },
  {
    type: 'loading',
    label: 'Loading',
    title: 'Working on it',
    description: 'This may take a moment.',
  },
]

const PLACEMENTS: { value: ToastPlacement; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'top-start', label: 'Top start' },
  { value: 'top-end', label: 'Top end' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'bottom-start', label: 'Bottom start' },
  { value: 'bottom-end', label: 'Bottom end' },
]

export interface State {
  toast: ReturnType<typeof toast.init>
}

export type Msg =
  | { type: 'toast'; msg: Parameters<typeof toast.update>[1] }
  | { type: 'emit'; kind: ToastType; title: string; description: string }

export const init = (): [State, never[]] => [
  // `animated: true` makes the exit lifecycle real (closing -> animationend
  // -> removal) rather than a synchronous removal.
  { toast: toast.init({ placement: 'bottom-end', animated: true }) },
  [],
]

export function update(state: State, msg: Msg): [State, never[]] {
  if (msg.type === 'toast') return [{ toast: toast.update(state.toast, msg.msg)[0] }, []]
  const [next] = toast.update(state.toast, {
    type: 'create',
    toast: {
      id: nextToastId(),
      type: msg.kind,
      title: msg.title,
      description: msg.description,
      // `loading` is in-progress work: it stays until something resolves it.
      duration: msg.kind === 'loading' ? null : 3000,
      dismissable: true,
    },
  })
  return [{ toast: next }, []]
}

export function view(state: Signal<State>, send: Send<Msg>): Renderable {
  const toastParts = toast.connect(state.at('toast'), (m) => send({ type: 'toast', msg: m }))

  // The consumer's countdown driver: every counting-down toast is ticked with
  // the real elapsed time, so the reducer's own `remainingMs <= 0` branch
  // drives the close.
  const tickDriver = onMount(() => {
    let last = Date.now()
    const id = setInterval(() => {
      const now = Date.now()
      const elapsedMs = now - last
      last = now
      for (const t of state.peek().toast.toasts) {
        if (t.duration !== null) send({ type: 'toast', msg: { type: 'tick', id: t.id, elapsedMs } })
      }
    }, 250)
    return () => clearInterval(id)
  })

  // Every glyph is always mounted and shown only under its own `data-type`,
  // so an `update` patching a mounted row's type swaps it with no rebuild.
  const typeIcons = (): Mountable[] =>
    Object.entries(TOAST_TYPE_GLYPHS).map(([type, glyph]) =>
      span(
        {
          'data-scope': 'toast',
          'data-part': 'type-icon',
          'data-icon': type,
          'aria-hidden': 'true',
        },
        [text(glyph)],
      ),
    )

  // Create a `loading` toast, then PATCH that same mounted row to `success`:
  // the update contract (reactive data-type/role/aria-live/text), live.
  const runAsync = (): void => {
    const id = nextToastId()
    send({
      type: 'toast',
      msg: {
        type: 'create',
        toast: {
          id,
          type: 'loading',
          title: 'Deploying',
          description: 'Uploading the release bundle…',
          duration: null,
          dismissable: true,
        },
      },
    })
    setTimeout(() => {
      send({
        type: 'toast',
        msg: {
          type: 'update',
          id,
          patch: {
            type: 'success',
            title: 'Deploy complete',
            description: 'The release is live.',
            duration: 3000,
          },
        },
      })
    }, 1200)
  }

  return [
    tickDriver,
    div([
      span({ id: 'toast-placement-label' }, [text('Placement')]),
      select(
        {
          id: 'toast-placement-select',
          'aria-labelledby': 'toast-placement-label',
          value: state.at('toast.placement'),
          onChange: (e: Event) => {
            const placement = (e.target as HTMLSelectElement).value as ToastPlacement
            send({ type: 'toast', msg: { type: 'setPlacement', placement } })
          },
        },
        PLACEMENTS.map((p) => option({ value: p.value }, [text(p.label)])),
      ),
      button(
        {
          id: 'toast-direction-toggle',
          class: 'btn btn-secondary btn-sm',
          type: 'button',
          onClick: () => {
            const root = document.documentElement
            root.dir = root.dir === 'rtl' ? 'ltr' : 'rtl'
          },
        },
        [text('Toggle direction (LTR/RTL)')],
      ),
    ]),
    div([
      ...TRIGGERS.map((t) =>
        button(
          {
            id: `toast-trigger-${t.type}`,
            class: 'btn btn-secondary btn-sm',
            onClick: () =>
              send({ type: 'emit', kind: t.type, title: t.title, description: t.description }),
          },
          [text(t.label)],
        ),
      ),
      button({ id: 'toast-trigger-async', class: 'btn btn-secondary btn-sm', onClick: runAsync }, [
        text('Async (loading → success)'),
      ]),
    ]),
    // Per-row parts come from the machine's own `toast(item)` builder, so the
    // role/aria-live/data-type, the close trigger and the pause-on-hover/focus
    // wiring are the real contract.
    div({ ...toastParts.region }, [
      each(state.at('toast.toasts'), {
        key: (t) => t.id,
        render: (item) => {
          const parts = toastParts.toast(item)
          return [
            div({ ...parts.root }, [
              ...typeIcons(),
              div([
                div({ ...parts.title }, [text(item.map((t) => t.title ?? ''))]),
                div({ ...parts.description }, [text(item.map((t) => t.description ?? ''))]),
              ]),
              button({ ...parts.closeTrigger }, [text('×')]),
            ]),
          ]
        },
      }),
    ]),
  ]
}

export const ToastComposition = component<State, Msg, never>({
  name: 'BaselineToastComposition',
  init,
  update,
  view: ({ state, send }) => view(state, send),
})
