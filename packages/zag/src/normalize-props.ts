function normalize(props: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue
    if (key === 'className') { result.class = value; continue }
    if (key === 'htmlFor') { result.for = value; continue }
    if ((key === 'readOnly' || key === 'disabled' || key === 'hidden') && value === false) continue
    if (key === 'style' && typeof value === 'object' && value !== null) {
      result.style = Object.entries(value as Record<string, string | number>)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${k.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}: ${v}`)
        .join('; ')
      continue
    }
    result[key] = value
  }
  return result
}

// Zag v1 expects normalizeProps.button(props), normalizeProps.element(props), etc.
// This Proxy routes all element types to the same normalize function.
export const normalizeProps = new Proxy(
  {} as Record<string, (props: Record<string, unknown>) => Record<string, unknown>>,
  { get: () => normalize },
)
