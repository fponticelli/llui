// Emoji plugin — replace `:shortcode:` with the emoji while typing or on import,
// via a text-match transformer. Unknown shortcodes are left untouched.

import { $createTextNode, type TextNode } from 'lexical'
import type { TextMatchTransformer } from '@lexical/markdown'
import type { MarkdownPlugin } from './types.js'

/** A small default shortcode → emoji map. Extend via `emojiPlugin({ emoji })`. */
export const DEFAULT_EMOJI: Readonly<Record<string, string>> = {
  smile: '😄',
  grin: '😁',
  joy: '😂',
  wink: '😉',
  heart: '❤️',
  thumbsup: '👍',
  '+1': '👍',
  thumbsdown: '👎',
  fire: '🔥',
  tada: '🎉',
  rocket: '🚀',
  star: '⭐',
  check: '✅',
  x: '❌',
  warning: '⚠️',
  bulb: '💡',
  eyes: '👀',
  sparkles: '✨',
  '100': '💯',
  thinking: '🤔',
}

function transformer(map: Readonly<Record<string, string>>): TextMatchTransformer {
  return {
    dependencies: [],
    // `null` keeps the emoji as a unicode character in the exported markdown.
    export: () => null,
    importRegExp: /:([a-z0-9_+-]+):/,
    regExp: /:([a-z0-9_+-]+):$/,
    trigger: ':',
    replace: (node: TextNode, match: RegExpMatchArray): void => {
      const emoji = map[match[1] ?? '']
      if (emoji) node.replace($createTextNode(emoji))
    },
    type: 'text-match',
  }
}

export interface EmojiPluginOptions {
  /** Extra/override shortcode → emoji entries (merged over the defaults). */
  emoji?: Readonly<Record<string, string>>
}

export function emojiPlugin(opts: EmojiPluginOptions = {}): MarkdownPlugin {
  const map = { ...DEFAULT_EMOJI, ...(opts.emoji ?? {}) }
  return {
    name: 'emoji',
    transformers: [transformer(map)],
  }
}
