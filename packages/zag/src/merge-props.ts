/**
 * Merges multiple prop objects with special handling for:
 * - class/className: concatenated with space
 * - style: merged (later values override)
 * - on* event handlers: chained (all fire, in order)
 * - other props: last wins
 */
export function mergeProps(
  ...sources: Array<Record<string, unknown>>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {}

  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) continue

      // Merge class names
      if (key === 'class' || key === 'className') {
        const existing = (result.class as string) ?? ''
        result.class = existing ? `${existing} ${value}` : value
        continue
      }

      // Merge styles
      if (key === 'style') {
        const existing = (result.style as string) ?? ''
        const incoming = typeof value === 'string' ? value : ''
        result.style = existing ? `${existing}; ${incoming}` : incoming
        continue
      }

      // Chain event handlers
      if (/^on[A-Z]/.test(key) && typeof value === 'function') {
        if (!handlers[key]) handlers[key] = []
        handlers[key].push(value as (...args: unknown[]) => void)
        continue
      }

      result[key] = value
    }
  }

  // Build chained handlers
  for (const [key, fns] of Object.entries(handlers)) {
    if (fns.length === 1) {
      result[key] = fns[0]
    } else {
      result[key] = (...args: unknown[]) => {
        for (const fn of fns) fn(...args)
      }
    }
  }

  return result
}
