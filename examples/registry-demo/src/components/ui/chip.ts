import {
  span,
  text,
  type AttrValue,
  type ChildNode,
  type ElProps,
  type Mountable,
  type Reactive,
} from '@llui/dom'
import { chipHue } from '@llui/components/styles'
import { mergeClass, splitArgs } from '../../lib/utils'

/**
 * A categorical chip whose colour is DERIVED from its value.
 *
 * `Chip({ value: 'lab' })` renders the text and sets `--chip-hue` from
 * `chipHue('lab')`. Nothing maintains a `Record<string, colour>`, a category the
 * server invents tomorrow colours itself, and the mapping is identical across
 * sessions, machines and releases.
 *
 * Geometry is `Badge`'s, so a chip and a badge sit on the same line without
 * arguing. Only the two colour declarations differ.
 *
 * ## The two class recipes
 *
 * `--chip-lightness` / `--chip-chroma` / `--chip-mix` come from `tokens.css` and
 * are fixed for the whole scale; only the HUE varies per chip. That is what lets
 * one contrast sweep cover every category, and it is why the tint is OKLCH and
 * not HSL — HSL's `L` is a channel average, so at a fixed `L` a yellow chip is
 * far lighter than a blue one and 17 of 360 hues fall below AA.
 * `scripts/test/chip-contrast.test.ts` re-derives both expressions from THIS
 * FILE and sweeps them, so editing a number here is measured rather than assumed.
 *
 * Mixing toward `var(--background)` / `var(--foreground)` — rather than shipping
 * a `.dark` override — is the package's derived-token idiom: `--foreground` is
 * near-black in light and near-white in dark, so the same expression darkens or
 * lightens by itself. With `--chip-mix` at 40% the two ends swap exactly, so a
 * chip's light fill is its own dark ink.
 *
 * The declarations must live HERE, in a rule that matches the chip, and not as a
 * `--chip-fill` token: a custom property's `var()` references are substituted at
 * the computed-value time of the element that DECLARES it, so a `--chip-fill` on
 * `:root` would bake in `:root`'s `--chip-hue` and every chip on the page would
 * inherit the same colour.
 *
 * Note what Tailwind emits for a `color-mix()` arbitrary value: the declaration
 * is duplicated, once bare and once inside `@supports (color: color-mix(in lab,
 * red, red))`. The bare fallback is the full-strength tint for BOTH properties,
 * so on an engine without `color-mix()` the ink equals the fill. That engine
 * predates 2023 and cannot render this theme at all — `--accent-strong` and
 * every other derived token are unconditional `color-mix()` — so it is a
 * pre-existing floor, not a new one. It is called out because reading only the
 * first declaration of a Tailwind colour rule is a documented way to draw the
 * opposite conclusion about what a class does.
 */
export interface ChipProps {
  /**
   * The category this chip labels. Drives the hue, and — when no children are
   * given — the chip's own text, so `Chip({ value: kind })` is the whole call.
   */
  value?: Reactive<string>
  /**
   * An explicit hue, for a caller that has already resolved one (a legend that
   * walked `chipHueAt`, say). Wins over `value`. Nothing validates it against
   * `RESERVED_HUE_ARCS`: an explicit hue is the caller saying they mean it.
   */
  hue?: Reactive<number>
}

/**
 * Resolve `--chip-hue`, keeping a Signal reactive rather than stringifying it —
 * a chip inside an `each` row over rows whose kind can change needs the hue to
 * follow, and handing a handle to `String()` yields `"[object Object]"`, the
 * silently stuck attribute `mergeClass` exists to avoid for `class`.
 *
 * Narrowed with `typeof`, not `isSignalHandle`: the latter is declared
 * `v is SignalHandle<unknown>`, so it erases the element type on the true branch
 * and leaves `Reactive<string>` un-narrowed on the false one. `Reactive<T>` is a
 * union with `T`, so `typeof` splits it correctly in both directions.
 */
function hueAttr(
  value: Reactive<string> | undefined,
  hue: Reactive<number> | undefined,
): AttrValue | undefined {
  if (hue !== undefined) return typeof hue === 'number' ? String(hue) : hue.map(String)
  if (value === undefined) return undefined
  return typeof value === 'string' ? String(chipHue(value)) : value.map((v) => String(chipHue(v)))
}

export function Chip(
  a0?: (ElProps & ChipProps) | readonly ChildNode[],
  a1?: readonly ChildNode[],
): Mountable {
  const { props, children } = splitArgs(a0, a1)
  const { value, hue, class: className, ...rest } = props as ElProps & ChipProps
  const resolved = hueAttr(value, hue)
  // A chip with a value and no children labels itself — the same affordance
  // `icons.ts` gives its glyphs, and the reason `Chip({ value: kind })` is a
  // complete call. An explicit child list always wins.
  const content: readonly ChildNode[] =
    children.length > 0 ? children : value === undefined ? [] : [text(value)]
  return span(
    {
      'data-part': 'chip',
      ...(resolved === undefined ? {} : { 'style.--chip-hue': resolved }),
      ...rest,
      class: mergeClass(
        'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] bg-[color-mix(in_oklab,oklch(var(--chip-lightness)_var(--chip-chroma)_var(--chip-hue))_var(--chip-mix),var(--background))] text-[color-mix(in_oklab,oklch(var(--chip-lightness)_var(--chip-chroma)_var(--chip-hue))_var(--chip-mix),var(--foreground))] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg]:size-3',
        className,
      ),
    },
    content,
  )
}
