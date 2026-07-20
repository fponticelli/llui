// Wikilink plugin — `[[target]]` / `[[target|alias]]` inline references.
//
// The ALIAS is what the reader sees; the TARGET is what the link points at.
// Semantics are lifted from lance's markdown-it inline rule: a wikilink opens
// with `[[`, closes at the FIRST `]]`, splits on the FIRST `|`, and is rejected
// when the inner content is empty or contains a nested `[[`.
//
// ── Why a custom TextNode and NOT `@lexical/link` ────────────────────────────
//
// Reusing the link infrastructure looks tempting (a wikilink IS a link) but is
// wrong here on four counts:
//
//   1. A `LinkNode` is an ELEMENT node: the display text lives in its children,
//      the destination in `getURL()`. A wikilink's target is not a URL — it is
//      a document name resolved by the host. Storing it in `url` means every
//      wikilink flows through this package's link-security layer
//      (`sanitizeLinkUrl` + the global `registerLinkSanitizer` node transform,
//      see `../security.ts`), which exists precisely to rewrite/unwrap hrefs it
//      does not recognize. A wikilink would have to be carved out of the one
//      enforcement point the editor relies on — a security seam we refuse to cut.
//   2. Because the display text is a child text node, editing it desyncs the
//      alias from the target silently: type inside `[[Page|alias]]` and you get
//      a link whose text no longer matches anything the exporter can round-trip.
//      A `TextNode` subclass in `token` mode is ATOMIC — it is selected, moved
//      and deleted as one unit, so target/alias can never drift.
//   3. `$toggleLink`, the link dialog, the floating link toolbar and autolink
//      would all treat a wikilink as an ordinary hyperlink and happily rewrite it.
//   4. Both directions of the markdown conversion then live in ONE text-match
//      transformer over ONE node type, instead of being split across the LINK
//      transformer with a sentinel-scheme escape hatch.
//
// A `DecoratorNode` (the `LLuiDecoratorNode` bridge used by math/mermaid) was
// the other candidate and is also wrong: a decorator is an opaque, non-editable
// island. A wikilink is inline prose — the caret must move through and around
// it naturally, and it must inherit the surrounding text format. `TextNode` is
// the node kind that gives that for free.
//
// ── Transformer ordering ─────────────────────────────────────────────────────
//
// `transformers/registry.ts` ranks by type (text-match last) and, within a rank,
// by plugin array order. `@lexical/markdown` resolves competing text-match
// transformers with `findOutermostTextMatchTransformer`, which prefers the
// EARLIEST/outermost match and falls back to array order on a tie.
//
//   * Typing (`registerMarkdownShortcuts`) indexes transformers by their single
//     `trigger` character. Ours is `]`, LINK's is `)`, so they can never collide.
//   * On IMPORT, LINK's `importRegExp` requires a `](`, which `[[a]]` and
//     `[[a|b]]` never contain — plain wikilinks are safe at any position.
//   * The ambiguity is a wikilink on a line that also contains a `](` — either
//     immediately (`[[a|b]](c)`) or LATER on the same line
//     (`**[[A]]** and [b](url)`). LINK's import pattern has a LAZY label
//     (`\[(.+?)\]\(…\)`), so it can match starting at the WIKILINK's own `[` and
//     span across to that later `](`. Both rules then match at the same start
//     index, and a tie is broken by array order.
//
//     That made fidelity depend on plugin order, and the failure was silent: with
//     `wikilinkPlugin()` listed after `corePlugin()`, LINK swallowed the `**`
//     delimiters and re-exported them ESCAPED, losing the bold outright.
//
//     This is now resolved STRUCTURALLY, not by documentation: the transformer
//     declares `setTransformerPrecedence(WIKILINK_TRANSFORMER, -10)` (see the
//     bottom of this file), so the registry orders it ahead of LINK in EITHER
//     plugin order. `test/composition.test.ts` pins both orders. To get the
//     CommonMark reading of `[[a|b]](c)` instead, omit `wikilinkPlugin()`.

import {
  $applyNodeReplacement,
  $getNearestNodeFromDOMNode,
  $getSelection,
  $isRangeSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  KEY_ENTER_COMMAND,
  TextNode,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type SerializedTextNode,
  type Spread,
} from 'lexical'
import type { TextMatchTransformer } from '@lexical/markdown'
import { mergeRegister } from '@lexical/utils'
import { setTransformerPrecedence } from '../transformers/registry.js'
import { definePluginUI } from './ui.js'
import type { CommandItem, MarkdownPlugin } from './types.js'

const PLUGIN = 'wikilink'

/** A parsed wikilink. `alias` is `null` when the target is shown verbatim. */
export interface WikiLink {
  target: string
  alias: string | null
}

// ── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Matches `[[inner]]` where `inner` is non-empty and contains neither `[[` nor
 * `]]`. Encoding both rejections IN the pattern (rather than validating inside
 * `replace`) is what reproduces lance's scan-and-retry behaviour: markdown-it
 * returns `false` at a bad `[[` and re-attempts one character later, so
 * `[[a[[b]]` yields the INNER `[[b]]`. A regex that matched greedily at index 0
 * and then bailed in `replace` would swallow the valid inner link instead.
 */
const WIKILINK_RE_SOURCE = String.raw`\[\[((?:(?!\[\[|\]\])[\s\S])+)\]\]`

const WIKILINK_IMPORT_RE = new RegExp(WIKILINK_RE_SOURCE)
/** Same pattern anchored at the caret, for the live typing shortcut. */
const WIKILINK_TYPING_RE = new RegExp(`${WIKILINK_RE_SOURCE}$`)

/**
 * Parse the content BETWEEN the brackets. Returns `null` when the content is not
 * a valid wikilink body.
 *
 * Deliberate choices, each load-bearing for exact round-tripping:
 *   * split on the FIRST `|` only, so `[[a|b|c]]` has alias `b|c` and re-exports
 *     byte-identically;
 *   * an EMPTY alias (`[[a|]]`) normalizes to no alias — the alternative
 *     (keeping `alias: ''`) would render a zero-width, unclickable node;
 *   * NO trimming. `[[ a ]]` keeps its spaces, because trimming would make
 *     import→export lossy. Presentation trimming is the host's call in
 *     `onNavigate`/`resolve`, not the document's.
 */
export function parseWikiLinkInner(inner: string): WikiLink | null {
  if (inner.length === 0 || inner.includes('[[')) return null
  const pipe = inner.indexOf('|')
  const target = pipe >= 0 ? inner.slice(0, pipe) : inner
  // A blank target is as unusable as an empty one: `[[ ]]` would build a
  // token-mode node whose only glyph is a space — invisible, unclickable and
  // (being a token) uneditable except by deleting it wholesale. Same rejection
  // the empty case gets. Note this is a BLANK check, not a trim: a target that
  // has any non-space content keeps its spaces verbatim, so `[[ a ]]` still
  // round-trips byte-identically.
  if (target.trim().length === 0) return null
  const rawAlias = pipe >= 0 ? inner.slice(pipe + 1) : null
  return { target, alias: rawAlias !== null && rawAlias.trim().length > 0 ? rawAlias : null }
}

/**
 * Constrain a target/alias to the values the `[[…]]` syntax can actually
 * express, so that {@link formatWikiLink} is INJECTIVE.
 *
 * Without this, `formatWikiLink` is not the inverse it claims to be: a target
 * of `a|b` emits `[[a|b]]`, which reads back as target `a` with alias `b` — the
 * link silently repoints itself and its visible text changes on the next load.
 * A target of `a]]b` emits `[[a]]b]]`, which reads back as a wikilink to `a`
 * followed by the literal text `b]]`.
 *
 * ── Why sanitize rather than introduce an escape dialect ─────────────────────
 *
 * Backslash-escaping `|`/`[`/`]` would make every value representable, but it
 * forks the syntax away from the markdown-it/Obsidian rule this plugin exists
 * to match: `[[a\|b]]` is not a wikilink to `a|b` anywhere else in the
 * ecosystem, it is a wikilink to the literal `a\` with alias `b`. Emitting it
 * would corrupt the document for every OTHER reader of the same file, which is
 * strictly worse than declining to represent a target no wikilink dialect can
 * express. Documents are shared; our in-memory model is not.
 *
 * So the unrepresentable characters are removed at the point a link is BUILT
 * (`$createWikiLinkNode`, `setTarget`, `setAlias`, the insert command) — every
 * route by which a value can enter the document. Everything downstream may then
 * assume `parse(format(link)) === link`.
 */
function sanitizePart(raw: string, stripPipe: boolean): string {
  let out = raw
    // Markdown is line-oriented: a newline inside `[[…]]` cannot survive an
    // export/import cycle at all (neither half of the split matches).
    .replace(/\s+/g, ' ')
    // `[[` would open a nested link (which the import rule rejects outright);
    // `]]` would close this one early and spill the remainder as literal text.
    .replace(/\[\[+/g, '[')
    .replace(/\]\]+/g, ']')
  if (stripPipe) out = out.replace(/\|/g, '')
  return out
}

/** Sanitize a target. Returns `null` when nothing usable survives. */
export function sanitizeWikiLinkTarget(raw: string): string | null {
  const out = sanitizePart(raw, true)
  return out.trim().length > 0 ? out : null
}

/** Sanitize an alias. Returns `null` when nothing usable survives. */
export function sanitizeWikiLinkAlias(raw: string | null): string | null {
  if (raw === null) return null
  // A pipe is legal in an alias: the parser splits on the FIRST pipe only, so
  // `[[a|b|c]]` unambiguously means alias `b|c` and re-exports byte-identically.
  const out = sanitizePart(raw, false)
  return out.trim().length > 0 ? out : null
}

/**
 * Serialize a wikilink back to markdown. Inverse of {@link parseWikiLinkInner}
 * for every link built through this module's constructors — see
 * {@link sanitizeWikiLinkTarget} for why that qualifier is load-bearing.
 */
export function formatWikiLink(link: WikiLink): string {
  return link.alias === null ? `[[${link.target}]]` : `[[${link.target}|${link.alias}]]`
}

/** The text a wikilink displays: the alias when present, else the target. */
function displayText(link: WikiLink): string {
  return link.alias ?? link.target
}

/**
 * What a screen reader announces. An aliased link must name BOTH halves: the
 * visible text is the alias, so the destination is otherwise unhearable.
 */
function ariaLabel(link: WikiLink): string {
  return link.alias === null
    ? `${link.target}, wiki link`
    : `${link.alias}, wiki link to ${link.target}`
}

// ── Node ─────────────────────────────────────────────────────────────────────

export type SerializedWikiLinkNode = Spread<
  { target: string; alias: string | null },
  SerializedTextNode
>

/**
 * An atomic inline wikilink. Extends `TextNode` so the caret, selection and
 * text formats behave exactly as they do for prose, while `token` mode keeps it
 * indivisible: the user can delete it or move past it, but never edit its
 * interior into a state where the visible alias disagrees with `__target`.
 */
export class WikiLinkNode extends TextNode {
  __target: string
  __alias: string | null

  static getType(): string {
    return 'wikilink'
  }

  static clone(node: WikiLinkNode): WikiLinkNode {
    return new WikiLinkNode(node.__target, node.__alias, node.__text, node.__key)
  }

  constructor(target: string, alias: string | null, text?: string, key?: NodeKey) {
    super(text ?? displayText({ target, alias }), key)
    this.__target = target
    this.__alias = alias
  }

  static importJSON(serializedNode: SerializedWikiLinkNode): WikiLinkNode {
    return $createWikiLinkNode(serializedNode.target, serializedNode.alias).updateFromJSON(
      serializedNode,
    )
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedWikiLinkNode>): this {
    const self = super.updateFromJSON(serializedNode)
    const writable = self.getWritable()
    writable.__target = serializedNode.target
    writable.__alias = serializedNode.alias
    return writable
  }

  exportJSON(): SerializedWikiLinkNode {
    return { ...super.exportJSON(), alias: this.getAlias(), target: this.getTarget() }
  }

  createDOM(config: EditorConfig, editor?: LexicalEditor): HTMLElement {
    const dom = super.createDOM(config, editor)
    // `data-scope` / `data-part` is this package's styling contract (see the
    // other plugins); `data-wikilink` additionally carries the target so a host
    // stylesheet can react to it and the click handler can find the element.
    dom.setAttribute('data-scope', 'md-wikilink')
    dom.setAttribute('data-part', 'link')
    dom.setAttribute('data-wikilink', this.__target)
    if (this.__alias !== null) dom.setAttribute('data-wikilink-alias', this.__alias)
    // Without a role, assistive tech reads a wikilink as ordinary prose, and an
    // aliased one gives no way to hear where it points.
    dom.setAttribute('role', 'link')
    dom.setAttribute('aria-label', ariaLabel(this.getLink()))
    return dom
  }

  updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
    const recreated = super.updateDOM(prevNode, dom, config)
    if (recreated) return true
    if (prevNode.__target !== this.__target) dom.setAttribute('data-wikilink', this.__target)
    if (prevNode.__alias !== this.__alias) {
      if (this.__alias === null) dom.removeAttribute('data-wikilink-alias')
      else dom.setAttribute('data-wikilink-alias', this.__alias)
    }
    if (prevNode.__target !== this.__target || prevNode.__alias !== this.__alias) {
      dom.setAttribute('aria-label', ariaLabel(this.getLink()))
    }
    return false
  }

  getTarget(): string {
    return this.getLatest().__target
  }

  /**
   * Repoint the link. The display text follows only when there is no alias.
   * The value is sanitized (see {@link sanitizeWikiLinkTarget}); a target with
   * nothing representable in it leaves the link untouched rather than producing
   * one that corrupts the document on export.
   */
  setTarget(target: string): this {
    const clean = sanitizeWikiLinkTarget(target)
    if (clean === null) return this.getWritable()
    const writable = this.getWritable()
    writable.__target = clean
    if (writable.__alias === null) writable.setTextContent(clean)
    return writable
  }

  getAlias(): string | null {
    return this.getLatest().__alias
  }

  /** Set (or clear, with `null`) the alias; the display text follows. */
  setAlias(alias: string | null): this {
    const normalized = sanitizeWikiLinkAlias(alias)
    const writable = this.getWritable()
    writable.__alias = normalized
    writable.setTextContent(displayText({ target: writable.__target, alias: normalized }))
    return writable
  }

  getLink(): WikiLink {
    const self = this.getLatest()
    return { target: self.__target, alias: self.__alias }
  }

  // An atomic token: typing against either edge must produce a sibling text
  // node, never extend the wikilink's text (which would desync it from target).
  canInsertTextBefore(): boolean {
    return false
  }

  canInsertTextAfter(): boolean {
    return false
  }
}

/**
 * Build a wikilink node. `target`/`alias` are sanitized to values the `[[…]]`
 * syntax can express (see {@link sanitizeWikiLinkTarget}); a target with nothing
 * usable left falls back to the literal text `Page` rather than yielding an
 * invisible token.
 */
export function $createWikiLinkNode(target: string, alias: string | null = null): WikiLinkNode {
  const cleanTarget = sanitizeWikiLinkTarget(target) ?? 'Page'
  return $applyNodeReplacement(
    new WikiLinkNode(cleanTarget, sanitizeWikiLinkAlias(alias)).setMode('token'),
  )
}

export function $isWikiLinkNode(node: LexicalNode | null | undefined): node is WikiLinkNode {
  return node instanceof WikiLinkNode
}

// ── Transformer ──────────────────────────────────────────────────────────────

const WIKILINK_TRANSFORMER: TextMatchTransformer = {
  dependencies: [WikiLinkNode],
  // The THIRD parameter is `exportFormat`, not the `selection` that
  // `ElementTransformer['export']` takes — see `TextMatchTransformer` in
  // @lexical/markdown's MarkdownTransformers.ts, and the call site in
  // MarkdownExport.ts `$exportChildren`, which supplies
  // `(textNode, textContent) => exportTextFormat(...)`.
  //
  // Ignoring it exports a bold wikilink as a bare one, and — worse — TEARS any
  // surrounding formatted run in two, because `$exportChildren` emits our
  // unformatted string in the middle of it: `a **b [[P]] c** d` came back as
  // `a **b** [[P]] **c** d`.
  export: (node, _exportChildren, exportFormat) => {
    if (!$isWikiLinkNode(node)) return null
    const markdown = formatWikiLink(node.getLink())
    // Only route through `exportFormat` when there IS a format to apply.
    // `exportTextFormat` backslash-escapes `*_\`~\\` in its input, which for an
    // unformatted link would rewrite targets containing those characters; the
    // raw string keeps the byte-exact round-trip the plugin guarantees.
    return node.getFormat() === 0 ? markdown : exportFormat(node, markdown)
  },
  importRegExp: WIKILINK_IMPORT_RE,
  regExp: WIKILINK_TYPING_RE,
  trigger: ']',
  replace: (textNode, match) => {
    const link = parseWikiLinkInner(match[1] ?? '')
    if (!link) return
    // `LexicalNode.replace()` does NOT carry `__format`/`__style` onto the
    // replacement (verified in lexical@0.48.0 LexicalNode.ts) and
    // `$createWikiLinkNode` builds a node with format 0, so without this the
    // node silently loses bold/italic/strikethrough/underline — falsifying this
    // module's own stated reason for subclassing TextNode ("it must inherit the
    // surrounding text format").
    const replacement = $createWikiLinkNode(link.target, link.alias)
    replacement.setFormat(textNode.getFormat())
    replacement.setStyle(textNode.getStyle())
    textNode.replace(replacement)
    // Returning nothing (rather than the new node) stops `importTextTransformers`
    // from recursing INTO the wikilink: an alias is literal text, so `[[a|**b**]]`
    // must display `**b**`, not bold `b`.
  },
  type: 'text-match',
}

// A wikilink must beat upstream's LINK when both match at the SAME index, in
// EITHER plugin order. LINK's import pattern is `\[(.+?)\]\(…\)` with a LAZY
// label, so on a line like `**[[A]]** and [b](url)` it matches starting at the
// wikilink's own `[`, spanning all the way to the later `](`. Tied start index →
// resolved by array order → listing `wikilinkPlugin()` after `corePlugin()`
// handed the span to LINK, which swallowed the `**` delimiters and re-exported
// them ESCAPED: the bold was silently lost.
//
// Declaring the precedence makes the wikilink reading structural rather than a
// documented ordering requirement a consumer can get wrong. The CommonMark
// reading of `[[a|b]](c)` is still reachable — omit `wikilinkPlugin()`.
setTransformerPrecedence(WIKILINK_TRANSFORMER, -10)

// ── Click → host notification ────────────────────────────────────────────────

interface WikiLinkState {
  /** The most recently activated link (JSON-serializable, replay-safe). */
  last: WikiLink | null
}

type WikiLinkMsg = { type: 'activate'; target: string; alias: string | null }

type WikiLinkEffect = { type: 'navigate'; link: WikiLink }

/** Resolve the wikilink a click landed on, if any. Must run in an editor scope. */
function $wikiLinkFromEvent(event: MouseEvent): WikiLinkNode | null {
  const target = event.target
  if (!(target instanceof Node)) return null
  const direct = $getNearestNodeFromDOMNode(target)
  if ($isWikiLinkNode(direct)) return direct
  // A click can land on the inner text node of a formatted wikilink; climb to
  // the nearest element carrying our marker attribute and map that back.
  const element = target instanceof Element ? target : target.parentElement
  const marked = element?.closest('[data-wikilink]')
  if (!marked) return null
  const node = $getNearestNodeFromDOMNode(marked)
  return $isWikiLinkNode(node) ? node : null
}

/**
 * The wikilink the caret is on or immediately beside, if any. Must run in an
 * editor scope. A token-mode node is selected as a whole, so the anchor lands
 * either ON it or on an adjacent sibling.
 */
function $selectedWikiLink(): WikiLinkNode | null {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return null
  const anchor = selection.anchor.getNode()
  if ($isWikiLinkNode(anchor)) return anchor
  for (const candidate of [anchor.getPreviousSibling(), anchor.getNextSibling()]) {
    if ($isWikiLinkNode(candidate)) return candidate
  }
  return null
}

export interface WikiLinkPluginOptions {
  /**
   * Called when the user activates a wikilink. This is the host's resolution
   * seam: `@llui/markdown-editor` knows nothing about what a target names.
   *
   * The notification travels the same route as every other plugin event —
   * `ctx.emit` → the editor's update loop → this plugin's reducer → an effect —
   * rather than a raw DOM event, so an activation is an ordinary TEA message
   * that shows up in devtools, replay and agent traces.
   */
  onNavigate?: (link: WikiLink) => void
  /** Text used as the target when the insert command runs with no selection. */
  placeholderTarget?: string
}

export function wikilinkPlugin(opts: WikiLinkPluginOptions = {}): MarkdownPlugin {
  const placeholderTarget = opts.placeholderTarget ?? 'Page'

  const item: CommandItem = {
    id: PLUGIN,
    label: 'Wiki link',
    icon: 'wikilink',
    group: 'inline',
    keywords: ['wiki', 'wikilink', 'backlink', 'reference', '[['],
    run: (editor) =>
      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return
        // A range selection's text can span blocks (newlines) and can contain
        // `|` or `]]` — none of which a `[[…]]` can carry. Sanitizing here, at
        // the boundary where user input enters the document, is what stops the
        // command from minting a link that destroys itself on the next reload.
        const selected = sanitizeWikiLinkTarget(selection.getTextContent())
        // Selected prose becomes the alias of a same-named target, so the
        // sentence reads unchanged and the author only has to fix the target.
        const node = $createWikiLinkNode(selected ?? placeholderTarget, null)
        selection.insertNodes([node])
        node.selectNext(0, 0)
      }),
    surfaces: ['toolbar', 'floating', 'slash', 'context'],
  }

  return {
    name: PLUGIN,
    nodes: [WikiLinkNode],
    transformers: [WIKILINK_TRANSFORMER],
    items: [item],
    register: (editor, ctx) => {
      const activate = (node: WikiLinkNode): true => {
        const { target, alias } = node.getLink()
        ctx.emit({ type: 'plugin', name: PLUGIN, msg: { type: 'activate', target, alias } })
        return true
      }
      return mergeRegister(
        editor.registerCommand(
          CLICK_COMMAND,
          (event: MouseEvent) => {
            const node = $wikiLinkFromEvent(event)
            if (!node) return false
            event.preventDefault()
            return activate(node)
          },
          COMMAND_PRIORITY_LOW,
        ),
        // Keyboard parity. A wikilink is token-mode text, so the caret can rest
        // on it, but CLICK_COMMAND is unreachable without a pointer — activation
        // was mouse-only. Mod+Enter (rather than bare Enter) keeps the ordinary
        // paragraph-splitting Enter intact while the caret sits beside a link.
        editor.registerCommand(
          KEY_ENTER_COMMAND,
          (event: KeyboardEvent | null) => {
            if (!event || !(event.metaKey || event.ctrlKey)) return false
            const node = $selectedWikiLink()
            if (!node) return false
            event.preventDefault()
            return activate(node)
          },
          COMMAND_PRIORITY_LOW,
        ),
      )
    },
    ui: definePluginUI<WikiLinkState, WikiLinkMsg, WikiLinkEffect>({
      init: () => ({ last: null }),
      update: (_state, msg) => {
        const link: WikiLink = { target: msg.target, alias: msg.alias }
        return [{ last: link }, [{ type: 'navigate', link }]]
      },
      onEffect: (effect) => opts.onNavigate?.(effect.link),
    }),
  }
}
