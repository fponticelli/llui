import { describe, expect, it } from 'vitest'
import { parseNote, serializeNote } from '../src/notes/frontmatter.js'
import type { NoteBody, NoteFrontmatter } from '../src/notes/types.js'

const sampleFm: NoteFrontmatter = {
  id: '001',
  ts: '2026-05-23T14:32:11.000Z',
  author: 'human',
  kind: 'rect',
  captureLevel: 'standard',
  url: 'http://localhost:5173/users/42',
  route: '/users/:id',
  routeParams: { id: '42' },
  viewport: { w: 1440, h: 900, dpr: 2 },
  componentPath: ['App', 'UserCard', 'EditButton'],
  componentMeta: { file: 'src/EditButton.ts', line: 14, name: 'EditButton' },
  annotations: [{ type: 'rect', x: 142, y: 88, w: 96, h: 32, label: 'wrong copy' }],
  screenshot: '001-human-rect-edit-button.png',
  agentSchemas: [{ msg: 'EditUser', fields: { id: 'string', name: 'string' } }],
  llui: { runtime: '0.4.3', compiler: '0.5.6' },
}

const sampleBody: NoteBody = {
  stateSnapshot: { user: { id: 42, name: 'Ada' } },
  messageLog: [{ ts: '2026-05-23T14:32:10.500Z', component: 'UserCard', msg: { type: 'Load' } }],
  pendingMessages: [],
  effects: { pending: [], recent: [] },
}

describe('serializeNote', () => {
  it('produces a markdown document with frontmatter (incl. body) and prose', () => {
    const md = serializeNote({
      frontmatter: sampleFm,
      prose: 'The button copy is wrong.',
      body: sampleBody,
    })

    // frontmatter delimiters
    expect(md.startsWith('---\n')).toBe(true)
    expect(md).toMatch(/\n---\n/)

    // body lives in the frontmatter now, not a fenced block in the prose
    expect(md).toContain('body:')
    expect(md).not.toContain('```json')

    // prose body
    expect(md).toContain('The button copy is wrong.')
  })

  it('always emits a body key, even when empty', () => {
    const md = serializeNote({ frontmatter: sampleFm, prose: 'no detail', body: {} })
    expect(md).toMatch(/body:\s*\{\}/)
  })
})

describe('parseNote', () => {
  it('round-trips frontmatter, prose, and body', () => {
    const md = serializeNote({
      frontmatter: sampleFm,
      prose: 'Some prose here.\nSecond line.',
      body: sampleBody,
    })
    const parsed = parseNote(md)
    expect(parsed.frontmatter).toEqual(sampleFm)
    expect(parsed.prose.trim()).toBe('Some prose here.\nSecond line.')
    expect(parsed.body).toEqual(sampleBody)
  })

  it('round-trips prose that itself contains a ```json fence (regression)', () => {
    // The old fenced-body format collided here: the parser locked onto the
    // prose's ```json block and corrupted/threw on the body. With the body in
    // frontmatter this is unambiguous.
    const prose = [
      'Here is an example payload:',
      '',
      '```json',
      '{ "example": true, "nested": { "a": 1 } }',
      '```',
      '',
      'End of note.',
    ].join('\n')
    const md = serializeNote({ frontmatter: sampleFm, prose, body: sampleBody })
    const parsed = parseNote(md)
    expect(parsed.prose).toBe(prose)
    expect(parsed.body).toEqual(sampleBody)
  })

  it('handles a document with empty prose', () => {
    const md = serializeNote({ frontmatter: sampleFm, prose: '', body: {} })
    const parsed = parseNote(md)
    expect(parsed.prose.trim()).toBe('')
    expect(parsed.body).toEqual({})
  })

  it('throws on missing frontmatter', () => {
    expect(() => parseNote('# Just markdown, no frontmatter\n')).toThrow(/frontmatter/i)
  })

  it('throws when there is neither a body key nor a legacy fence', () => {
    const broken = '---\nid: "001"\nts: "x"\nauthor: human\n---\n\nProse only.\n'
    expect(() => parseNote(broken)).toThrow(/body/i)
  })

  describe('legacy fenced-body format', () => {
    function legacyNote(prose: string, bodyJson: string): string {
      return (
        '---\n' +
        'id: "001"\n' +
        'ts: "2026-05-23T14:32:11.000Z"\n' +
        'author: human\n' +
        'kind: text\n' +
        '---\n' +
        '\n' +
        (prose === '' ? '' : `${prose}\n\n`) +
        '```json\n' +
        bodyJson +
        '\n```\n'
      )
    }

    it('still parses the old trailing ```json fence', () => {
      const md = legacyNote('Legacy prose.', '{ "stateSnapshot": { "x": 1 } }')
      const parsed = parseNote(md)
      expect(parsed.prose).toBe('Legacy prose.')
      expect(parsed.body).toEqual({ stateSnapshot: { x: 1 } })
    })

    it('picks the LAST fence so a prose ```json block is not mistaken for the body', () => {
      const prose = 'Example:\n\n```json\n{ "not": "the body" }\n```\n\nDone.'
      const md = legacyNote(prose, '{ "stateSnapshot": "real" }')
      const parsed = parseNote(md)
      expect(parsed.body).toEqual({ stateSnapshot: 'real' })
    })

    it('throws on malformed json inside the legacy fence', () => {
      const md = legacyNote('Prose.', '{ this is not json }')
      expect(() => parseNote(md)).toThrow()
    })
  })
})
