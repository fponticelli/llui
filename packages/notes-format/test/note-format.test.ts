import { describe, expect, it } from 'vitest'
import {
  buildQueue,
  currentStatusFromHistory,
  defaultSessionName,
  deriveFilename,
  deriveSlug,
  nextId,
  parseFilename,
  padId,
  preview,
} from '../src/note-format.js'
import type { StatusTransition } from '../src/note-types.js'

describe('deriveSlug', () => {
  it('takes the first content words, stopwords stripped', () => {
    expect(deriveSlug('The button is broken on the form')).toBe('button-broken-form')
  })
  it('falls back to "capture" when nothing remains', () => {
    expect(deriveSlug('   ')).toBe('capture')
    expect(deriveSlug('the is of to')).toBe('capture')
  })
  it('sanitizes to [a-z0-9-]', () => {
    expect(deriveSlug('Fix Login() crash!!!')).toBe('fix-login-crash')
  })
  it('caps at 32 chars on a word boundary', () => {
    const slug = deriveSlug('alpha bravo charlie delta echo foxtrot')
    expect(slug.length).toBeLessThanOrEqual(32)
    expect(slug.endsWith('-')).toBe(false)
  })
})

describe('deriveFilename / padId / nextId / parseFilename', () => {
  it('builds {id}-{author}-{kind}-{slug}.md', () => {
    expect(deriveFilename('001', 'human', 'text', 'hello-world')).toBe(
      '001-human-text-hello-world.md',
    )
  })
  it('pads ids to 3 digits, then grows past 1000', () => {
    expect(padId(1)).toBe('001')
    expect(padId(42)).toBe('042')
    expect(padId(1000)).toBe('1000')
  })
  it('nextId is max+1 over existing ids, handling gaps', () => {
    expect(nextId([])).toBe('001')
    expect(nextId([1, 2, 5])).toBe('006')
  })
  it('parseFilename round-trips a canonical name', () => {
    expect(parseFilename('012-llm-capture-some-slug.md')).toEqual({
      id: '012',
      idNum: 12,
      author: 'llm',
      kind: 'capture',
      slug: 'some-slug',
    })
  })
  it('parseFilename rejects non-canonical names', () => {
    expect(parseFilename('status.jsonl')).toBeNull()
    expect(parseFilename('current-session')).toBeNull()
  })
})

describe('defaultSessionName', () => {
  it('formats a UTC session-YYYY-MM-DD-HHMM name', () => {
    const d = new Date(Date.UTC(2026, 5, 7, 9, 4))
    expect(defaultSessionName(d)).toBe('session-2026-06-07-0904')
  })
})

describe('preview', () => {
  it('flattens whitespace and caps length', () => {
    expect(preview('  hello   world\n\nfoo  ')).toBe('hello world foo')
    expect(preview('x'.repeat(100), 10)).toBe('xxxxxxxxxx')
  })
})

describe('status replay', () => {
  const t = (noteId: string, to: StatusTransition['to'], ts: string): StatusTransition => ({
    ts,
    noteId,
    from: null,
    to,
    by: 'human',
  })

  it('currentStatusFromHistory returns the last transition', () => {
    expect(currentStatusFromHistory([])).toBeNull()
    expect(
      currentStatusFromHistory([
        t('a', 'open', '1'),
        t('a', 'claimed', '2'),
        t('a', 'proposed', '3'),
      ]),
    ).toBe('proposed')
  })

  it('buildQueue materializes per-note current status, newest first', () => {
    const txns = [
      t('a', 'open', '2026-01-01T00:00:00Z'),
      t('b', 'open', '2026-01-02T00:00:00Z'),
      t('a', 'applied', '2026-01-03T00:00:00Z'),
    ]
    const q = buildQueue(txns)
    expect(q.map((e) => [e.noteId, e.status])).toEqual([
      ['a', 'applied'],
      ['b', 'open'],
    ])
  })

  it('buildQueue filters by status', () => {
    const txns = [t('a', 'open', '1'), t('b', 'applied', '2')]
    expect(buildQueue(txns, { status: 'open' }).map((e) => e.noteId)).toEqual(['a'])
  })
})
