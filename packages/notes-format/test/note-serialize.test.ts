import { describe, expect, it } from 'vitest'
import { parseNote, serializeNote, type SerializedNote } from '../src/note-serialize.js'
import type { NoteFrontmatter } from '../src/note-types.js'

function fixture(overrides: Partial<SerializedNote> = {}): SerializedNote {
  const frontmatter: NoteFrontmatter = {
    id: '001',
    ts: '2026-07-12T10:00:00.000Z',
    author: 'human',
    kind: 'rect',
    captureLevel: 'standard',
    url: 'http://localhost:5173/',
    route: '/',
    routeParams: {},
    viewport: { w: 1280, h: 800, dpr: 2 },
    componentPath: null,
    componentMeta: null,
    annotations: [{ type: 'rect', x: 1, y: 2, w: 3, h: 4, label: 'here' }],
    screenshot: null,
    agentSchemas: [],
    llui: { runtime: '0.11.6', compiler: '0.11.3' },
  }
  return {
    frontmatter,
    prose: 'The button is broken.',
    body: { stateSnapshot: { count: 1 } },
    ...overrides,
  }
}

describe('serializeNote / parseNote round-trip', () => {
  it('round-trips frontmatter, body, and prose', () => {
    const note = fixture()
    const round = parseNote(serializeNote(note))
    expect(round.frontmatter).toEqual(note.frontmatter)
    expect(round.body).toEqual(note.body)
    expect(round.prose).toBe(note.prose)
  })

  it('emits YAML frontmatter with the body under a `body:` key', () => {
    const md = serializeNote(fixture())
    expect(md.startsWith('---\n')).toBe(true)
    expect(md).toContain('\nbody:')
    expect(md).toContain('The button is broken.')
  })

  it('keeps an empty body present so parsers can rely on it', () => {
    const md = serializeNote(fixture({ body: {} }))
    const round = parseNote(md)
    expect(round.body).toEqual({})
  })

  it('serializes a note with empty prose without a trailing prose section', () => {
    const md = serializeNote(fixture({ prose: '   ' }))
    expect(parseNote(md).prose).toBe('')
  })

  it('throws on missing frontmatter', () => {
    expect(() => parseNote('no frontmatter here')).toThrow(/missing frontmatter/)
  })

  it('throws on unterminated frontmatter', () => {
    expect(() => parseNote('---\nid: 001')).toThrow(/unterminated frontmatter/)
  })

  it('reads the legacy trailing ```json fenced body shape', () => {
    const legacy =
      '---\n' +
      'id: "001"\n' +
      'author: human\n' +
      'kind: rect\n' +
      '---\n\n' +
      'Legacy prose.\n\n' +
      '```json\n' +
      '{ "stateSnapshot": { "count": 2 } }\n' +
      '```\n'
    const round = parseNote(legacy)
    expect(round.prose).toBe('Legacy prose.')
    expect(round.body).toEqual({ stateSnapshot: { count: 2 } })
  })

  it('throws when a legacy note has neither a `body:` key nor a fenced block', () => {
    const bad = '---\nid: "001"\nauthor: human\n---\n\nJust prose, no body.\n'
    expect(() => parseNote(bad)).toThrow(/missing body/)
  })
})
