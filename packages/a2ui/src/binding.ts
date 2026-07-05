/**
 * Resolve A2UI `Dynamic*` values (literal | `{path}` | `{call}`) into reactive
 * bindings for the LLui element helpers, and one-shot reads for event handlers.
 */

import { isSignalHandle, type Reactive, type Signal } from '@llui/dom'
import type { RenderContext, RenderScope } from './catalog.js'
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

/** One-shot, non-reactive resolution — for action context + input write-back reads. */
export function resolveDynamic(
  ctx: RenderContext,
  scope: RenderScope,
  dyn: unknown,
): JsonValue | undefined {
  if (dyn === undefined || dyn === null) return dyn ?? undefined
  if (isPathBinding(dyn)) {
    return resolvePointer(sourceFor(scope, dyn.path).peek(), dyn.path)
  }
  if (isFunctionCall(dyn)) {
    const fn = ctx.catalog.functions[dyn.call]
    if (!fn) return undefined
    const r = fn(dyn, ctx, scope)
    return isSignalHandle(r) ? (r as Signal<JsonValue>).peek() : (r as JsonValue)
  }
  return dyn as JsonValue
}

function bindFunction(
  ctx: RenderContext,
  scope: RenderScope,
  dyn: { call: string },
): Reactive<JsonValue> {
  const fn = ctx.catalog.functions[dyn.call]
  if (fn) return fn(dyn as never, ctx, scope)
  warnOnce(`No catalog function "${dyn.call}" — binding resolves to empty`)
  return ''
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
