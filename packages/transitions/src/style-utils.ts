import type { Styles, TransitionValue } from './types.js'

// CSS properties that are unitless when given a numeric value.
// All other numeric values are suffixed with `px`.
const UNITLESS = new Set([
  'opacity',
  'flex',
  'flexGrow',
  'flexShrink',
  'flexNegative',
  'order',
  'zIndex',
  'fontWeight',
  'lineHeight',
  'zoom',
  'gridRow',
  'gridRowStart',
  'gridRowEnd',
  'gridColumn',
  'gridColumnStart',
  'gridColumnEnd',
  'columnCount',
  'tabSize',
  'scale',
  'aspectRatio',
])

function formatStyleValue(prop: string, value: string | number): string {
  if (typeof value === 'string') return value
  if (UNITLESS.has(prop)) return String(value)
  return `${value}px`
}

function splitClasses(raw: string): string[] {
  const out: string[] = []
  const parts = raw.split(/\s+/)
  for (const p of parts) {
    if (p.length > 0) out.push(p)
  }
  return out
}

/**
 * Filter an array of nodes down to HTMLElements — transition animations
 * only apply to elements, not comment anchors or text nodes.
 */
export function asElements(nodes: Node[]): HTMLElement[] {
  const out: HTMLElement[] = []
  for (const n of nodes) {
    if (n.nodeType === 1) out.push(n as HTMLElement)
  }
  return out
}

/** Apply a TransitionValue (classes, styles, or a mix) to an element. */
export function applyValue(el: HTMLElement, value: TransitionValue | undefined): void {
  if (value == null) return
  if (typeof value === 'string') {
    applyClasses(el, value)
    return
  }
  if (Array.isArray(value)) {
    for (const part of value) {
      if (typeof part === 'string') applyClasses(el, part)
      else applyStyles(el, part)
    }
    return
  }
  applyStyles(el, value)
}

/** Remove a TransitionValue from an element. */
export function removeValue(el: HTMLElement, value: TransitionValue | undefined): void {
  if (value == null) return
  if (typeof value === 'string') {
    removeClasses(el, value)
    return
  }
  if (Array.isArray(value)) {
    for (const part of value) {
      if (typeof part === 'string') removeClasses(el, part)
      else removeStyles(el, part)
    }
    return
  }
  removeStyles(el, value)
}

/**
 * The inline-style property keys a TransitionValue would set (classes contribute
 * none). Used to snapshot/restore an element's pre-transition inline styles so
 * cleanup never blanks an author-set inline value.
 */
export function styleKeysOf(value: TransitionValue | undefined): string[] {
  if (value == null) return []
  if (typeof value === 'string') return [] // classes only
  if (Array.isArray(value)) {
    const keys: string[] = []
    for (const part of value) {
      if (typeof part !== 'string') keys.push(...Object.keys(part))
    }
    return keys
  }
  return Object.keys(value)
}

/**
 * Snapshot the element's current inline value for each of `keys`. An unset
 * property snapshots as `''`, so restoring it later blanks it (its natural
 * "not inline-set" state) rather than inventing a value.
 */
export function snapshotInline(el: HTMLElement, keys: Iterable<string>): Record<string, string> {
  const decl = el.style as unknown as Record<string, string>
  const snap: Record<string, string> = {}
  for (const key of keys) snap[key] = decl[key] ?? ''
  return snap
}

/** Restore inline style values captured by {@link snapshotInline}. */
export function restoreInline(el: HTMLElement, snapshot: Record<string, string>): void {
  const decl = el.style as unknown as Record<string, string>
  for (const key in snapshot) decl[key] = snapshot[key]!
}

/** Remove ONLY the class portions of a TransitionValue, leaving styles untouched. */
export function removeClassesOnly(el: HTMLElement, value: TransitionValue | undefined): void {
  if (value == null) return
  if (typeof value === 'string') {
    removeClasses(el, value)
    return
  }
  if (Array.isArray(value)) {
    for (const part of value) {
      if (typeof part === 'string') removeClasses(el, part)
    }
  }
}

function applyClasses(el: HTMLElement, raw: string): void {
  const classes = splitClasses(raw)
  if (classes.length > 0) el.classList.add(...classes)
}

function removeClasses(el: HTMLElement, raw: string): void {
  const classes = splitClasses(raw)
  if (classes.length > 0) el.classList.remove(...classes)
}

function applyStyles(el: HTMLElement, styles: Styles): void {
  const decl = el.style as unknown as Record<string, string>
  for (const key in styles) {
    decl[key] = formatStyleValue(key, styles[key]!)
  }
}

function removeStyles(el: HTMLElement, styles: Styles): void {
  const decl = el.style as unknown as Record<string, string>
  for (const key in styles) {
    decl[key] = ''
  }
}

/**
 * Detect total transition duration from computed styles.
 * Returns the maximum of (transition-duration + transition-delay) and
 * (animation-duration + animation-delay), in milliseconds.
 */
export function detectDuration(el: HTMLElement): number {
  const cs = getComputedStyle(el)
  const t = parseTime(cs.transitionDuration) + parseTime(cs.transitionDelay)
  const a = parseTime(cs.animationDuration) + parseTime(cs.animationDelay)
  return Math.max(t, a)
}

function parseTime(raw: string): number {
  if (!raw) return 0
  let max = 0
  const parts = raw.split(',')
  for (const part of parts) {
    const trimmed = part.trim()
    const m = trimmed.match(/^([\d.]+)(m?s)$/)
    if (!m) continue
    const n = parseFloat(m[1]!)
    const ms = m[2] === 's' ? n * 1000 : n
    if (ms > max) max = ms
  }
  return max
}

/** Force a style recalculation so subsequent class/style changes animate. */
export function forceReflow(el: HTMLElement): void {
  // Reading an offset property forces synchronous layout.
  void el.offsetHeight
}
