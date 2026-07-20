// `nodeWidget` — the decoration-widget seam.
//
// WHAT IT IS
// ----------
// The ProseMirror `Decoration.widget` analogue for Lexical: computed, overlay
// DOM attached to a node's rendered element that is NEVER part of the document.
// It is not serialized, not in the undo stack, not in the clipboard, and no
// EditorState node exists for it. The motivating consumer renders evaluated
// formula results next to their source while the `.md` on disk stores only the
// source.
//
// `DecoratorNode` is deliberately NOT the tool here: a decorator is a real node
// in the EditorState, so it round-trips into the document.
//
// WHY THIS MODULE EXISTS (the "one auditable place" rule)
// ------------------------------------------------------
// Lexical has no `DecorationSet`. The capability is assembled from FOUR
// `@experimental` (and, for the render config, `@internal`) primitives:
//
//   • `EditorDOMRenderConfig.$decorateDOM`  — synchronous "the DOM for this node
//     was just (re)built" callback, the attach point.
//   • `EditorDOMRenderConfig.$getDOMSlot`   — per-node slot override, used to
//     declare the widget as a managed-range BOUNDARY.
//   • `DOMSlot.withBefore()/.withAfter()`   — how that boundary is expressed.
//   • `setDOMUnmanaged()`                   — stops Lexical's mutation observer
//     evicting the widget as foreign DOM.
//
// `@internal` is a stronger warning than `@experimental`: the shape may change
// with no deprecation cycle. Confining every one of those imports to THIS FILE
// means a breaking Lexical upgrade is one module to repair rather than N
// consumers. `grep -rn "setDOMUnmanaged\|EditorDOMRenderConfig" packages/`
// should return exactly this file.
//
// VERIFIED AGAINST lexical 0.48.0. Every citation below was read in
// `node_modules/.../lexical/src` at that version, and `test/nodewidget.test.ts`
// pins each mechanism with an explicit assertion so an upgrade that moves one
// fails loudly HERE rather than silently dropping widgets in an app.
//
// THE THREE CLOBBERING PATHS AND THEIR FIXES
// ------------------------------------------
//  1. `$reconcileChildren`'s N→0 fast path does `dom.textContent = ''` and does
//     NOT consult `isDOMUnmanaged` (LexicalReconciler.ts:1617-1650). Its guard
//     requires `slot.after == null && slot.before == null`, so DECLARING the
//     widget as a slot boundary via `$getDOMSlot` disables the fast path and
//     routes through the keyed slow path, which removes only child DOM. This is
//     why the seam owns `$getDOMSlot` and not merely `$decorateDOM`.
//  2. `ElementDOMSlot.resolveChildIndex` maps a DOM offset onto a lexical child
//     index by counting RAW `childNodes` (LexicalDOMSlot.ts:383-406), so an
//     INTERLEAVED unmanaged sibling would skew caret placement on click.
//     {@link WidgetPlacement} is a two-value `'head' | 'tail'` enum precisely so
//     that an interleaved widget is UNREPRESENTABLE — the enum is the invariant,
//     not a simplification. A tail widget sits past every managed child (the
//     counting loop never reaches it); a head widget is covered by
//     `getFirstChildOffset()`, which already skips the `slot.after` region.
//  3. `$updateDOM` returning true REPLACES the element (LexicalReconciler.ts:
//     1733-1751) — e.g. a TextNode's `SPAN` becoming `STRONG` on bold. This
//     evicts the widget and `setDOMUnmanaged` does not help (it only guards
//     foreign children of a SURVIVING element). It is repaired for free by the
//     reconciler's own control flow: the replacement is built by `$createNode`,
//     which itself calls `$decorateDOM` at LexicalReconciler.ts:818 — so the
//     widget is re-attached SYNCHRONOUSLY in the same commit, before the browser
//     can paint the widget-less state. A `registerMutationListener`-based seam
//     would only notice a macrotask later. This is the single strongest reason
//     the seam is built on the render config.
//
// `$decorateDOM` has exactly TWO call sites in 0.48 — `:818` (create) and
// `:1900` (reconcile). `$fullReconcile` (e.g. after `setEditable`) routes
// through `$createNode`, so it is covered by `:818`. Pinned by test.
//
// INCREMENTAL RECOMPUTE
// ---------------------
// The reconciler only enters `$reconcileNode` for DIRTY nodes, so "which
// widgets did this edit touch" is answered by Lexical for free — there is no
// position mapping to forward (EditorState is a flat `Map<NodeKey, LexicalNode>`
// with stable keys; there are no document offsets). The residual gate is the
// `source`/`equals` pair: `source` runs on every reconcile of the host and must
// be pure and cheap; `render` (and therefore any expensive evaluation) runs only
// when the source genuinely changed. An edit elsewhere in the document never
// reaches the widget runtime at all.

import {
  isDOMUnmanaged,
  setDOMUnmanaged,
  type DOMSlot,
  type DOMSlotForNode,
  type EditorDOMRenderConfig,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
} from 'lexical'

/**
 * Where a widget's DOM sits relative to the host node's lexical-managed
 * children.
 *
 *   `'tail'` — after every managed child (the default, and the safe choice).
 *   `'head'` — before every managed child.
 *
 * There is deliberately no third value: an interleaved widget would skew
 * `ElementDOMSlot.resolveChildIndex`, which counts raw `childNodes`, and
 * mis-place the caret on click. See the header, clobbering path 2.
 */
export type WidgetPlacement = 'head' | 'tail'

/** Everything a widget renderer is told about its host. */
export interface WidgetContext<N extends LexicalNode> {
  /** The host node. Read inside the active editor state (the runtime calls
   * every hook from inside the reconciler, so `$`-prefixed reads are legal). */
  readonly node: N
  /** The host node's key. Stable for the node's lifetime — the identity a
   * consumer should key a memo cache by. */
  readonly key: NodeKey
  readonly editor: LexicalEditor
}

/** What a widget's `dispose` is told. No `node`: teardown most often fires
 * because the node was destroyed. */
export interface WidgetDisposeContext {
  readonly key: NodeKey
  readonly editor: LexicalEditor
}

/**
 * A widget's rendering contract.
 *
 * The `source` / `equals` / `render` split is load-bearing, not ceremony. The
 * tempting thinner API — `(node) => HTMLElement | null` — gives the runtime no
 * way to know whether a rebuild is NEEDED, so every reconcile of the host would
 * allocate a subtree and run the consumer's (possibly expensive) computation;
 * and a fresh element every commit destroys the widget's own DOM state (scroll
 * position in a wide result table, a focused cell). Here `source` is the cheap
 * pure projection, `equals` is the gate, and `render` mutates a STABLE host.
 * Same shape, and same reason, as `DecoratorMount.update`.
 *
 * Neither `source` nor `render` may throw: they run inside Lexical's reconciler,
 * where an exception aborts the commit mid-flight.
 */
export interface WidgetSpec<N extends LexicalNode, Source> {
  /** Debug/dedup id; also the value of the host element's `data-llui-widget`.
   * Records are keyed by `${nodeKey}:${id}`, so several widgets may attach to
   * one node as long as their ids differ. */
  readonly id: string

  /** The Lexical node class this widget attaches to. Matched with `instanceof`,
   * so a `{ replace, with, withKlass }` replacement subclass still matches its
   * base klass without any extra resolution. */
  readonly klass: Klass<N>

  /**
   * Derive the widget's INPUT from the node. Runs inside the active editor
   * state on every reconcile of the host. MUST be pure and cheap — it is the
   * gate that makes unrelated edits free.
   *
   * Return `null` for "this node has no widget right now": any existing host is
   * removed and `dispose` runs.
   */
  readonly source: (ctx: WidgetContext<N>) => Source | null

  /** Equality on `Source`. Default `Object.is`. When it holds against the last
   * render's source, `render` is SKIPPED entirely. */
  readonly equals?: (a: Source, b: Source) => boolean

  /**
   * Build/refresh the widget DOM. Called only when the source changed.
   *
   * `host` is a stable, runtime-owned element that is already marked unmanaged,
   * already `contenteditable=false`, and already positioned at the placement
   * boundary. The renderer owns only `host`'s CHILDREN and may
   * `replaceChildren(...)` freely; it must not move or unparent `host` itself.
   */
  readonly render: (host: HTMLElement, source: Source, ctx: WidgetContext<N>) => void

  /**
   * OPTIONAL: style the host node's own DOM in the same pass.
   *
   * Overlay DOM covers "render a computed result"; it does not cover "highlight
   * the source span that produced it" (ProseMirror's `Decoration.inline`). The
   * alternative — a node transform writing `style`/format onto the node — is a
   * DOCUMENT MUTATION and would round-trip into the serialized output, which is
   * exactly what this seam exists to avoid. So the escape hatch lives here.
   *
   * Unlike `render` this runs on EVERY decorate pass, including when `source` is
   * `null` and including when the source is unchanged — because `dom` may be a
   * brand-new element (the `$updateDOM` replacement path) that has none of the
   * previous element's classes. Keep it idempotent, e.g. `classList.toggle`.
   */
  readonly decorateHost?: (dom: HTMLElement, source: Source | null, ctx: WidgetContext<N>) => void

  /** Placement. Default `'tail'`. */
  readonly placement?: WidgetPlacement

  /** Extra classes on the host element (the runtime always adds
   * `llui-node-widget`). */
  readonly className?: string

  /** Tag for the widget host element. Defaults to `'span'` when the node
   * reports `isInline()`, `'div'` otherwise — so an inline widget cannot
   * illegally nest a block element inside a `<span>`. */
  readonly tag?: keyof HTMLElementTagNameMap

  /** Torn down when the host node is destroyed, when `source` goes `null`, or
   * when the editor disposes. Use it to release listeners the renderer attached
   * inside `host`.
   *
   * Its context deliberately omits `node`: the commonest teardown trigger is the
   * node's DESTRUCTION, at which point no node instance exists to hand back.
   * Making that unrepresentable beats handing over a stale or fabricated one. */
  readonly dispose?: (host: HTMLElement, ctx: WidgetDisposeContext) => void
}

/**
 * @internal
 *
 * The type-erased form stored in the registry — monomorphic, exactly like
 * `DecoratorBridge` erases its `Data`. Consumers construct one via
 * {@link nodeWidget}, which is the only place the `Source` type parameter is
 * bound.
 */
export interface ErasedWidgetSpec {
  readonly id: string
  readonly klass: Klass<LexicalNode>
  readonly placement: WidgetPlacement
  readonly className: string | undefined
  readonly tag: keyof HTMLElementTagNameMap | undefined
  readonly source: (ctx: WidgetContext<LexicalNode>) => unknown
  readonly equals: (a: unknown, b: unknown) => boolean
  readonly render: (host: HTMLElement, source: unknown, ctx: WidgetContext<LexicalNode>) => void
  readonly decorateHost:
    | ((dom: HTMLElement, source: unknown, ctx: WidgetContext<LexicalNode>) => void)
    | undefined
  readonly dispose: ((host: HTMLElement, ctx: WidgetDisposeContext) => void) | undefined
}

/** An opaque widget registration, contributed via `lexicalForeign({ widgets })`
 * or a plugin's `widgets` field. */
export interface NodeWidget {
  readonly id: string
  /** @internal */ readonly __spec: ErasedWidgetSpec
}

const defaultEquals = (a: unknown, b: unknown): boolean => Object.is(a, b)

/**
 * Author-facing constructor for a {@link NodeWidget}.
 *
 * It exists for inference: `Source` is inferred from `source` and flows into
 * `render`, `equals`, and `decorateHost` without the caller writing any type
 * parameters. The returned descriptor is type-erased (the registry is
 * monomorphic); the casts below are the single erasure boundary, and they are
 * sound because `WidgetContext` is covariant in `N` and each callback only ever
 * receives back the values this same spec produced.
 */
export function nodeWidget<N extends LexicalNode, Source>(spec: WidgetSpec<N, Source>): NodeWidget {
  const narrow = (ctx: WidgetContext<LexicalNode>): WidgetContext<N> => ctx as WidgetContext<N>
  const equals = spec.equals
  const decorateHost = spec.decorateHost
  const dispose = spec.dispose
  const erased: ErasedWidgetSpec = {
    id: spec.id,
    klass: spec.klass,
    placement: spec.placement ?? 'tail',
    className: spec.className,
    tag: spec.tag,
    source: (ctx) => spec.source(narrow(ctx)),
    equals: equals ? (a, b) => equals(a as Source, b as Source) : defaultEquals,
    render: (host, source, ctx) => spec.render(host, source as Source, narrow(ctx)),
    decorateHost: decorateHost
      ? (dom, source, ctx) => decorateHost(dom, source as Source | null, narrow(ctx))
      : undefined,
    dispose,
  }
  return { id: spec.id, __spec: erased }
}

/** A live widget instance attached to one node. */
interface WidgetRecord {
  readonly spec: ErasedWidgetSpec
  readonly host: HTMLElement
  source: unknown
}

/** Every widget currently live on one node, in registration order. */
type NodeRecords = Map<string, WidgetRecord>

/** The class the runtime always stamps on a widget host, so an app can style
 * every widget (and a test can find them) without knowing each id. */
export const WIDGET_CLASS = 'llui-node-widget'

/** The attribute carrying the widget's `id` on its host element. */
export const WIDGET_ATTR = 'data-llui-widget'

/** What {@link createWidgetRuntime} hands back to `lexicalForeign`. */
export interface WidgetRuntime {
  /** Passed straight to `createEditor({ dom })`. `CreateEditorArgs.dom` is a
   * `Partial<EditorDOMRenderConfig>` spread over `DEFAULT_EDITOR_DOM_CONFIG`
   * (LexicalEditor.ts:1037-1041), so supplying only these two members leaves
   * the other seven at their defaults. */
  readonly domConfig: Partial<EditorDOMRenderConfig>
  /** Wire teardown for the given editor. Call BEFORE `setRootElement` (the
   * first reconcile). Returns a disposer. */
  attach: (editor: LexicalEditor) => () => void
}

/**
 * Build the widget runtime for a set of registrations.
 *
 * Called by `lexicalForeign` ONLY when at least one widget is registered — when
 * none are, `createEditor` is invoked exactly as it was before this seam
 * existed, so every existing consumer sees zero behaviour change and zero
 * exposure to the experimental APIs above.
 */
export function createWidgetRuntime(widgets: readonly NodeWidget[]): WidgetRuntime {
  const specs = widgets.map((w) => w.__spec)
  const byNode = new Map<NodeKey, NodeRecords>()

  const contextFor = (node: LexicalNode, editor: LexicalEditor): WidgetContext<LexicalNode> => ({
    node,
    key: node.getKey(),
    editor,
  })

  const createHost = (spec: ErasedWidgetSpec, node: LexicalNode): HTMLElement => {
    const tag = spec.tag ?? (node.isInline() ? 'span' : 'div')
    const host = document.createElement(tag)
    // Order matters only for readability; all four are independent.
    // `captureSelection` keeps the Lexical selection intact when a DOM caret
    // resolves inside the widget, instead of force-syncing it out.
    setDOMUnmanaged(host, { captureSelection: true })
    host.contentEditable = 'false'
    host.setAttribute(WIDGET_ATTR, spec.id)
    host.className = spec.className ? `${WIDGET_CLASS} ${spec.className}` : WIDGET_CLASS
    return host
  }

  const disposeRecord = (record: WidgetRecord, key: NodeKey, editor: LexicalEditor): void => {
    record.host.remove()
    record.spec.dispose?.(record.host, { key, editor })
  }

  /**
   * Ensure every live host for `node` sits at its placement boundary, in
   * registration order, as a child of `dom`.
   *
   * This is also the recovery for clobbering path 3: after an element
   * replacement the record's host is still parented to the DISCARDED element,
   * so it is moved onto the new `dom` here — the SAME element, so the
   * renderer's DOM and internal state survive the outer-tag change, and
   * `render` is skipped because the source did not change.
   *
   * Both loops are no-ops when the DOM is already correct, so a steady-state
   * reconcile performs no mutation (which matters: every move is a record the
   * mutation observer must then process).
   */
  const reposition = (dom: HTMLElement, records: NodeRecords): void => {
    let headAnchor: ChildNode | null = dom.firstChild
    for (const record of records.values()) {
      if (record.spec.placement !== 'head') continue
      if (record.host === headAnchor) {
        headAnchor = record.host.nextSibling
        continue
      }
      dom.insertBefore(record.host, headAnchor)
    }
    // Walk tails backwards so each one's expected successor is already known.
    const tails: WidgetRecord[] = []
    for (const record of records.values()) {
      if (record.spec.placement === 'tail') tails.push(record)
    }
    let tailAnchor: Node | null = null
    for (let i = tails.length - 1; i >= 0; i--) {
      const host = tails[i]!.host
      if (host.parentNode === dom && host.nextSibling === tailAnchor) {
        tailAnchor = host
        continue
      }
      // `insertBefore(host, null)` is `appendChild(host)`.
      dom.insertBefore(host, tailAnchor)
      tailAnchor = host
    }
  }

  const $decorateDOM = <T extends LexicalNode>(
    node: T,
    _prevNode: null | T,
    dom: HTMLElement,
    editor: LexicalEditor,
  ): void => {
    let ctx: WidgetContext<LexicalNode> | null = null
    const key = node.getKey()
    let records = byNode.get(key)

    for (const spec of specs) {
      if (!(node instanceof spec.klass)) continue
      if (ctx === null) ctx = contextFor(node, editor)
      const next = spec.source(ctx)
      const existing = records?.get(spec.id)

      spec.decorateHost?.(dom, next, ctx)

      if (next === null) {
        if (existing !== undefined) {
          disposeRecord(existing, key, editor)
          records?.delete(spec.id)
        }
        continue
      }

      if (existing !== undefined) {
        // Hot path: same widget, unchanged source. `reposition` below still
        // runs, which is what repairs an element replacement.
        if (!spec.equals(existing.source, next)) {
          existing.source = next
          spec.render(existing.host, next, ctx)
        }
        continue
      }

      const host = createHost(spec, node)
      const record: WidgetRecord = { spec, host, source: next }
      if (records === undefined) {
        records = new Map()
        byNode.set(key, records)
      }
      records.set(spec.id, record)
      spec.render(host, next, ctx)
    }

    if (records !== undefined) {
      if (records.size === 0) byNode.delete(key)
      else reposition(dom, records)
    }
  }

  /**
   * Declare each node's widgets as managed-range boundaries.
   *
   * The base MUST be `node.getDOMSlot(dom)` — never a freshly constructed
   * `ElementDOMSlot` — so that a node class with its own `getDOMSlot` override
   * (e.g. a subclass exposing an inner content element via `withElement`) keeps
   * its own slot semantics. That is exactly what `DEFAULT_EDITOR_DOM_CONFIG`
   * does (LexicalEditor.ts:895-899), and the cast below mirrors its cast for
   * the same reason: `withBefore`/`withAfter` are covariantly overridden on
   * `ElementDOMSlot`, but TS cannot express that through the `DOMSlotForNode`
   * conditional.
   */
  const $getDOMSlot = <N extends LexicalNode>(
    node: N,
    dom: HTMLElement,
    _editor: LexicalEditor,
  ): DOMSlotForNode<N> => {
    const base: DOMSlot<HTMLElement> = node.getDOMSlot(dom)
    const records = byNode.get(node.getKey())
    if (records === undefined || records.size === 0) return base as DOMSlotForNode<N>

    // A boundary may only name a node that is CURRENTLY a child of `dom` —
    // `DOMSlot.insertChild` asserts exactly that. During the create path the
    // hosts are attached after the children are built, so they are legitimately
    // absent here.
    let before: Node | null = null
    let after: Node | null = null
    for (const record of records.values()) {
      if (record.host.parentNode !== dom) continue
      if (record.spec.placement === 'tail') {
        // The FIRST tail host in registration (and therefore DOM) order is the
        // upper boundary; everything after it is overlay.
        if (before === null) before = record.host
      } else {
        // The LAST head host is the lower boundary.
        after = record.host
      }
    }
    let slot = base
    if (before !== null) slot = slot.withBefore(before)
    if (after !== null) slot = slot.withAfter(after)
    return slot as DOMSlotForNode<N>
  }

  return {
    domConfig: { $decorateDOM, $getDOMSlot },
    attach: (editor) => {
      // The ONLY use of a mutation listener in this seam, and it is not part of
      // attach/re-attach (that is `$decorateDOM`'s job, synchronously). It
      // observes 'destroyed' so a deleted host's record does not leak — one
      // entry per deleted node for the editor's lifetime otherwise.
      const klasses = new Set(specs.map((s) => s.klass))
      const unregister = [...klasses].map((klass) =>
        editor.registerMutationListener(
          klass,
          (nodes) => {
            for (const [key, mutation] of nodes) {
              if (mutation !== 'destroyed') continue
              const records = byNode.get(key)
              if (records === undefined) continue
              byNode.delete(key)
              for (const record of records.values()) disposeRecord(record, key, editor)
            }
          },
          { skipInitialization: true },
        ),
      )
      return () => {
        for (const off of unregister) off()
        for (const [key, records] of byNode) {
          for (const record of records.values()) disposeRecord(record, key, editor)
        }
        byNode.clear()
      }
    },
  }
}

/** True when `el` is a widget host produced by this seam. Exported so a
 * consumer (or a test) can assert overlay-vs-document without reaching for the
 * experimental `isDOMUnmanaged` itself. */
export function isNodeWidgetHost(el: Node): boolean {
  return (
    el.nodeType === Node.ELEMENT_NODE &&
    isDOMUnmanaged(el) &&
    (el as Element).hasAttribute(WIDGET_ATTR)
  )
}
