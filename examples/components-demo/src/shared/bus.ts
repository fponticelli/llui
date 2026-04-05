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

export type ToastKind = 'info' | 'success' | 'error'

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
