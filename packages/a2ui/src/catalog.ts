/**
 * The catalog seam: how an A2UI component-type name maps to a live LLui build.
 *
 * A catalog is an open registry of builders (`Text` → …, `Button` → …) plus
 * client-defined functions. Custom catalogs plug in via {@link defineCatalog},
 * optionally extending the Basic catalog.
 */

import type { Signal, Renderable } from '@llui/dom'
import type {
  ChildList,
  ComponentId,
  ComponentNode,
  FunctionCall,
  JsonObject,
  JsonValue,
  Theme,
} from './protocol.js'
import type { A2uiMsg } from './state.js'

/**
 * The reactive data context a component renders against. At the surface root
 * this wraps the whole data model; inside a template it wraps the current item.
 */
export interface RenderScope {
  /** Reactive data for this scope (root data model, or a template item). */
  readonly data: Signal<JsonValue>
  /**
   * The local data-model root for THIS scope: the surface data model at the top
   * level, or the current item inside a template. Per the A2UI spec, template
   * paths are item-scoped, so both relative (`name`) and leading-slash (`/name`)
   * bindings resolve against this. Correctly scoped for the current depth.
   */
  readonly root: Signal<JsonValue>
  /**
   * Client-local UI state for stateful components, correctly scoped for THIS
   * depth (threaded through template rows like {@link root}). Read via this;
   * write via {@link RenderContext.setUi}.
   */
  readonly uiState: Signal<JsonObject>
  /**
   * Resolve a component-relative pointer to an ABSOLUTE data-model pointer,
   * used for two-way write-back. Absolute pointers pass through unchanged.
   */
  absPath(pointer: string): string
  /**
   * Stable prefix identifying THIS scope instance (`''` at the surface root,
   * `/rows/0` in a template row). Namespaces client-local UI state so a stateful
   * component repeated across template rows gets independent state per row.
   */
  readonly keyPrefix: string
  /**
   * Ids of the components currently being rendered on the path from the surface
   * root down to (but not including) this scope's component. Threaded so
   * {@link RenderContext.renderById} can detect a cyclic adjacency list
   * (`root → children:['root']`, or A → B → A) and refuse to recurse instead of
   * overflowing the stack on one malformed envelope.
   */
  readonly ancestors: ReadonlySet<ComponentId>
}

/** Everything a builder needs to render one component and recurse into children. */
export interface RenderContext {
  readonly surfaceId: string
  readonly theme: Signal<Theme>
  /** The surface data model root (absolute `/…` bindings resolve against this). */
  readonly rootData: Signal<JsonValue>
  readonly send: (msg: A2uiMsg) => void
  readonly catalog: Catalog
  /** Write a stateful component's local UI state (Tabs active tab, Modal open). */
  setUi(componentId: ComponentId, value: JsonValue): void
  /** Look up a component definition by id in the current structural snapshot. */
  getComponent(id: ComponentId): ComponentNode | undefined
  /** Render a component (and its subtree) by id within a scope. */
  renderById(id: ComponentId, scope: RenderScope): Renderable
  /** Render a static id list or a repeated template within a scope. */
  renderChildren(children: ChildList | undefined, scope: RenderScope): Renderable
}

export interface BuildArgs {
  readonly node: ComponentNode
  readonly ctx: RenderContext
  readonly scope: RenderScope
}

/** Builds the live DOM for one A2UI component type. */
export type ComponentBuilder = (args: BuildArgs) => Renderable

/**
 * Evaluation environment handed to a catalog function: the current data root and
 * scope data (for `${path}` interpolation), plus resolvers for the call's args
 * and arbitrary dynamic values (literal | `{path}` | nested `{call}`).
 */
export interface EvalEnv {
  readonly root: JsonValue
  readonly data: JsonValue
  /** Resolve one of the call's args by name. */
  arg(name: string): JsonValue | undefined
  /** Resolve an arbitrary dynamic value (used for nested calls / interpolation). */
  eval(value: unknown): JsonValue | undefined
}

/**
 * A client-defined function (formatting, validation, local actions). Pure: given
 * a call and its evaluation environment, return a value. Reactivity is handled
 * once at the binding site, so functions need not deal with signals.
 */
export type CatalogFunction = (call: FunctionCall, env: EvalEnv) => JsonValue

export interface Catalog {
  readonly id?: string
  readonly components: Readonly<Record<string, ComponentBuilder>>
  readonly functions: Readonly<Record<string, CatalogFunction>>
}

export interface CatalogSpec {
  readonly id?: string
  readonly components: Readonly<Record<string, ComponentBuilder>>
  readonly functions?: Readonly<Record<string, CatalogFunction>>
  /** A base catalog to inherit builders/functions from (this spec wins on conflict). */
  readonly extends?: Catalog
}

/** Build a catalog, optionally layering over a base. Registry records use a
 * null prototype so a server-supplied component/function name like
 * "__proto__"/"toString"/"constructor" can't resolve to a prototype member. */
export function defineCatalog(spec: CatalogSpec): Catalog {
  return {
    id: spec.id ?? spec.extends?.id,
    components: Object.assign(
      Object.create(null) as Record<string, ComponentBuilder>,
      spec.extends?.components ?? {},
      spec.components,
    ),
    functions: Object.assign(
      Object.create(null) as Record<string, CatalogFunction>,
      spec.extends?.functions ?? {},
      spec.functions ?? {},
    ),
  }
}

/** A resolver from an A2UI `catalogId` to a concrete catalog. */
export type CatalogResolver = (catalogId: string) => Catalog | undefined

let warned: Set<string> | undefined
export function warnOnce(message: string): void {
  warned ??= new Set()
  if (warned.has(message)) return
  warned.add(message)
  if (typeof console !== 'undefined') console.warn(`[@llui/a2ui] ${message}`)
}
