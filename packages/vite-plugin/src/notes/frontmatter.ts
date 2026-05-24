// Note serialization / parsing. A note on disk is:
//   1. YAML frontmatter (NoteFrontmatter) between `---` fences
//   2. Markdown prose
//   3. A single fenced ```json block carrying NoteBody
//
// The fenced JSON block is ALWAYS present, even when the body is `{}` —
// parsers can rely on its presence (per 01-on-disk-format.md, §"Body JSON
// block — required or optional?").

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { NoteBody, NoteFrontmatter } from './types.js'

export interface SerializedNote {
  frontmatter: NoteFrontmatter
  prose: string
  body: NoteBody
}

const FENCE_OPEN = '```json'
const FENCE_CLOSE = '```'

export function serializeNote(note: SerializedNote): string {
  const fmYaml = stringifyYaml(note.frontmatter, {
    // Compact flow style for tiny objects (viewport, routeParams) keeps
    // the frontmatter scannable in a terminal. Block style for arrays of
    // objects (annotations, agentSchemas) preserves readability for the
    // common case of one entry per line.
    lineWidth: 0,
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN',
  })
  const bodyJson = JSON.stringify(note.body, null, 2)
  const prose = note.prose.trim()
  const proseBlock = prose === '' ? '' : `${prose}\n\n`

  return `---\n${fmYaml}---\n\n${proseBlock}${FENCE_OPEN}\n${bodyJson}\n${FENCE_CLOSE}\n`
}

export function parseNote(markdown: string): SerializedNote {
  // 1. Extract frontmatter
  if (!markdown.startsWith('---')) {
    throw new Error('parseNote: missing frontmatter — note must begin with `---`')
  }
  const fmEnd = markdown.indexOf('\n---', 3)
  if (fmEnd === -1) {
    throw new Error('parseNote: unterminated frontmatter — no closing `---`')
  }
  const fmYaml = markdown.slice(3, fmEnd).replace(/^\n/, '')
  const frontmatter = parseYaml(fmYaml) as NoteFrontmatter

  // 2. The rest is prose + fenced json block
  const afterFm = markdown.slice(fmEnd + '\n---'.length).replace(/^\n+/, '')

  const fenceStart = afterFm.indexOf(FENCE_OPEN)
  if (fenceStart === -1) {
    throw new Error('parseNote: missing fenced json block — required even when empty')
  }
  const fenceContentStart = fenceStart + FENCE_OPEN.length
  // Skip the newline after the open fence
  const jsonStart = afterFm.indexOf('\n', fenceContentStart) + 1
  const fenceEnd = afterFm.indexOf(`\n${FENCE_CLOSE}`, jsonStart)
  if (fenceEnd === -1) {
    throw new Error('parseNote: unterminated fenced json block')
  }

  const prose = afterFm.slice(0, fenceStart).trim()
  const bodyJson = afterFm.slice(jsonStart, fenceEnd)
  const body = JSON.parse(bodyJson) as NoteBody

  return { frontmatter, prose, body }
}
