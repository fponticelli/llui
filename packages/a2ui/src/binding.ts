/**
 * Resolve A2UI `Dynamic*` values (literal | `{path}` | `{call}`) into reactive
 * bindings for the LLui element helpers, and one-shot reads for event handlers.
 */

import { derived, isSignalHandle, type Reactive, type Signal } from '@llui/dom'
import type { Catalog, EvalEnv, RenderContext, RenderScope } from './catalog.js'
import { warnOnce } from './catalog.js'
import {
  isFunctionCall,
  isPathBinding,
  type DynamicBoolean,
  type DynamicNumber,
  type DynamicString,
  type DynamicStringList,
  type JsonValue,
} from './protocol.js'
import { resolvePointer } from './pointer.js'

/** Coerce any JSON value to a display string. */
export function displayString(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function sourceFor(scope: RenderScope, path: string): Signal<JsonValue> {
  return path.startsWith('/') ? scope.root : scope.data
}

/** Map a maybe-reactive JSON value through a coercion, preserving reactivity. */
function mapReactive<T>(r: Reactive<JsonValue>, fn: (v: JsonValue) => T): Reactive<T> {
  return isSignalHandle(r) ? (r as Signal<JsonValue>).map(fn) : fn(r as JsonValue)
}

/**
 * Pure evaluation of a dynamic value against data snapshots: literal → itself;
 * `{path}` → pointer resolution (absolute against `root`, relative against
 * `data`); `{call}` → the catalog function, recursively.
 */
export function evalDynamic(
  catalog: Catalog,
  root: JsonValue,
  data: JsonValue,
  value: unknown,
): JsonValue | undefined {
  if (isPathBinding(value)) {
    const src = value.path.startsWith('/') ? root : data
    return resolvePointer(src, value.path)
  }
  if (isFunctionCall(value)) {
    const fn = catalog.functions[value.call]
    if (!fn) {
      warnOnce(`No catalog function "${value.call}" — binding resolves to empty`)
      return undefined
    }
    const env: EvalEnv = {
      root,
      data,
      eval: (v) => evalDynamic(catalog, root, data, v),
      arg: (name) => evalDynamic(catalog, root, data, value.args?.[name]),
    }
    return fn(value, env)
  }
  return value as JsonValue
}

/** A validation check on an input/button: a function call plus an error message. */
export interface Check {
  readonly call: string
  readonly args?: Readonly<Record<string, unknown>>
  readonly message?: string
}

/**
 * Reactively evaluate a component's `checks`, returning the first failing check's
 * message (or `null` if all pass). Returns `null` when there are no checks.
 */
export function firstCheckError(
  ctx: RenderContext,
  scope: RenderScope,
  checks: readonly Check[] | undefined,
): Signal<string | null> | null {
  if (!checks || checks.length === 0) return null
  const catalog = ctx.catalog
  return derived(scope.root, scope.data, (root, data): string | null => {
    for (const check of checks) {
      const ok = evalDynamic(catalog, root, data, { call: check.call, args: check.args })
      if (ok !== true) return check.message ?? 'Invalid'
    }
    return null
  })
}

/** One-shot, non-reactive resolution — for action context + input write-back reads. */
export function resolveDynamic(
  ctx: RenderContext,
  scope: RenderScope,
  dyn: unknown,
): JsonValue | undefined {
  return evalDynamic(ctx.catalog, scope.root.peek(), scope.data.peek(), dyn)
}

/** Reactive evaluation of a `{call}` (or any dynamic value) as a binding source. */
function bindFunction(ctx: RenderContext, scope: RenderScope, dyn: unknown): Reactive<JsonValue> {
  const catalog = ctx.catalog
  return derived(
    scope.root,
    scope.data,
    (root, data) => evalDynamic(catalog, root, data, dyn) ?? '',
  )
}

/** Reactive string binding for text/attrs. */
export function bindString(
  ctx: RenderContext,
  scope: RenderScope,
  dyn: DynamicString | undefined,
): Reactive<string> {
  if (dyn === undefined) return ''
  if (isPathBinding(dyn)) {
    const path = dyn.path
    return sourceFor(scope, path).map((d) => displayString(resolvePointer(d, path)))
  }
  if (isFunctionCall(dyn)) {
    return mapReactive(bindFunction(ctx, scope, dyn), displayString)
  }
  return typeof dyn === 'string' ? dyn : displayString(dyn as JsonValue)
}

function toNumber(value: JsonValue | undefined): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Reactive number binding (Slider value/min/max). */
export function bindNumber(
  ctx: RenderContext,
  scope: RenderScope,
  dyn: DynamicNumber | undefined,
): Reactive<number> {
  if (dyn === undefined) return 0
  if (isPathBinding(dyn)) {
    const path = dyn.path
    return sourceFor(scope, path).map((d) => toNumber(resolvePointer(d, path)))
  }
  if (isFunctionCall(dyn)) {
    return mapReactive(bindFunction(ctx, scope, dyn), toNumber)
  }
  return typeof dyn === 'number' ? dyn : toNumber(dyn as JsonValue)
}

function toBoolean(value: JsonValue | undefined): boolean {
  return value === true || value === 'true'
}

/** Reactive boolean binding (CheckBox value). */
export function bindBoolean(
  ctx: RenderContext,
  scope: RenderScope,
  dyn: DynamicBoolean | undefined,
): Reactive<boolean> {
  if (dyn === undefined) return false
  if (isPathBinding(dyn)) {
    const path = dyn.path
    return sourceFor(scope, path).map((d) => toBoolean(resolvePointer(d, path)))
  }
  if (isFunctionCall(dyn)) {
    return mapReactive(bindFunction(ctx, scope, dyn), toBoolean)
  }
  return typeof dyn === 'boolean' ? dyn : toBoolean(dyn as JsonValue)
}

function toStringList(value: JsonValue | undefined): readonly string[] {
  if (Array.isArray(value)) return value.map((v) => displayString(v as JsonValue))
  return []
}

/** Reactive string-list binding (ChoicePicker value). */
export function bindStringList(
  ctx: RenderContext,
  scope: RenderScope,
  dyn: DynamicStringList | undefined,
): Reactive<readonly string[]> {
  if (dyn === undefined) return []
  if (isPathBinding(dyn)) {
    const path = dyn.path
    return sourceFor(scope, path).map((d) => toStringList(resolvePointer(d, path)))
  }
  if (isFunctionCall(dyn)) {
    return mapReactive(bindFunction(ctx, scope, dyn), toStringList)
  }
  return Array.isArray(dyn) ? dyn.map((v) => String(v)) : []
}
