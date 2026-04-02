/**
 * Creates a normalizeProps function for LLui.
 * Maps Zag's React-centric prop names to LLui/DOM conventions.
 */
export function createNormalizeProps(): (props: Record<string, unknown>) => Record<string, unknown> {
  return (props) => {
    const result: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(props)) {
      // Skip undefined/null values
      if (value === undefined) continue

      // className → class
      if (key === 'className') {
        result.class = value
        continue
      }

      // htmlFor → for
      if (key === 'htmlFor') {
        result.for = value
        continue
      }

      // readOnly: false → skip
      if (key === 'readOnly' && value === false) continue

      // disabled: false → skip
      if (key === 'disabled' && value === false) continue

      // hidden: false → skip
      if (key === 'hidden' && value === false) continue

      // style objects → CSS string
      if (key === 'style' && typeof value === 'object' && value !== null) {
        const styleObj = value as Record<string, string | number>
        result.style = Object.entries(styleObj)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => `${camelToKebab(k)}: ${v}`)
          .join('; ')
        continue
      }

      // children string → textContent (Zag sometimes passes text as children)
      if (key === 'children' && typeof value === 'string') {
        result.textContent = value
        continue
      }

      // Pass everything else through (including on* event handlers,
      // data-* attributes, aria-* attributes, role, etc.)
      result[key] = value
    }

    return result
  }
}

function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}
