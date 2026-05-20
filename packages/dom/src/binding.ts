import type { Lifetime, Binding, BindingKind } from './types.js'
import { addBinding } from './lifetime.js'
import { getRenderContext, peekRenderContext } from './render-context.js'
import { FULL_MASK } from './update-loop.js'
import { registerBinding, prefixIdsFromMask } from './binding-registry.js'

export interface CreateBindingOpts {
  mask: number
  /**
   * High-word bits 31..61. Optional; defaults to 0. Compiler-emitted
   * only when the accessor reads a prefix past bit 30.
   */
  maskHi?: number
  accessor: (state: never) => unknown
  kind: BindingKind
  node: Node
  key?: string
  perItem: boolean
}

let flatBindings: Binding[] | null = null

export function getFlatBindings(): Binding[] | null {
  return flatBindings
}

export function setFlatBindings(arr: Binding[] | null): void {
  flatBindings = arr
}

export function createBinding(scope: Lifetime, opts: CreateBindingOpts): Binding {
  const binding: Binding = {
    mask: opts.mask,
    maskHi: opts.maskHi ?? 0,
    accessor: opts.accessor as (state: unknown) => unknown,
    lastValue: undefined,
    kind: opts.kind,
    node: opts.node,
    key: opts.key,
    ownerLifetime: scope,
    perItem: opts.perItem,
    dead: false,
  }

  addBinding(scope, binding)
  if (flatBindings) flatBindings.push(binding)

  // Option B Phase 2: when the active instance is in registry mode,
  // mirror the registration into the per-prefix subscriber map and
  // stamp the scope so `disposeLifetime` knows to unregister. Peek
  // (rather than `getRenderContext`) so test fixtures that build
  // bindings outside any view callback still work — they simply skip
  // the registry path.
  const ctx = peekRenderContext()
  const reg = ctx?.instance?.bindingsByPrefix
  if (reg) {
    registerBinding(reg, binding, prefixIdsFromMask(binding.mask, binding.maskHi))
    scope.bindingsRegistry = reg
  }

  return binding
}

/**
 * Bind a value of uncertain runtime type. Compiler-emitted call site
 * when an element-helper prop value is an unresolvable identifier
 * (function parameter, opaque import) — the compiler can't tell at
 * build time whether the value will be a reactive accessor or a
 * plain primitive, so it defers the dispatch here.
 *
 * If `value` is a function, register as a reactive binding with
 * FULL_MASK gating (the compiler couldn't analyze accessor deps).
 * Otherwise apply it directly as a one-shot prop/attr/class/style set.
 *
 * v0.4 size-cut: this exists to keep `createElement` (the heavyweight
 * runtime fallback in `elements.ts`) from being pulled in by uncertain
 * prop sites. ~1.8 kB minified saved per affected app.
 *
 * Compiler-emit target only — user code should not call this directly.
 * (The runtime is re-exported through index.ts. We deliberately don't
 * mark this as private/internal in the JSDoc because the corresponding
 * stripping setting in tsconfig.build.json would then produce a
 * dangling re-export pointing at a missing member.)
 */
export function __bindUncertain(
  el: Node,
  kind: BindingKind,
  key: string | undefined,
  value: unknown,
): void {
  if (typeof value === 'function') {
    const ctx = getRenderContext()
    const fn = value as (s: never) => unknown
    const perItem = fn.length === 0
    const binding = createBinding(ctx.rootLifetime, {
      mask: FULL_MASK,
      accessor: fn,
      kind,
      node: el,
      key,
      perItem,
    })
    const initial = perItem ? (fn as unknown as () => unknown)() : fn(ctx.state as never)
    binding.lastValue = initial
    applyBinding({ kind, node: el, key }, initial)
  } else {
    applyBinding({ kind, node: el, key }, value)
  }
}

export function applyBinding(
  target: { kind: BindingKind; node: Node; key?: string },
  value: unknown,
): void {
  // Defensive guard: if a reactive accessor leaks through as a raw
  // function value, emitting its `.toString()` into the DOM (e.g. as
  // an attribute) would be a silent correctness bug that only surfaces
  // on server-rendered pages. Throw loudly so the callsite is obvious.
  // Event handlers (onXxx → 'prop' kind) are NOT handled here; events
  // are registered via addEventListener in the element helpers, not
  // via applyBinding.
  if (typeof value === 'function') {
    throw new TypeError(
      `[LLui] applyBinding(${target.kind}${target.key ? `, '${target.key}'` : ''}) received ` +
        `a function as its value. This means an accessor wasn't invoked before ` +
        `reaching the binding layer — usually a bug in a compiled binding tuple or ` +
        `in a helper that forwards props without calling them. The arrow's source ` +
        `would have been serialized into the DOM otherwise. Offender: ${value.toString().slice(0, 120)}`,
    )
  }

  switch (target.kind) {
    case 'effect':
      // Side-effect-only binding — the accessor already ran for its
      // side effects in Phase 2. We keep `applyBinding` callable for
      // type-uniform call sites, but there is no DOM write to perform.
      break

    case 'text':
      target.node.nodeValue = String(value)
      break

    case 'prop': {
      const el = target.node as HTMLElement
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(el as any)[target.key!] = value
      break
    }

    case 'attr':
      if (value == null) {
        ;(target.node as Element).removeAttribute(target.key!)
      } else if (value === false) {
        // ARIA attributes need explicit "false"; others are removed
        if (target.key!.startsWith('aria-')) {
          ;(target.node as Element).setAttribute(target.key!, 'false')
        } else {
          ;(target.node as Element).removeAttribute(target.key!)
        }
      } else {
        ;(target.node as Element).setAttribute(target.key!, String(value))
      }
      break

    case 'class':
      ;(target.node as Element).setAttribute('class', value as string)
      break

    case 'style':
      if (value == null) {
        ;(target.node as HTMLElement).style.removeProperty(target.key!)
      } else {
        ;(target.node as HTMLElement).style.setProperty(target.key!, value as string)
      }
      break
  }
}
