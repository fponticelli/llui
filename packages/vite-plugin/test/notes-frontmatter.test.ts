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
  it('produces a markdown document with frontmatter, prose, and a fenced json block', () => {
    const md = serializeNote({
      frontmatter: sampleFm,
      prose: 'The button copy is wrong.',
      body: sampleBody,
    })

    // frontmatter delimiters
    expect(md.startsWith('---\n')).toBe(true)
    expect(md).toMatch(/\n---\n/)

    // prose body
    expect(md).toContain('The button copy is wrong.')

    // fenced json block
    expect(md).toMatch(/```json\n[\s\S]+\n```/)
  })

  it('emits an empty json block ({}) when body has no fields', () => {
    const md = serializeNote({
      frontmatter: sampleFm,
      prose: 'no detail',
      body: {},
    })
    expect(md).toMatch(/```json\n\{\}\n```/)
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

  it('handles a document with empty prose', () => {
    const md = serializeNote({
      frontmatter: sampleFm,
      prose: '',
      body: {},
    })
    const parsed = parseNote(md)
    expect(parsed.prose.trim()).toBe('')
    expect(parsed.body).toEqual({})
  })

  it('throws on missing frontmatter', () => {
    expect(() => parseNote('# Just markdown, no frontmatter\n')).toThrow(/frontmatter/i)
  })

  it('throws on missing fenced json block', () => {
    const broken = '---\nid: "001"\nts: "x"\nauthor: human\n---\n\nProse only.\n'
    expect(() => parseNote(broken)).toThrow(/json block/i)
  })

  it('throws on malformed json inside the fenced block', () => {
    const broken =
      '---\n' +
      'id: "001"\n' +
      'ts: "2026-05-23T14:32:11.000Z"\n' +
      'author: human\n' +
      'kind: text\n' +
      'captureLevel: standard\n' +
      'url: "http://localhost"\n' +
      'route: null\n' +
      'routeParams: {}\n' +
      'viewport: { w: 1, h: 1, dpr: 1 }\n' +
      'componentPath: null\n' +
      'componentMeta: null\n' +
      'annotations: []\n' +
      'screenshot: null\n' +
      'agentSchemas: []\n' +
      'llui: { runtime: x, compiler: y }\n' +
      '---\n' +
      '\nProse.\n\n' +
      '```json\n' +
      '{ this is not json }\n' +
      '```\n'
    expect(() => parseNote(broken)).toThrow()
  })
})
