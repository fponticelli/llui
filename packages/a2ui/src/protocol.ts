/**
 * A2UI protocol v0.9 — type definitions for the server→client message stream
 * and the value/binding primitives shared across catalogs.
 *
 * Reference: https://a2ui.org/specification/v0.9-a2ui/
 */

export const A2UI_VERSION = 'v0.9'

/** A JSON-serializable value — the shape of an A2UI surface data model. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

export type JsonObject = { readonly [key: string]: JsonValue }

// ---------------------------------------------------------------------------
// Value bindings (common_types.json)
// ---------------------------------------------------------------------------

/** A reference into the surface data model via a JSON-Pointer-ish path. */
export interface PathBinding {
  readonly path: string
}

/** A catalog-registered function invocation (validation, formatting, actions). */
export interface FunctionCall {
  readonly call: string
  readonly args?: Readonly<Record<string, unknown>>
  readonly returnType?: string
}

/** A value that may be a literal, a data-model path, or a function result. */
export type DynamicString = string | PathBinding | FunctionCall
export type DynamicNumber = number | PathBinding | FunctionCall
export type DynamicBoolean = boolean | PathBinding | FunctionCall
export type DynamicStringList = readonly string[] | PathBinding | FunctionCall

export type ComponentId = string

/** Container children: a static id list, or a template repeated over a collection. */
export interface ChildTemplate {
  readonly componentId: ComponentId
  readonly path: string
}
export type ChildList = readonly ComponentId[] | ChildTemplate

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/**
 * A single component in the flat adjacency-list tree. Component-type-specific
 * properties are open (custom catalogs), so this is an open record keyed by the
 * two guaranteed fields.
 */
export interface ComponentNode {
  readonly id: ComponentId
  readonly component: string
  readonly [prop: string]: unknown
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** A server-bound event dispatched when the user triggers an action. */
export interface ActionEvent {
  readonly name: string
  readonly context?: Readonly<Record<string, unknown>>
}

/** A component action: dispatch an event to the server and/or run a local function. */
export interface Action {
  readonly event?: ActionEvent
  readonly functionCall?: FunctionCall
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export interface Theme {
  readonly primaryColor?: string
  readonly iconUrl?: string
  readonly agentDisplayName?: string
  readonly font?: string
  readonly [key: string]: JsonValue | undefined
}

// ---------------------------------------------------------------------------
// Server → client envelope (server_to_client.json)
// ---------------------------------------------------------------------------

export interface CreateSurface {
  readonly surfaceId: string
  readonly catalogId: string
  readonly theme?: Theme
  readonly sendDataModel?: boolean
}

export interface UpdateComponents {
  readonly surfaceId: string
  readonly components: readonly ComponentNode[]
}

export interface UpdateDataModel {
  readonly surfaceId: string
  /** JSON-Pointer location; defaults to `/` (whole model) when omitted. */
  readonly path?: string
  /** New value; omission removes the key at `path`. */
  readonly value?: JsonValue
}

export interface DeleteSurface {
  readonly surfaceId: string
}

/** One server→client message. Exactly one of the four payload fields is set. */
export interface ServerToClientEnvelope {
  readonly version?: string
  readonly createSurface?: CreateSurface
  readonly updateComponents?: UpdateComponents
  readonly updateDataModel?: UpdateDataModel
  readonly deleteSurface?: DeleteSurface
}

// ---------------------------------------------------------------------------
// Runtime discriminators for the open Dynamic* unions
// ---------------------------------------------------------------------------

export function isPathBinding(value: unknown): value is PathBinding {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { path?: unknown }).path === 'string'
  )
}

export function isFunctionCall(value: unknown): value is FunctionCall {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { call?: unknown }).call === 'string'
  )
}

export function isChildTemplate(value: ChildList | undefined): value is ChildTemplate {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as ChildTemplate).componentId === 'string'
  )
}
