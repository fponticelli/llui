import { signalForeign, isSignalHandle } from '@llui/dom'
import type { Signal } from '@llui/dom'

interface RawHtmlInstance {
  el: Element
}

/**
 * Render a reactive HTML string as real DOM children of a host element.
 *
 * The signal DOM has no `innerHTML` prop (an `innerHTML` attribute would not
 * parse), and the authoring `foreign()` helper is a compile-time stub that only
 * works when the compiler lowers it inside a `view:` array — this helper is
 * called from view-HELPER composition (`siteLayout(...)` args), which the
 * transform leaves verbatim. So we call the runtime `signalForeign` directly,
 * the same primitive the compiler emits, building the `SignalSpec` from the
 * runtime signal handle the helper receives.
 *
 * The boot binding fires once on the build's host element — during SSR that host
 * comes from the server `DomEnv`, so the parsed children serialize into the
 * static HTML; on the client the same binding runs against the live element. The
 * declared `html` signal keeps it reactive across state changes.
 */
export function rawHtml(html: Signal<string>, className?: string): Node {
  if (!isSignalHandle(html)) {
    throw new Error('rawHtml() expects a runtime signal handle (state.map(...) / state.at(...))')
  }
  const htmlSpec: { produce: (s: unknown) => unknown; deps: readonly string[] } = {
    produce: html.produce,
    deps: html.deps,
  }
  return signalForeign<RawHtmlInstance, { html: typeof htmlSpec }>({
    tag: 'div',
    state: { html: htmlSpec },
    mount: ({ el, state }) => {
      if (className) el.className = className
      state.html.bind((value) => {
        el.innerHTML = value == null ? '' : String(value)
      })
      return { el }
    },
  })
}
