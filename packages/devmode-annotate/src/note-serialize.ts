// Note serialization / parsing — the canonical, fs-free implementation of
// the on-disk `.md` format, shared by the server filesystem store and
// browser stores (export bundles, dev import). A note on disk is:
//   1. YAML frontmatter between `---` fences carrying the NoteFrontmatter
//      fields plus the structured NoteBody under a `body:` key
//   2. Markdown prose (human content only)
//
// Machine data lives entirely in the YAML so it can never collide with the
// prose. `parseNote` also reads the legacy trailing-```json-fence shape; any
// write re-emits in the current format, migrating legacy notes on touch.

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { NoteBody, NoteFrontmatter } from './note-types.js'

export interface SerializedNote {
  frontmatter: NoteFrontmatter
  prose: string
  body: NoteBody
}

const LEGACY_FENCE_OPEN = '```json'
const LEGACY_FENCE_CLOSE = '```'

const YAML_OPTS = {
  lineWidth: 0,
  defaultStringType: 'PLAIN',
  defaultKeyType: 'PLAIN',
} as const

export function serializeNote(note: SerializedNote): string {
  // Body lives under a `body:` key alongside the frontmatter fields. Always
  // present (even `{}`) so parsers can rely on it.
  const fmYaml = stringifyYaml({ ...note.frontmatter, body: note.body }, YAML_OPTS)
  const prose = note.prose.trim()
  const proseSection = prose === '' ? '' : `\n${prose}\n`
  return `---\n${fmYaml}---\n${proseSection}`
}

export function parseNote(markdown: string): SerializedNote {
  if (!markdown.startsWith('---')) {
    throw new Error('parseNote: missing frontmatter — note must begin with `---`')
  }
  const fmEnd = markdown.indexOf('\n---', 3)
  if (fmEnd === -1) {
    throw new Error('parseNote: unterminated frontmatter — no closing `---`')
  }
  const fmYaml = markdown.slice(3, fmEnd).replace(/^\n/, '')
  const parsed = (parseYaml(fmYaml) ?? {}) as NoteFrontmatter & { body?: NoteBody }

  const afterFm = markdown.slice(fmEnd + '\n---'.length).replace(/^\n+/, '')

  if ('body' in parsed) {
    const { body, ...frontmatter } = parsed
    return {
      frontmatter,
      prose: afterFm.trim(),
      body: body ?? {},
    }
  }

  return parseLegacyFenced(parsed, afterFm)
}

function parseLegacyFenced(frontmatter: NoteFrontmatter, afterFm: string): SerializedNote {
  const fenceStart = afterFm.lastIndexOf(LEGACY_FENCE_OPEN)
  if (fenceStart === -1) {
    throw new Error('parseNote: missing body — no `body:` frontmatter key and no fenced json block')
  }
  const fenceContentStart = fenceStart + LEGACY_FENCE_OPEN.length
  const jsonStart = afterFm.indexOf('\n', fenceContentStart) + 1
  const fenceEnd = afterFm.indexOf(`\n${LEGACY_FENCE_CLOSE}`, jsonStart)
  if (fenceEnd === -1) {
    throw new Error('parseNote: unterminated fenced json block')
  }

  const prose = afterFm.slice(0, fenceStart).trim()
  const bodyJson = afterFm.slice(jsonStart, fenceEnd)
  const body = JSON.parse(bodyJson) as NoteBody

  return { frontmatter, prose, body }
}
