/** Internal value navigation used by the public roving-focus primitive. */

export function firstEnabled(items: readonly string[], disabled: readonly string[]): string | null {
  for (const value of items) if (!disabled.includes(value)) return value
  return null
}

export function lastEnabled(items: readonly string[], disabled: readonly string[]): string | null {
  for (let index = items.length - 1; index >= 0; index--) {
    const value = items[index]!
    if (!disabled.includes(value)) return value
  }
  return null
}

export function nextEnabled(
  items: readonly string[],
  disabled: readonly string[],
  from: string,
  delta: 1 | -1,
  loop: boolean,
): string | null {
  if (items.length === 0) return null
  const index = items.indexOf(from)
  if (index === -1) return firstEnabled(items, disabled)
  const count = items.length
  for (let offset = 1; offset <= count; offset++) {
    const rawIndex = index + delta * offset
    if (!loop && (rawIndex < 0 || rawIndex >= count)) return null
    const next = items[((rawIndex % count) + count) % count]!
    if (!disabled.includes(next)) return next
  }
  return null
}
