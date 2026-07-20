// YAML frontmatter plugin — the leading `---` … `---` metadata block.
//
// ## Why the block is an OPAQUE STRING, not parsed YAML
//
// Deliberate choice, and the requirement that drove it is round-trip fidelity:
// what the author wrote must come back out byte-for-byte. Two options exist —
// parse YAML properly, or don't parse it at all — and only the second is
// achievable here:
//
//   - Parsing correctly means a real YAML 1.2 implementation (anchors, aliases,
//     tags, flow/block collections, the five scalar styles, folded/literal block
//     scalars with their indentation-indicator and chomping rules). Nothing
//     smaller is *correct*, and a correct parser is not enough by itself: a
//     round-trip also needs a comment- and style-preserving EMITTER, because
//     `parse` → `stringify` normalizes quoting, key order, indentation and drops
//     comments outright. That is a large dependency (this package deliberately
//     dropped Prism from `@lexical/code` for exactly this reason — see
//     `code-language.ts`) to buy a feature the editor does not need: it never
//     interprets frontmatter, it only has to preserve it.
//
//   - The naive middle ground — split each line on the first `:` into a
//     `Record<string, string>` — is what the reference implementation this was
//     modelled on does, and it is strictly WORSE than not parsing. Nested maps,
//     sequences, block scalars, quoted values containing `:`, comments and blank
//     lines are all silently flattened or destroyed. A lossy parse presented as
//     structured data is a data-loss bug wearing a feature's clothes.
//
// So the block is stored verbatim as a single `source` string and re-emitted
// between two fences. Consumers that *want* structure own that choice: hand
// `$getFrontmatter()` to whatever YAML library they already ship, or supply
// `render` to draw a preview. The editor stays honest about not understanding it.
//
// The one unavoidable deviation from byte-for-byte: `$convertFromMarkdownString`
// runs `normalizeMarkdown`, which `trimEnd()`s every line BEFORE any transformer
// is consulted, so trailing whitespace inside the block is lost. That happens
// upstream of every transformer and cannot be intercepted from one. YAML treats
// trailing spaces as insignificant, so nothing meaningful changes. Likewise a
// body that is empty or only blank lines normalizes to the canonical `---\n---`.
//
// ## The `---` collision with `hrPlugin`
//
// `hrPlugin`'s ELEMENT transformer matches `/^(---|\*\*\*|___)\s*$/`, so before
// this plugin existed a leading frontmatter block parsed as a horizontal rule
// followed by loose prose. Telling consumers to drop `hrPlugin` is not a fix:
// `---` is legitimately both things, and which one it is depends on POSITION and
// CLOSURE, not on which plugin is loaded.
//
// The resolution is structural, not ordering-based. `@lexical/markdown`'s
// importer tries EVERY multiline-element transformer on a line before ANY
// element transformer (`$importMultiline` runs first in `$importMarkdownNodes`;
// export mirrors it with `[...multilineElement, ...element]`). This is therefore
// a `multiline-element` transformer, which means it is consulted ahead of the
// `hr` element transformer no matter where the two plugins sit in the array —
// plugin ORDER cannot change the outcome, and neither can loading or omitting
// `hrPlugin`.
//
// Claiming the line is then narrowed by `handleImportAfterStartMatch`, which
// returns `null` — "not mine, try the next transformer" — unless BOTH hold:
//
//   1. the fence is on line 0 (frontmatter is only frontmatter at the very top
//      of the document), and
//   2. a closing `---` line exists somewhere below it.
//
// Declining falls through to `hrPlugin` (when loaded), so a `---` that is
// genuinely a thematic break — mid-document, or an unclosed one on line 1 —
// still becomes an `<hr>`. `replace` returns `false` so that TYPING `---` in the
// editor is likewise left to the hr shortcut; frontmatter is only ever created
// by importing markdown or by calling `$setFrontmatter`.
//
// The block closes at the FIRST subsequent line that is exactly `---`, which is
// the rule Jekyll / gray-matter / Hugo apply. A `---` *inside* a value (e.g.
// `title: a --- b`) is not a whole line and is preserved untouched.

import { $getRoot, type LexicalEditor, type LexicalNode } from 'lexical'
import type { MultilineElementTransformer } from '@lexical/markdown'
import {
  $createLLuiDecoratorNode,
  $isLLuiDecoratorNode,
  LLuiDecoratorNode,
  decoratorBridge,
} from '@llui/lexical'
import { div, textarea, type Mountable, type Signal } from '@llui/dom'
import type { MarkdownPlugin } from './types.js'
import { renderedPreview, type PreviewRender } from './_preview.js'

/** The decorator bridge id for the frontmatter block. */
export const FRONTMATTER_BRIDGE_TYPE = 'frontmatter'

/** The frontmatter node's payload: the block body, verbatim, with no fences. */
export interface FrontmatterData {
  /** The raw text between the opening and closing `---`. Never interpreted. */
  source: string
}

function isFrontmatterData(value: unknown): value is FrontmatterData {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as FrontmatterData).source === 'string'
  )
}

/** A line consisting solely of `---` (trailing tabs/spaces tolerated — they are
 * not content, and `normalizeMarkdown` has usually already trimmed them). */
const FENCE = /^---[ \t]*$/

/** Render the fences back around an opaque body. An empty (or blank-only) body
 * collapses to the canonical two-line form so the result stays idempotent. */
export function serializeFrontmatter(source: string): string {
  return source === '' ? '---\n---' : `---\n${source}\n---`
}

/**
 * The index of the closing fence, or `-1` when `lines` does not open a
 * frontmatter block (no fence on line 0) or never closes one.
 *
 * The single definition of "is this frontmatter?", shared by the importer and
 * {@link splitFrontmatter} so the two can never disagree. A returned index is
 * always `>= 1`, which is the property the importer's anti-rewind invariant
 * rests on (see `handleImportAfterStartMatch`).
 */
function closingFenceIndex(lines: readonly string[]): number {
  const first = lines[0]
  if (first === undefined || !FENCE.test(first)) return -1
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line !== undefined && FENCE.test(line)) return i
  }
  return -1
}

/**
 * Split a leading frontmatter block off a markdown string: `[body, rest]`, or
 * `null` when the document has none (no line-0 fence, or no closing fence).
 * Exported because a consumer often needs the metadata BEFORE building an
 * editor — the same predicate the importer uses, so the two never disagree.
 */
export function splitFrontmatter(markdown: string): [source: string, rest: string] | null {
  const lines = markdown.split('\n')
  const end = closingFenceIndex(lines)
  if (end === -1) return null
  return [lines.slice(1, end).join('\n'), lines.slice(end + 1).join('\n')]
}

// ── Document accessors (run inside `editor.read` / `editor.update`) ──────────

/** The frontmatter node, if the document starts with one. */
function $frontmatterNode(): LexicalNode | null {
  const first = $getRoot().getFirstChild()
  return $isLLuiDecoratorNode(first) && first.getBridgeType() === FRONTMATTER_BRIDGE_TYPE
    ? first
    : null
}

/** The document's frontmatter body, or `null` when it has none. */
export function $getFrontmatter(): string | null {
  const node = $frontmatterNode()
  if (!node || !$isLLuiDecoratorNode(node)) return null
  const data = node.getData()
  return isFrontmatterData(data) ? data.source : null
}

/**
 * Set (or, with `null`, remove) the document's frontmatter. The block is always
 * kept as the FIRST child of the root — it is only frontmatter there, and the
 * exporter relies on that position (see the transformer's `export`).
 */
export function $setFrontmatter(source: string | null): void {
  const existing = $frontmatterNode()
  if (source === null) {
    existing?.remove()
    return
  }
  if (existing && $isLLuiDecoratorNode(existing)) {
    existing.setData({ source })
    return
  }
  const node = $createLLuiDecoratorNode(FRONTMATTER_BRIDGE_TYPE, { source })
  const root = $getRoot()
  const first = root.getFirstChild()
  if (first) first.insertBefore(node)
  else root.append(node)
}

// ── Transformer ─────────────────────────────────────────────────────────────

const FRONTMATTER_TRANSFORMER: MultilineElementTransformer = {
  dependencies: [LLuiDecoratorNode],
  export: (node: LexicalNode): string | null => {
    if (!$isLLuiDecoratorNode(node) || node.getBridgeType() !== FRONTMATTER_BRIDGE_TYPE) return null
    const data = node.getData()
    if (!isFrontmatterData(data)) return null
    // Only the document's FIRST block can be emitted as fences: `---` anywhere
    // else re-imports as a thematic break, which would silently destroy the
    // metadata on the next round-trip. A stray block (dragged out of position,
    // pasted into a quote, …) degrades to a visible ```yaml code fence instead —
    // lossy in node type, but the text survives and the author can see why.
    if ($getRoot().getFirstChild() !== node) return '```yaml\n' + data.source + '\n```'
    return serializeFrontmatter(data.source)
  },
  regExpStart: FENCE,
  // Never consulted: `handleImportAfterStartMatch` below always returns a
  // decision, so the default open/close scan is not reached. Declared because
  // the shape requires the pair to be meaningful together.
  regExpEnd: FENCE,
  handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex }) => {
    // Frontmatter exists only at the very top of the document. Anywhere else a
    // `---` is a thematic break — decline so `hrPlugin` (or plain prose) gets it.
    //
    // INVARIANT — do not relax this guard without also fixing the scan below.
    // `$importMarkdownNodes` assigns `i = shiftedIndex` from the returned tuple,
    // so a returned index <= `startLineIndex` REWINDS its loop and the importer
    // spins forever (not a wrong parse — a hang). The scan starts at line 1, so
    // pinning `startLineIndex` to 0 is what makes every returned index strictly
    // greater. A positional relaxation must start the scan at `startLineIndex + 1`.
    if (startLineIndex !== 0) return null
    const end = closingFenceIndex(lines)
    if (end !== -1) {
      // Verbatim body: no trimming, no interpretation, blank lines preserved.
      const source = lines.slice(1, end).join('\n')
      rootNode.append($createLLuiDecoratorNode(FRONTMATTER_BRIDGE_TYPE, { source }))
      return [true, end]
    }
    // Unclosed: this is a lone `---` on line 1, i.e. a horizontal rule.
    return null
  },
  // Typing `---` must never produce frontmatter — returning false hands the
  // markdown shortcut back to `hrPlugin`. Use `$setFrontmatter` to create one.
  replace: () => false,
  type: 'multiline-element',
}

export { FRONTMATTER_TRANSFORMER }

// ── Plugin ──────────────────────────────────────────────────────────────────

export interface FrontmatterPluginOptions {
  /** Render the raw block to a preview (e.g. parse with your own YAML library
   * and draw a table). Return a DOM `Node` (mounted directly) or a **trusted**
   * HTML string — see `renderedPreview`'s security note. */
  render?: PreviewRender
  /** Accessible label for the raw-source editor (default `'Frontmatter'`). */
  label?: string
  /** Placeholder shown for an empty block (default `'key: value'`). */
  placeholder?: string
  /** Show the raw source editor. Set false for a `render`-only presentation
   * (the block still round-trips; it just isn't editable in place). Default true. */
  editable?: boolean
}

/** Keep editor-level key/paste handling out of the frontmatter island. */
const stop = (e: Event): void => e.stopPropagation()

export function frontmatterPlugin(opts: FrontmatterPluginOptions = {}): MarkdownPlugin {
  const editable = opts.editable ?? true

  const bridge = decoratorBridge<FrontmatterData>(FRONTMATTER_BRIDGE_TYPE, (data, api) => {
    const children: Mountable[] = []
    if (editable) {
      children.push(
        // A <textarea>, NOT a contenteditable div: newlines are load-bearing in
        // YAML, and a contenteditable's `textContent` drops the <br>/<div> line
        // structure the browser inserts, so committing from one silently
        // flattens a multi-line block into a single line.
        textarea({
          'data-scope': 'md-frontmatter',
          'data-part': 'source',
          'aria-label': opts.label ?? 'Frontmatter',
          placeholder: opts.placeholder ?? 'key: value',
          spellcheck: 'false',
          autocapitalize: 'off',
          autocomplete: 'off',
          value: data.at('source') as Signal<string>,
          // Grow with the content so the whole block stays visible.
          rows: (data.at('source') as Signal<string>).map((source) =>
            String(Math.max(1, source.split('\n').length)),
          ),
          onKeyDown: stop,
          onBeforeInput: stop,
          onPaste: stop,
          // Commit on blur only: while the caret is inside, the node data is
          // deliberately stale so the reactive `value` binding cannot rewrite
          // what is being typed.
          onBlur: (e: FocusEvent) => {
            const source = (e.target as HTMLTextAreaElement).value
            if (source !== data.peek().source) api.update({ source })
          },
        }),
      )
    }
    if (opts.render) {
      children.push(renderedPreview(data.at('source') as Signal<string>, opts.render))
    }
    return [
      div(
        { 'data-scope': 'md-frontmatter', 'data-part': 'root', contenteditable: 'false' },
        children,
      ),
    ]
  })

  return {
    name: 'frontmatter',
    nodes: [LLuiDecoratorNode],
    decorators: [bridge],
    transformers: [FRONTMATTER_TRANSFORMER],
    items: [
      {
        id: 'frontmatter',
        label: 'Frontmatter',
        icon: 'frontmatter',
        group: 'insert',
        keywords: ['frontmatter', 'yaml', 'metadata', 'front matter'],
        // Idempotent: a document already carrying frontmatter is left alone
        // rather than having its metadata blanked.
        run: (editor: LexicalEditor) =>
          editor.update(() => {
            if ($getFrontmatter() === null) $setFrontmatter('')
          }),
        surfaces: ['slash', 'context'],
      },
    ],
  }
}
