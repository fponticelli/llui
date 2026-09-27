import { button, div, p } from '@llui/dom'
import type { ChildNode, ElProps, Mountable } from '@llui/dom'
import { classPart, splitArgs } from '../../lib/utils'
import { overlayReducedMotionRecipe } from '../../lib/floating-motion'
import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  LoaderIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from './icons'

/**
 * Toast / Sonner.
 *
 * shadcn's `sonner.tsx` contains NO class recipes — it mounts the `sonner`
 * library's `<Toaster />` and hands it theme variables. There is nothing to port
 * verbatim, so these recipes are built from shadcn's own token vocabulary and
 * shared idioms rather than copied: `bg-popover`, `border`, `shadow-lg`, and
 * the `animate-in`/`animate-out` pair every other overlay in this registry uses.
 *
 * `@llui/components/toast` supplies the queue, timers and the live region.
 * Render `ToastRegion` ONCE near the root — one region for the app, not one per
 * toast, or screen readers announce the container instead of the message.
 *
 * The visual per-type semantics are STATE-DRIVEN off the machine's own
 * `data-type` attribute (a `data-[type=…]:` selector on the root plus a
 * `group-data-[type=…]/toast:` selector on each icon), never a `variant` prop
 * resolved once at call time. `connect()`'s `toast()` builder binds `data-type`
 * REACTIVELY (see `@llui/components/toast`'s #265 fix), so a `toast.promise`
 * -style `update` that patches `type` on an already-mounted toast repaints its
 * color, border style and icon with no JS on this side at all — the DOM
 * attribute changes and the CSS selector re-matches. A `createVariantsPart`
 * (a JS-resolved `variant` prop) would have frozen the class at the call site
 * the same way the old `item.peek()` call site did, which is exactly the
 * contradiction #265 finding #8 closes.
 */
export const ToastRegion = classPart(
  div,
  'pointer-events-none fixed z-50 flex w-[min(20rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] flex-col gap-2 overflow-y-auto overscroll-contain wrap-break-word data-[placement=top]:top-4 data-[placement=top]:left-1/2 data-[placement=top]:-translate-x-1/2 data-[placement=top-start]:top-4 data-[placement=top-start]:start-4 data-[placement=top-end]:top-4 data-[placement=top-end]:end-4 data-[placement=bottom]:bottom-4 data-[placement=bottom]:left-1/2 data-[placement=bottom]:-translate-x-1/2 data-[placement=bottom-start]:bottom-4 data-[placement=bottom-start]:start-4 data-[placement=bottom-end]:end-4 data-[placement=bottom-end]:bottom-4',
)

/**
 * Per-type border color/style, keyed off `data-type` — never a `variant` prop.
 * Each type's forced-colors border-style/width pair is UNIQUE (info: solid/4,
 * success: double/4, warning: dashed/4, error: solid/4 + underline, loading:
 * dotted/4, custom: solid/8) so no two types collapse to the same non-color
 * cue; the icon below is the primary cue and this is defense in depth.
 *
 * The recipe is inlined directly as `classPart`'s own argument (never hoisted
 * to a separate `const` built with string concatenation) because the
 * registry's Tailwind guard reads recipes only from the positions it knows —
 * `cn`/`mergeClass`/`classPart` arguments — and the `group/toast` MARKER this
 * file's icons reference (`group-data-[type=…]/toast:block`) must be visible
 * at one of those positions or the guard reports a dangling reference.
 */
const ToastRoot = classPart(
  div,
  `group/toast pointer-events-auto flex w-full min-w-0 items-start gap-3 wrap-break-word rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText] data-[state=closing]:animate-out data-[state=closing]:fade-out-0 ltr:data-[state=closing]:slide-out-to-right rtl:data-[state=closing]:slide-out-to-left data-[state=open]:animate-in data-[state=open]:fade-in-0 ltr:data-[state=open]:slide-in-from-right rtl:data-[state=open]:slide-in-from-left ${overlayReducedMotionRecipe} data-[type=info]:border-sky-500/50 forced-colors:data-[type=info]:border-s-4 forced-colors:data-[type=info]:border-solid data-[type=success]:border-emerald-500/50 forced-colors:data-[type=success]:border-s-4 forced-colors:data-[type=success]:border-double data-[type=warning]:border-amber-500/50 forced-colors:data-[type=warning]:border-s-4 forced-colors:data-[type=warning]:border-dashed data-[type=error]:border-destructive/50 data-[type=error]:text-destructive forced-colors:data-[type=error]:border-s-4 forced-colors:data-[type=error]:border-solid forced-colors:data-[type=error]:text-[LinkText] forced-colors:data-[type=error]:underline forced-colors:data-[type=error]:decoration-2 data-[type=loading]:cursor-progress data-[type=loading]:text-muted-foreground forced-colors:data-[type=loading]:border-s-4 forced-colors:data-[type=loading]:border-dotted data-[type=custom]:border-violet-500/50 forced-colors:data-[type=custom]:border-s-8 forced-colors:data-[type=custom]:border-solid`,
)

/** One icon per `ToastType`, always mounted, shown only under its own
 * `group-data-[type=…]/toast:` match — a pure-CSS gate on the root's own
 * (reactive) `data-type`, so it tracks an `update` with no JS on this side. */
// `forced-colors:text-[CanvasText]` on every icon (#265 task item 2): unlike
// the root's own text color, an icon's `text-*` utility sets `color`
// DIRECTLY on the `<svg>` and wins over any inherited forced-colors
// override on an ancestor, so each icon needs its own system-color
// override to stay visible under forced-colors rather than painting a
// literal (invisible-on-Canvas) hue. `sky-500`/`amber-500` alone measured
// under AA non-text contrast (>=3:1 against the toast's own surface):
// light mode gave 2.71:1 / 2.13:1 — `sky-600`/`amber-600` (with a lighter
// `dark:` twin so DARK mode, already passing at the -500 shade, does not
// regress) clear the floor in both.
const TOAST_ICON_BASE = 'mt-0.5 hidden size-4 shrink-0 forced-colors:text-[CanvasText]'
function toastIcons(): Mountable[] {
  return [
    InfoIcon({
      class: `${TOAST_ICON_BASE} text-sky-600 dark:text-sky-400 group-data-[type=info]/toast:block`,
    }),
    CircleCheckIcon({
      class: `${TOAST_ICON_BASE} text-emerald-600 dark:text-emerald-400 group-data-[type=success]/toast:block`,
    }),
    TriangleAlertIcon({
      class: `${TOAST_ICON_BASE} text-amber-600 dark:text-amber-400 group-data-[type=warning]/toast:block`,
    }),
    CircleAlertIcon({
      class: `${TOAST_ICON_BASE} text-destructive group-data-[type=error]/toast:block`,
    }),
    LoaderIcon({
      class: `${TOAST_ICON_BASE} animate-spin text-muted-foreground group-data-[type=loading]/toast:block`,
    }),
    SparklesIcon({
      class: `${TOAST_ICON_BASE} text-violet-500 group-data-[type=custom]/toast:block`,
    }),
  ]
}

/**
 * The toast row itself. Spreads `parts.root` (the machine's reactive part bag)
 * straight through — there is no `variant` prop to pass, and passing one back
 * (`{ variant: item.type }`, resolved once from a peeked value) is exactly the
 * bug #265 closes. Prepends the six-icon cluster above the caller's own
 * children so every toast gets its type's glyph regardless of call site.
 */
export function Toast(a0?: ElProps | readonly ChildNode[], a1?: readonly ChildNode[]): Mountable {
  const { props, children } = splitArgs(a0, a1)
  return ToastRoot(props, [...toastIcons(), ...children])
}

export const ToastTitle = classPart(div, 'text-sm leading-none font-medium')
export const ToastDescription = classPart(
  p,
  'min-w-0 text-sm wrap-break-word text-muted-foreground',
)
export const ToastClose = classPart(
  button,
  'ms-auto shrink-0 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden',
)

export { Toast as Sonner, ToastRegion as Toaster }
