// Note serialization / parsing. A note on disk is:
//   1. YAML frontmatter between `---` fences, carrying BOTH the
//      NoteFrontmatter fields and the structured NoteBody under a `body:` key
//   2. Markdown prose (human content only)
//
// Machine data (frontmatter + body) lives entirely in the YAML frontmatter so
// it can never collide with the prose. An earlier format stored NoteBody in a
// trailing ```json fence inside the prose region; that collided when the prose
// itself contained a ```json example block (the parser locked onto the prose's
// fence and corrupted the body / threw). `parseNote` still reads that legacy
// shape, and any write re-emits the note in the current format — so legacy
// notes migrate the first time they're touched.

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { NoteBody, NoteFrontmatter } from './types.js'

export interface SerializedNote {
  frontmatter: NoteFrontmatter
  prose: string
  body: NoteBody
}

const LEGACY_FENCE_OPEN = '```json'
const LEGACY_FENCE_CLOSE = '```'

const YAML_OPTS = {
  // Compact flow style for tiny objects (viewport, routeParams) keeps the
  // frontmatter scannable in a terminal. Block style for arrays of objects
  // (annotations, agentSchemas) preserves readability for the common case of
  // one entry per line.
  lineWidth: 0,
  defaultStringType: 'PLAIN',
  defaultKeyType: 'PLAIN',
} as const

export function serializeNote(note: SerializedNote): string {
  // Body lives under a `body:` key alongside the frontmatter fields. It is
  // always present (even when `{}`) so parsers can rely on it.
  const fmYaml = stringifyYaml({ ...note.frontmatter, body: note.body }, YAML_OPTS)
  const prose = note.prose.trim()
  const proseSection = prose === '' ? '' : `\n${prose}\n`

  return `---\n${fmYaml}---\n${proseSection}`
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
  // parseYaml returns `any`; the on-disk YAML carries the frontmatter fields
  // plus (in the current format) a `body` key holding NoteBody.
  const parsed = (parseYaml(fmYaml) ?? {}) as NoteFrontmatter & { body?: NoteBody }

  const afterFm = markdown.slice(fmEnd + '\n---'.length).replace(/^\n+/, '')

  // 2. Current format: `body` is a frontmatter key, the rest of the file is
  // pure prose. Split body out of the frontmatter object.
  if ('body' in parsed) {
    const { body, ...frontmatter } = parsed
    return {
      frontmatter,
      prose: afterFm.trim(),
      body: body ?? {},
    }
  }

  // 3. Legacy format: NoteBody is in a trailing ```json fence after the prose.
  // Use lastIndexOf so a ```json block inside the prose can't be mistaken for
  // the body fence (the body fence is always the last one).
  return parseLegacyFenced(parsed, afterFm)
}

function parseLegacyFenced(frontmatter: NoteFrontmatter, afterFm: string): SerializedNote {
  const fenceStart = afterFm.lastIndexOf(LEGACY_FENCE_OPEN)
  if (fenceStart === -1) {
    throw new Error('parseNote: missing body — no `body:` frontmatter key and no fenced json block')
  }
  const fenceContentStart = fenceStart + LEGACY_FENCE_OPEN.length
  // Skip the newline after the open fence
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
