// Default Lexical theme for the markdown editor.
//
// Lexical styles most inline formats through semantic tags that carry
// browser-default styling — bold→<strong>, italic→<em>, code→<code>. But
// `strikethrough` (and `underline`) render as a bare <span> whose ONLY styling
// hook is a `theme.text.<format>` class. With no theme the format is applied to
// the model but is visually invisible. This default theme supplies those class
// names; the bundled `styles/editor.css` gives them their `text-decoration`.
//
// Consumers can override any entry via `markdownEditor({ theme })` — the user's
// theme is merged over this default (see `mergeTheme`).

import type { EditorThemeClasses } from 'lexical'

export const STRIKETHROUGH_CLASS = 'md-strikethrough'
export const UNDERLINE_CLASS = 'md-underline'
export const UNDERLINE_STRIKETHROUGH_CLASS = 'md-underline-strikethrough'

/** The class hooks Lexical needs for text-decoration formats it renders as a
 * plain <span>. (`underlineStrikethrough` is Lexical's special composite key for
 * the case where both apply — both want `text-decoration`.) */
export const defaultTheme: EditorThemeClasses = {
  text: {
    strikethrough: STRIKETHROUGH_CLASS,
    underline: UNDERLINE_CLASS,
    underlineStrikethrough: UNDERLINE_STRIKETHROUGH_CLASS,
  },
}

/** Merge a consumer theme over the default. `text` is merged per-key so a
 * consumer overriding (say) `strikethrough` keeps the default `underline`.
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
