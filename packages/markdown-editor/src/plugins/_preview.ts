// Shared rendered-preview seam for the math / mermaid decorator plugins.
//
// SECURITY: a consumer-supplied `render` turns editor-document content
// (TeX / mermaid source the user typed) into a preview. To avoid forcing
// that through an unsanitized HTML sink, `render` may return EITHER:
//
//   - a DOM `Node` — mounted directly with no HTML round-trip and NO
//     sanitization needed (prefer this: hand back the element KaTeX /
//     mermaid already produced); or
//   - a `string` — injected as **trusted HTML**. The renderer owns
//     sanitization in this branch; document content flows into it, so a
//     vulnerable/misconfigured renderer is an XSS sink. Return sanitized
//     markup (e.g. via DOMPurify) or prefer the Node form.

import { foreign, type Mountable, type Signal } from '@llui/dom'

/** A preview renderer: source string → safe DOM node, or trusted HTML string. */
export type PreviewRender = (source: string) => string | Node

interface PreviewInstance {
  unbind: () => void
}

/**
 * Build a reactive `data-part="preview"` region that re-renders whenever
 * `source` changes. String results are set as trusted HTML; Node results
 * are mounted directly (no sanitization). See the module header.
 */
export function renderedPreview(
  source: Signal<string>,
  render: PreviewRender,
  tag = 'div',
): Mountable {
  return foreign<PreviewInstance, { source: Signal<string> }>({
    tag,
    state: { source },
    mount: ({ el, state }) => {
      el.setAttribute('data-part', 'preview')
      el.setAttribute('contenteditable', 'false')
      const apply = (value: string): void => {
        const out = render(value)
        if (typeof out === 'string') el.innerHTML = out
        else el.replaceChildren(out)
      }
      // `bind` fires immediately with the current value, then on change.
      const unbind = state.source.bind(apply)
      return { unbind }
    },
    unmount: (instance) => instance.unbind(),
  })
}
