/**
 * Anatomy — describes a component's parts and assigns unique ids per instance.
 *
 * Each component (dialog, menu, tabs, ...) declares its parts once. Every
 * mount creates a fresh scope with unique ids used for ARIA wiring
 * (`aria-controls`, `aria-labelledby`) and `data-scope`/`data-part` for CSS.
 *
 * ```ts
 * const DialogAnatomy = anatomy('dialog', [
 *   'trigger', 'positioner', 'backdrop', 'content', 'title', 'description', 'closeTrigger',
 * ] as const)
 *
 * // Per instance:
 * const parts = DialogAnatomy.scope()
 * parts.attrs('trigger')       // { id: 'dialog-1:trigger', 'data-scope': 'dialog', 'data-part': 'trigger' }
 * parts.idFor('content')       // 'dialog-1:content'
 * ```
 */

let counter = 0

/** Reset the internal id counter — tests only. */
export function resetAnatomyIdCounter(): void {
  counter = 0
}

export interface AnatomyScope<P extends string> {
  /** Instance id — unique across all anatomy scopes. */
  readonly id: string
  /** Resolve the id for a specific part (for ARIA wiring). */
  idFor(part: P): string
  /** Build the common data-attrs + id for a part. */
  attrs(part: P): { id: string; 'data-scope': string; 'data-part': P }
}

export interface Anatomy<P extends string> {
  readonly name: string
  readonly parts: readonly P[]
  /** Create a new scope instance. Pass an explicit id to force a value (SSR). */
  scope(id?: string): AnatomyScope<P>
}

export function anatomy<P extends string>(name: string, parts: readonly P[]): Anatomy<P> {
  return {
    name,
    parts,
    scope(id?: string): AnatomyScope<P> {
      const scopeId = id ?? `${name}-${++counter}`
      return {
        id: scopeId,
        idFor: (part) => `${scopeId}:${part}`,
        attrs: (part) => ({
          id: `${scopeId}:${part}`,
          'data-scope': name,
          'data-part': part,
        }),
      }
    },
  }
}
