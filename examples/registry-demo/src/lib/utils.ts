import {
  isSignalHandle,
  type AttrValue,
  type ChildNode,
  type ElProps,
  type Mountable,
} from '@llui/dom'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge class strings, letting later Tailwind utilities win over earlier ones.
 *
 * This is NOT `cx` from `@llui/components/styles`. `cx` concatenates and filters
 * falsy values, so a caller override (`class: 'p-2'`) loses to a recipe's `p-4`
 * by source order — the caller's intent is silently dropped. `cn` resolves the
 * conflict, which is what makes `class` a real override slot on every component
 * in this directory.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Merge a component's recipe with the caller's `class` prop, preserving
 * reactivity when the caller passed a Signal.
 *
 * Every component here routes its `class` through this ONE function, and the
 * signal branch is why. `class` is typed `AttrValue = Reactive<string | …>`, so
 * a caller may legitimately pass `state.at('open').map(…)`. Handing that handle
 * to `cn()` stringifies it to `"[object Object]"` — a silently stuck attribute,
 * the exact failure `@llui/dom`'s `applyProp` exists to prevent for raw props.
 * Mapping instead keeps one reactive binding whose body sees plain values.
 *
 * Note the LLui-specific consequence for callers: the compiler rejects operators
 * applied to a Signal (`operator-on-signal`), so a state-driven class is written
 * INSIDE a `.map` body, never around one:
 *
 *   // wrong — `&&` applied to a Signal
 *   class: cn('base', state.at('open') && 'is-open')
 *   // right — one binding, plain values inside
 *   class: state.at('open').map((open) => cn('base', open && 'is-open'))
 *
 * Most state-driven styling should not need either form: every `@llui/components`
 * part already emits `data-state` / `data-disabled` / `data-orientation`, so
 * `data-[state=open]:…` in the recipe is the idiomatic answer.
 *
 * `override` is `unknown`, not `AttrValue`, because it is destructured out of an
 * `ElProps` bag whose index signature admits event handlers as well as attribute
 * values — a caller CAN hand this a function, and a narrower parameter type would
 * only push the cast to every one of the sixteen call sites. Both branches below
 * narrow before use, so a non-string, non-signal value contributes nothing.
 */
export function mergeClass(recipe: string, override: unknown): AttrValue {
  if (isSignalHandle(override)) {
    return override.map((value) => cn(recipe, toClass(value)))
  }
  return cn(recipe, toClass(override))
}

function toClass(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * The call shape every component in this directory accepts, matching `@llui/dom`'s
 * own `ElementHelper`: `Card(children)`, `Card(props, children)`, `Card(props)`,
 * or `Card()`. A leading array is children.
 *
 * The children-only form is not sugar. LLui's compiler makes `div({}, …)` a BUILD
 * ERROR (`empty-props`) — a throwaway object on the element mount path, the hot
 * path for list rendering — so a registry whose only call form required `{}` would
 * push every consumer into writing the shape the framework bans two lines away.
 */
export interface PartHelper {
  (children: readonly ChildNode[]): Mountable
  (props?: ElProps, children?: readonly ChildNode[]): Mountable
}

/** Normalise the two call forms. Exported because the components that are not
 * plain `classPart`s (Button, Separator, the overlay parts) need it too. */
export function splitArgs(
  a0?: ElProps | readonly ChildNode[],
  a1?: readonly ChildNode[],
): { props: ElProps; children: readonly ChildNode[] } {
  const leadingChildren = Array.isArray(a0)
  return {
    props: (leadingChildren ? undefined : (a0 as ElProps | undefined)) ?? {},
    children: (leadingChildren ? (a0 as readonly ChildNode[]) : a1) ?? [],
  }
}

/**
 * Build a fixed-recipe element helper: a tag, a class recipe, and a caller bag
 * whose `class` overrides.
 *
 * Most parts in this directory are exactly that and nothing more, so they are
 * generated from ONE seam rather than restated per part. The deduplication is
 * the smaller half of the reason. The larger half is that the repo's Tailwind
 * check reads class recipes out of the AST at the positions it knows about, and
 * a per-file copy of this factory is a position it does NOT know about — three
 * components' recipes were invisible to it until they came through here. A
 * recipe the checker cannot see is a recipe that can quietly stop producing CSS,
 * which is the whole defect this registry exists to have fixed.
 */
export function classPart(
  tag: (props?: ElProps, children?: readonly ChildNode[]) => Mountable,
  recipe: string,
): PartHelper {
  return ((a0?: ElProps | readonly ChildNode[], a1?: readonly ChildNode[]): Mountable => {
    const { props, children } = splitArgs(a0, a1)
    const { class: className, ...rest } = props
    return tag({ ...rest, class: mergeClass(recipe, className) }, children)
  }) as PartHelper
}

export type { ClassValue }
