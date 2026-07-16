// Default Lexical theme for the markdown editor.
//
// Lexical styles most inline formats through semantic tags that carry
// browser-default styling — bold→<strong>, italic→<em>, code→<code>. But
// `strikethrough` renders as a bare <span> whose ONLY styling hook is a
// `theme.text.strikethrough` class. With no theme the format is applied to the
// model but is visually invisible. This default theme supplies that class name;
// the bundled `styles/editor.css` gives it its `text-decoration`.
//
// `underline` is deliberately NOT themed here: the GFM markdown dialect this
// editor serializes has no underline representation (Lexical's text-format
// transformers require a SYMMETRIC delimiter, and there is no standard symmetric
// underline syntax), so an applied underline would be silently stripped on save.
// To keep the WYSIWYG surface and the serialized dialect in lock-step, the
// underline command is also intercepted at the editor seam (see editor.ts) — so
// underline can be neither applied nor lost. Add it back (theme + transformer +
// command) only alongside a dialect that can round-trip it.
//
// Consumers can override any entry via `markdownEditor({ theme })` — the user's
// theme is merged over this default (see `mergeTheme`).

import type { EditorThemeClasses } from 'lexical'

export const STRIKETHROUGH_CLASS = 'md-strikethrough'

/** The class hooks Lexical needs for text-decoration formats it renders as a
 * plain <span>. */
export const defaultTheme: EditorThemeClasses = {
  text: {
    strikethrough: STRIKETHROUGH_CLASS,
  },
}

/** Merge a consumer theme over the default. `text` is merged per-key so a
 * consumer overriding (say) `strikethrough` keeps the other default entries.
 *
 * Always returns a FRESH theme (never the shared `defaultTheme` singleton):
 * Lexical caches resolved class arrays by MUTATING the `text` object it is
 * handed (`text.__lexicalClassNameCache`). Handing it a fresh copy keeps the
 * exported singleton clean, and stripping any inherited cache prevents a stale
 * entry from a previously-used theme object shadowing an overridden class. */
export function mergeTheme(theme?: EditorThemeClasses): EditorThemeClasses {
  const text = { ...defaultTheme.text, ...theme?.text }
  delete (text as { __lexicalClassNameCache?: unknown }).__lexicalClassNameCache
  return { ...theme, text }
}
