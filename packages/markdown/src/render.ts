// renderMarkdown (snapshot) + markdown() (reactive view helper).
//
// `markdown()` is parser-injected via createMarkdown() so the GFM-batteries entry
// (`@llui/markdown`) and the GFM-free CommonMark entry (`@llui/markdown/commonmark`)
// share ONE render implementation while each binds its own parser — the CommonMark
// path never pulls the GFM extensions into a consumer's bundle.

import { div, each, isSignalHandle } from '@llui/dom'
import type { Mountable, Renderable, Reactive, Signal } from '@llui/dom'
import type { Root } from 'mdast'
import type { MarkdownOptions } from './types.js'
import { resolveOptions } from './options.js'
import { makeContext, collectDefinitions } from './context.js'
import { toKeyedBlocks } from './keying.js'

/** A Markdown → mdast parser (GFM or CommonMark). Injected into {@link createMarkdown}. */
export type ParseFn = (src: string, opts?: MarkdownOptions) => Root

/** Render an already-parsed mdast {@link Root} to LLui DOM (no wrapper element).
 * Returns the rendered top-level blocks. Parser-agnostic (takes an mdast tree). */
export function renderMarkdown(root: Root, opts: MarkdownOptions = {}): Renderable {
  const options = resolveOptions(opts)
  const ctx = makeContext(options, collectDefinitions(root))
  return ctx.renderChildren(root)
}

interface RenderUnit {
  key: string | number
  hash: string
  render: () => Renderable
}

/** Narrow a `Reactive<string>` to its `Signal` arm (vs a plain string). */
function isSignal(value: Reactive<string>): value is Signal<string> {
  return isSignalHandle(value)
}

/** Build a reactive Markdown view bound to a specific parser.
 *
 * - Plain `string` source → parsed once, rendered statically.
 * - `Signal<string>` source → re-parsed on change; top-level blocks are keyed by a
 *   content hash (folding in the reference definitions each block resolves) and
 *   rendered through `each`, so unchanged earlier blocks keep their DOM and only the
 *   changing tail (and appended / newly-resolved blocks) rebuild. This makes
 *   streaming / growing Markdown (e.g. LLM output) cheap to render. */
export function createMarkdown(parse: ParseFn) {
  return function markdown(source: Reactive<string>, opts: MarkdownOptions = {}): Mountable {
    const options = resolveOptions(opts)

    if (!isSignal(source)) {
      const root = parse(source, opts)
      const ctx = makeContext(options, collectDefinitions(root))
      return div({ class: options.class }, ctx.renderChildren(root))
    }

    const units = source.map((src): RenderUnit[] => {
      const root = parse(src, opts)
      const definitions = collectDefinitions(root)
      const ctx = makeContext(options, definitions)
      return toKeyedBlocks(root, src, options, definitions).map((block) => ({
        key: block.key,
        hash: block.hash,
        render: () => ctx.render(block.node),
      }))
    })

    // Default: the outer key IS content-based, so a changed block gets a new key and
    // the row rebuilds — lean static rows suffice (the streaming-optimal path).
    //
    // With a custom `keyOf`, blocks can keep a STABLE key across content edits, so the
    // outer list won't rebuild them. Each row is then a stable wrapper element (the
    // identity transitions/animations attach to) containing a one-item keyed list
    // keyed by the content `hash`, so the block's DOM rebuilds IN PLACE when its
    // content changes while the wrapper — and the row's identity — persists.
    const rows = options.keyOf
      ? each(units, {
          key: (unit) => unit.key,
          render: (unit) => [
            div({ class: 'markdown-block' }, [
              each(
                unit.map((u) => [u]),
                { key: (u) => u.hash, render: (u) => u.peek().render() },
              ),
            ]),
          ],
        })
      : each(units, {
          key: (unit) => unit.key,
          render: (unit) => unit.peek().render(),
        })

    return div({ class: options.class }, [rows])
  }
}
