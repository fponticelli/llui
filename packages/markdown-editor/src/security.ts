// URL-scheme policy for the editor.
//
// The read-only renderer (`@llui/markdown`) already refuses dangerous link/image
// schemes (`javascript:`, `vbscript:`, `data:text/html`, …) via `sanitizeUrl`.
// The EDITOR has additional ingress points that must enforce the SAME policy or
// an attacker-authored document becomes live/clickable inside it:
//
//   1. link commit           — `$toggleLink` on a raw, user-typed URL,
//   2. image src             — an `![alt](src)` inserted or imported,
//   3. markdown paste/import — `$convertFromMarkdownString` builds real
//      `LinkNode`s (and image decorator nodes) from untrusted text,
//   4. the typed `[x](url)`  markdown shortcut — builds a `LinkNode` live.
//
// Links are additionally guarded by a global `LinkNode` node transform
// ({@link registerLinkSanitizer}) so #1/#3/#4 all funnel through one enforcement
// point. Rather than hand-roll (and drift from) a second allowlist, this module
// reuses `@llui/markdown`'s exact `sanitizeUrl` and only differs in the
// allowed-scheme SET per surface — which is data, not a divergent implementation.

import { sanitizeUrl, defaultAllowedProtocols } from '@llui/markdown/security'
import { $isLinkNode, LinkNode } from '@lexical/link'
import { $isElementNode, type LexicalEditor, type LexicalNode } from 'lexical'

/** Schemes allowed for a hyperlink href. A click navigates, so this is the strict
 * set — identical to the renderer's default (`http`/`https`/`mailto`/`tel`). */
export const LINK_PROTOCOLS: readonly string[] = defaultAllowedProtocols

/** Schemes allowed for an image `src`. Adds `data:` on top of the link set: a
 * base64 image never executes when loaded through `<img>` (unlike a `data:`
 * hyperlink, which can carry `text/html`), and inline data images are a
 * first-class editor feature (paste / upload). */
export const IMAGE_PROTOCOLS: readonly string[] = [...defaultAllowedProtocols, 'data']

/** Sanitize a hyperlink href. Returns the safe URL, or `null` when the scheme is
 * not on {@link LINK_PROTOCOLS} (the link must then be dropped/unwrapped). */
export function sanitizeLinkUrl(url: string): string | null {
  return sanitizeUrl(url, LINK_PROTOCOLS)
}

/** Sanitize an image `src`. Returns the safe URL, or `null` when the scheme is
 * not on {@link IMAGE_PROTOCOLS} (the image must then be dropped). */
export function sanitizeImageUrl(url: string): string | null {
  return sanitizeUrl(url, IMAGE_PROTOCOLS)
}

/** Neutralize one `LinkNode` in place (must run inside `editor.update`): rewrite a
 * merely-normalized href, or — when the scheme is disallowed — UNWRAP the link so
 * its visible text survives but the clickable `javascript:`/`data:` payload is
 * gone. Returns true if the node was unwrapped/removed. */
function neutralizeLink(node: LinkNode): boolean {
  const url = node.getURL()
  const safe = sanitizeLinkUrl(url)
  if (safe === null) {
    for (const child of node.getChildren()) node.insertBefore(child)
    node.remove()
    return true
  }
  if (safe !== url) node.setURL(safe)
  return false
}

/** Walk `node` (depth-first) neutralizing every unsafe `LinkNode` beneath it. Must
 * run inside an `editor.update`. Use right after importing untrusted markdown
 * (e.g. paste) into a detached scratch tree, before it reaches the live document. */
export function $sanitizeLinkNodes(node: LexicalNode): void {
  if ($isLinkNode(node)) {
    // Snapshot children first: unwrapping lifts them out of the (removed) link,
    // so recurse the snapshot to catch a defensively-nested inner link either way.
    const children = node.getChildren()
    neutralizeLink(node)
    for (const child of children) $sanitizeLinkNodes(child)
    return
  }
  if ($isElementNode(node)) {
    for (const child of node.getChildren()) $sanitizeLinkNodes(child)
  }
}

/** Register a global `LinkNode` transform that keeps every link's href on the
 * allowlist — the single choke point covering the link dialog, pasted/imported
 * markdown, AND the typed `[text](url)` shortcut. Returns a disposer. A no-op when
 * `LinkNode` isn't registered on the editor (no links are possible then, e.g. the
 * single-block preset), since `registerNodeTransform` requires a registered node. */
export function registerLinkSanitizer(editor: LexicalEditor): () => void {
  if (!editor.hasNodes([LinkNode])) return () => {}
  return editor.registerNodeTransform(LinkNode, (node) => {
    neutralizeLink(node)
  })
}
