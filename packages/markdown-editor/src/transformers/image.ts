// The image transformer — markdown `![alt](src "title")` ⇄ an `image` decorator node.
//
// ## Why this does not hand-roll the destination regex
//
// The obvious spelling — `/^!\[([^\]]*)\]\(([^)]+)\)$/` — is wrong on ordinary
// documents, and wrong SILENTLY, because the export re-emits whatever it
// captured and a round-trip test stays green while the `<img>` never loads:
//
//   ![a](img.png "Title")          → src `img.png "Title"`   (title swallowed)
//   ![a](<my file.png>)            → src `<my file.png>`     (brackets kept)
//   ![a](attachments/img(1).png)   → no match: stays as text (a screenshot named
//                                    `img (1).png` is not exotic)
//   ![a](x.png)··                  → no match: a trailing hard-break kills it
//
// Rather than grow a second, better regex, this parses the candidate line with
// the CommonMark parser the package ALREADY depends on (`@llui/markdown`, a peer
// dependency, whose `/commonmark` entry keeps GFM out of the bundle) and reads
// `url`/`title`/`alt` off the mdast `image` node. The editor's understanding of
// an image is then identical to the read-only renderer's by construction, not by
// two implementations agreeing today.
//
// The same reasoning already produced `transformers/code.ts` (upstream's fenced
// code transformer captures the info string as one `[\w-]+` token and pushes the
// rest into the code body). Two forks is a pattern: the strategic fix is an
// mdast-driven importer for the whole transformer set, not a third fork.
//
// ## Declining is not the same as dropping
//
// `regExp` matches LOOSELY (any `![…](…)` line) and the exact parse decides. A
// line that is not EXACTLY one image — an inline image mid-sentence, two images,
// a linked image — is declined with `false` so it falls through to the next
// transformer and survives as text.
//
// Declining has to put the line's text BACK: `$importBlocks` truncates the text
// node by `match[0].length` BEFORE calling `replace`, so a `false` return after a
// full-line match would leave an empty paragraph — which is exactly how an image
// with a disallowed scheme used to be silently DELETED from a document on import
// (`![x](javascript:boom)` in, nothing out). {@link declineImport} restores it.

import { $createLLuiDecoratorNode, $isLLuiDecoratorNode, LLuiDecoratorNode } from '@llui/lexical'
import type { ElementTransformer } from '@lexical/markdown'
import { $isTextNode, type ElementNode, type LexicalNode } from 'lexical'
import { parseMarkdown } from '@llui/markdown/commonmark'
import { sanitizeImageUrl } from '../security.js'

/** The decorator bridge id an image node renders through. Exported because it is
 * the address a consumer needs to REPLACE the image rendering wholesale: a plugin
 * listed after `imagePlugin()` contributing a bridge of this type wins (bridges
 * are registered per editor, last registration first). Reach for that only when
 * the rendering itself must change — mapping the URL is what
 * `ImagePluginOptions.resolveSrc` is for. */
export const IMAGE_BRIDGE_TYPE = 'image'

/** An image node's serialized data — exactly the three CommonMark fields, so the
 * markdown is the source of truth and the node holds nothing derived. `src` is
 * stored VERBATIM (a document-relative path stays document-relative); mapping it
 * to a loadable URL is a render-time concern. */
export interface ImageData {
  src: string
  alt: string
  title?: string
}

export function isImageData(value: unknown): value is ImageData {
  if (typeof value !== 'object' || value === null) return false
  const data = value as ImageData
  return (
    typeof data.src === 'string' &&
    typeof data.alt === 'string' &&
    (data.title === undefined || typeof data.title === 'string')
  )
}

/**
 * Parse a single line as CommonMark and return its image, or `null` when the
 * line is not EXACTLY one image (inline image, two images, a linked image, an
 * image in a list item or blockquote, plain text).
 *
 * `src` keeps whatever the document spelled — percent-encoding included; only
 * CommonMark's own escapes and character references are resolved, because those
 * are markdown syntax rather than part of the URL.
 */
export function parseImageLine(line: string): ImageData | null {
  if (!line.includes('![')) return null // cheap bail before touching the parser
  const root = parseMarkdown(line)
  if (root.children.length !== 1) return null
  const block = root.children[0]
  if (block === undefined || block.type !== 'paragraph' || block.children.length !== 1) return null
  const node = block.children[0]
  if (node === undefined || node.type !== 'image') return null
  const title = node.title ?? ''
  return {
    src: node.url,
    alt: node.alt ?? '',
    ...(title === '' ? {} : { title }),
  }
}

/** A `&` that would start a character reference (`&amp;`, `&#39;`, `&#x2F;`) and
 * therefore has to be escaped to survive a re-parse. A bare `&` — the common case
 * in a query string — is left alone so URLs stay readable. The name bound is
 * deliberately generous (the longest HTML5 entity name is 31 characters): over-
 * escaping still round-trips exactly, under-escaping does not. */
const ENTITY_START = /&(?=[a-zA-Z][a-zA-Z0-9]{0,48};|#\d{1,7};|#[xX][0-9a-fA-F]{1,6};)/g

const escapeEntities = (value: string): string => value.replace(ENTITY_START, '\\&')

/** Percent-encode the characters a markdown line cannot carry literally. Scanned
 * rather than matched with a regex: a control-character class is exactly what
 * `no-control-regex` exists to catch, and a range test states the intent more
 * plainly than an escaped class would. */
function encodeControls(value: string): string {
  let out = ''
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    out +=
      code < 0x20 || code === 0x7f ? `%${code.toString(16).toUpperCase().padStart(2, '0')}` : ch
  }
  return out
}

/** CommonMark allows unescaped parentheses in a bare destination only when they
 * are balanced; an unbalanced one forces the `<…>` form. */
function parensBalanced(value: string): boolean {
  let depth = 0
  for (const ch of value) {
    if (ch === '(') depth++
    else if (ch === ')' && --depth < 0) return false
  }
  return depth === 0
}

/** Spell a destination so that parsing it back yields the same string: bare when
 * it can be, `<…>` when it carries whitespace, a backslash, an angle bracket, an
 * unbalanced paren, or nothing at all. */
function encodeDestination(src: string): string {
  const value = encodeControls(src)
  const bare = value !== '' && !/[\s\\<>]/.test(value) && parensBalanced(value)
  return bare
    ? escapeEntities(value)
    : `<${escapeEntities(value.replace(/[\\<>]/g, (c) => `\\${c}`))}>`
}

/** Escape the alt text so its punctuation stays literal text rather than turning
 * into emphasis, a code span, a link label or an entity on the way back in. */
function encodeAlt(alt: string): string {
  const oneLine = alt.replace(/[\r\n]+/g, ' ')
  return escapeEntities(oneLine.replace(/[\\[\]*_`<]/g, (c) => `\\${c}`))
}

function encodeTitle(title: string): string {
  const oneLine = title.replace(/[\r\n]+/g, ' ')
  return escapeEntities(oneLine.replace(/[\\"]/g, (c) => `\\${c}`))
}

/**
 * Render {@link ImageData} back to a markdown line — the exact inverse of
 * {@link parseImageLine} for every value the parser can produce (and for
 * hand-built node data too: control characters are percent-encoded rather than
 * emitted into a line they would break).
 */
export function formatImageLine(data: ImageData): string {
  const title = data.title === undefined || data.title === '' ? '' : ` "${encodeTitle(data.title)}"`
  return `![${encodeAlt(data.alt)}](${encodeDestination(data.src)}${title})`
}

/** Any `![…](…)` line, with the trailing whitespace a markdown file may carry
 * (a hard break, or an editor that does not trim). Deliberately loose — the
 * CommonMark parse in `replace` is what actually decides. */
const IMAGE_LINE = /^!\[[^\n]*\]\([^\n]*\)[ \t]*$/

/**
 * Decline the match, restoring the text `$importBlocks` truncated before calling
 * us (see the module header). No-op on the typing path, where `children` are the
 * caret's following siblings rather than the line's text node and Lexical already
 * leaves everything untouched when `replace` returns `false`.
 */
function declineImport(children: LexicalNode[], match: string[], isImport: boolean): false {
  if (!isImport) return false
  const node = children[0]
  const consumed = match[0] ?? ''
  if (node !== undefined && $isTextNode(node)) {
    node.setTextContent(consumed + node.getTextContent())
  }
  return false
}

/** `![alt](src "title")` ⇄ an `image` decorator node. Contributed by
 * `imagePlugin()`; exported for consumers assembling a transformer set by hand. */
export const IMAGE_TRANSFORMER: ElementTransformer = {
  dependencies: [LLuiDecoratorNode],
  export: (node: LexicalNode): string | null => {
    if (!$isLLuiDecoratorNode(node) || node.getBridgeType() !== IMAGE_BRIDGE_TYPE) return null
    const data = node.getData()
    return isImageData(data) ? formatImageLine(data) : null
  },
  regExp: IMAGE_LINE,
  replace: (
    parentNode: ElementNode,
    children: LexicalNode[],
    match: string[],
    isImport: boolean,
  ): boolean | void => {
    const data = parseImageLine(match[0] ?? '')
    if (data === null) return declineImport(children, match, isImport)
    // Enforce the image-src allowlist at every ingress: a disallowed scheme
    // (`javascript:`) is refused rather than materialized into a node — and the
    // line survives as text, so a document opened and saved back loses nothing.
    const src = sanitizeImageUrl(data.src)
    if (src === null) return declineImport(children, match, isImport)
    parentNode.replace($createLLuiDecoratorNode(IMAGE_BRIDGE_TYPE, { ...data, src }))
  },
  type: 'element',
}
