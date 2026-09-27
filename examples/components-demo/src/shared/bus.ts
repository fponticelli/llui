/**
 * Cross-section event bus.
 *
 * The demo is decomposed into independent apps (inputs, data, overlays, ...)
 * — each with its own state. Cross-cutting actions like "show a toast" or
 * "open a confirmation" originate in one section but need to render in
 * another (the overlays section owns the toast + dialog stacks).
 *
 * The overlays section registers handlers here on mount; other sections
 * call the exposed functions. Fire-and-forget; no responses.
 */

import type { ToastType } from '@llui/components/toast'

/**
 * The bus carries the REAL `ToastType` union (all six values), not a
 * demo-local subset — #265 finding 3 requires both demos to exercise the
 * exact `info`/`success`/`warning`/`error`/`loading`/`custom` vocabulary, and
 * a narrower bus alias here silently hid three of them from every section
 * that only ever imports `ToastKind`.
 */
export type ToastKind = ToastType

let onToast: (kind: ToastKind, title: string, description: string) => void = () => {}
let onConfirm: (
  tag: string,
  title: string,
  description: string,
  destructive: boolean,
) => void = () => {}

export function registerToastHandler(
  fn: (kind: ToastKind, title: string, description: string) => void,
): void {
  onToast = fn
}
export function registerConfirmHandler(
  fn: (tag: string, title: string, description: string, destructive: boolean) => void,
): void {
  onConfirm = fn
}

export function showToast(kind: ToastKind, title: string, description: string): void {
  onToast(kind, title, description)
}
export function askConfirm(
  tag: string,
  title: string,
  description: string,
  destructive = false,
): void {
  onConfirm(tag, title, description, destructive)
}
