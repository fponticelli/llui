// The fenced-code-block transformer.
//
// ## Why this package does not use `@lexical/markdown`'s `CODE`
//
// Upstream's `CODE_START_REGEX` captures the info string with `([\w-]+)?`, i.e.
// a SINGLE word-ish token. Everything after that token stays on the line and is
// pushed into the code block's CONTENT:
//
//   ```lance table      →  language 'lance',  body 'table\nsum(x)'   (corrupt)
//   ```c++              →  language 'c',      body '++\nint main()'  (corrupt)
//
// That is silent data loss on perfectly ordinary markdown. CommonMark defines
// the info string as *the rest of the line*, trimmed — so
// {@link CODE_INFO_TRANSFORMER} captures exactly that and hands it to
// `CodeNode.setLanguage` untouched.
//
// This lives in `transformers/` (not in `plugins/code-language.ts`) so that it
// is the DEFAULT in `GFM_TRANSFORMERS` rather than an opt-in a consumer has to
// remember to order ahead of `corePlugin()`. `codeLanguagePlugin()` contributes
// this same object reference, so the registry's reference de-duplication
// collapses the two contributions into one and plugin order cannot change the
// parse. See `test/composition.test.ts`.
//
// ## The language is an opaque label
//
// The package depends on `@lexical/code-core`, not `@lexical/code`, to keep
// Prism out of the bundle. Nothing interprets the info string — it is stored,
// shown, edited, and re-emitted verbatim. That opacity is precisely what lets an
// arbitrary token like `lance table` survive a round-trip.

import { $createTextNode, type ElementNode, type LexicalNode } from 'lexical'
import { $createCodeNode, $isCodeNode, CodeNode } from '@lexical/code-core'
import type { MultilineElementTransformer } from '@lexical/markdown'

/**
 * Canonicalize a fence info string.
 *
 * CommonMark's info string is the remainder of the opening-fence line with the
 * surrounding whitespace stripped; a blank one means "no language". Two
 * characters are removed rather than preserved, because keeping them would emit
 * markdown that no longer re-imports to the same block:
 *
 * - a backtick — illegal in a backtick-fenced info string (it would terminate
 *   or corrupt the fence);
 * - a newline — it would end the fence line entirely.
 *
 * Everything else survives verbatim, including spaces (`'lance table'`) and
 * punctuation (`'c++'`, `'objective-c'`).
 */
export function normalizeCodeInfo(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  const cleaned = raw
    .replace(/`/g, '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
  return cleaned === '' ? null : cleaned
}

/** The opening fence: its backtick run, then the raw info string (rest of line). */
const FENCE_START = /^([ \t]*`{3,})(.*)$/
/** A closing fence of at least `length` backticks on a line of its own. */
const fenceEndFor = (length: number): RegExp => new RegExp(`^[ \\t]*\`{${length},}[ \\t]*$`)

/**
 * The narrowest fence that can enclose `code` without being terminated early:
 * one backtick longer than the longest fence-like run inside it.
 */
function fenceFor(code: string): string {
  const runs = code.match(/`{3,}/g)
  const longest = runs ? Math.max(...runs.map((run) => run.length)) : 0
  return '`'.repeat(Math.max(3, longest + 1))
}

/**
 * A self-closing opening fence (```` ```code``` ````): the closing run sits on
 * the SAME line, so the span between the fences is CONTENT and there is no info
 * string. Returns that content, or `null` when the line is an ordinary opening
 * fence.
 *
 * Shared by BOTH directions on purpose. It used to live only in
 * `handleImportAfterStartMatch`, so the import path and the typed-shortcut
 * `replace` path parsed the same text two different ways: importing
 * '```inline```' gave a language-less block containing `inline`, while TYPING it
 * and pressing Enter gave an EMPTY block labelled 'inline' — the word was gone.
 * The divergence was reachable because `FENCE_START`'s `(.*)$` consumes the
 * whole line, which always satisfies the shortcut engine's `match[0].length ===
 * matchLength` gate. (Upstream's narrower `CODE_START_REGEX` never matched this
 * shape, so widening the capture is what introduced it.)
 */
function singleLineFenceContent(fence: string, rest: string): string | null {
  const closing = rest.match(new RegExp(`\`{${fence.length},}[ \t]*$`))
  return closing && closing.index !== undefined ? rest.slice(0, closing.index) : null
}

/** Append a code block carrying `language` and `lines` to `parent`. */
function $appendCodeNode(
  parent: ElementNode,
  language: string | null,
  lines: readonly string[],
): void {
  const node = $createCodeNode(language ?? undefined)
  const code = lines.join('\n')
  if (code !== '') node.append($createTextNode(code))
  parent.append(node)
}

/**
 * A drop-in replacement for `@lexical/markdown`'s `CODE` that treats the whole
 * remainder of the opening-fence line as the info string (CommonMark's rule)
 * instead of a single `[\w-]+` token.
 */
export const CODE_INFO_TRANSFORMER: MultilineElementTransformer = {
  dependencies: [CodeNode],
  export: (node: LexicalNode): string | null => {
    if (!$isCodeNode(node)) return null
    const code = node.getTextContent()
    const fence = fenceFor(code)
    const info = normalizeCodeInfo(node.getLanguage()) ?? ''
    return fence + info + (code === '' ? '' : '\n' + code) + '\n' + fence
  },
  handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex, startMatch }) => {
    const fence = (startMatch[1] ?? '```').trim()
    const rest = startMatch[2] ?? ''

    // Single-line form (```code```) — see `singleLineFenceContent`. Matches
    // `@lexical/markdown`, and matches CommonMark, which forbids a backtick
    // inside the info string.
    const inline = singleLineFenceContent(fence, rest)
    if (inline !== null) {
      $appendCodeNode(rootNode, null, [inline])
      return [true, startLineIndex]
    }

    const language = normalizeCodeInfo(rest)
    const fenceEnd = fenceEndFor(fence.length)
    for (let i = startLineIndex + 1; i < lines.length; i++) {
      if (fenceEnd.test(lines[i] as string)) {
        $appendCodeNode(rootNode, language, lines.slice(startLineIndex + 1, i))
        return [true, i]
      }
    }
    // Unterminated fence: consume to the end of the document.
    $appendCodeNode(rootNode, language, lines.slice(startLineIndex + 1))
    return [true, lines.length - 1]
  },
  regExpEnd: { optional: true, regExp: /^[ \t]*`{3,}[ \t]*$/ },
  regExpStart: FENCE_START,
  // Import is fully handled above; `replace` serves the typed-shortcut path
  // (`registerMarkdownShortcuts` calls it with the trailing siblings) and the
  // paste path (`children === null`, lines supplied).
  replace: (rootNode, children, startMatch, _endMatch, linesInBetween, isImport) => {
    const fence = (startMatch[1] ?? '```').trim()
    const rest = startMatch[2] ?? ''
    // The SAME single-line rule the import path applies, so the two agree.
    const inline = singleLineFenceContent(fence, rest)
    if (inline !== null) {
      const node = $createCodeNode()
      if (inline !== '') node.append($createTextNode(inline))
      rootNode.replace(node)
      if (!isImport) node.select(0, 0)
      return
    }
    const language = normalizeCodeInfo(rest)
    if (!children) {
      $appendCodeNode(rootNode, language, linesInBetween ?? [])
      return
    }
    const node = $createCodeNode(language ?? undefined)
    node.append(...children)
    rootNode.replace(node)
    if (!isImport) node.select(0, 0)
  },
  type: 'multiline-element',
}
