import { describe, expect, it } from 'vitest'
import { testComponent, reducer } from '@llui/test'
import {
  browseInit,
  browseReduce,
  matchesFilters,
  statusBucket,
  type BrowseState,
  type BrowseMsg,
  type BrowseEffect,
} from '../src/browse-view.js'

const def = reducer<BrowseState, BrowseMsg, BrowseEffect>({
  init: () => [browseInit(), []],
  update: browseReduce,
})

const note = (over: Partial<Parameters<typeof matchesFilters>[0]> = {}) => ({
  id: 'n1',
  filename: 'n1.md',
  sessionId: 's1',
  kind: 'text',
  author: 'human' as const,
  ts: '2026-01-01T00:00:00Z',
  preview: 'hello world',
  ...over,
})

describe('browse-view: pure helpers', () => {
  it('buckets statuses into filter categories', () => {
    expect(statusBucket(undefined)).toBe('open')
    expect(statusBucket('open')).toBe('open')
    expect(statusBucket('in-progress')).toBe('working')
    expect(statusBucket('proposed')).toBe('proposed')
    expect(statusBucket('applied')).toBe('applied')
    expect(statusBucket('wontfix')).toBe('closed')
  })

  it('matchesFilters honours kind/author/status/text', () => {
    const f = { kind: 'all', author: 'all', status: 'all', text: '' } as const
    expect(matchesFilters(note(), f)).toBe(true)
    expect(matchesFilters(note({ kind: 'rect' }), { ...f, kind: 'text' })).toBe(false)
    expect(matchesFilters(note({ author: 'llm' }), { ...f, author: 'human' })).toBe(false)
    expect(matchesFilters(note({ status: 'wontfix' }), { ...f, status: 'closed' })).toBe(true)
    expect(matchesFilters(note({ preview: 'abc' }), { ...f, text: 'xyz' })).toBe(false)
    expect(matchesFilters(note({ preview: 'AbcXyz' }), { ...f, text: 'xyz' })).toBe(true)
  })
})

describe('browse-view reducer', () => {
  it('show → loading + fetchSessions; idempotent once not idle', () => {
    const h = testComponent(def)
    h.send({ type: 'show' })
    expect(h.state.phase).toBe('loading')
    expect(h.effects).toEqual([{ type: 'fetchSessions' }])
    h.send({ type: 'show' })
    expect(h.effects).toEqual([]) // no second fetch
  })

  it('sessions/loaded picks most-recent session and fetches its notes', () => {
    const h = testComponent(def)
    h.send({
      type: 'sessions/loaded',
      sessions: [
        { id: 's1', noteCount: 2 },
        { id: 's2', noteCount: 1 },
      ],
    })
    expect(h.state.currentSessionId).toBe('s2')
    expect(h.effects).toEqual([{ type: 'fetchNotes', sessionId: 's2' }])
  })

  it('sessions/loaded keeps the current session if it still exists', () => {
    const h = testComponent(def)
    h.send({ type: 'sessions/loaded', sessions: [{ id: 's1', noteCount: 1 }] })
    h.send({ type: 'session/select', id: 's1' })
    h.send({
      type: 'sessions/loaded',
      sessions: [
        { id: 's1', noteCount: 1 },
        { id: 's2', noteCount: 1 },
      ],
    })
    expect(h.state.currentSessionId).toBe('s1')
  })

  it('notes/loaded sorts newest-first', () => {
    const h = testComponent(def)
    h.send({
      type: 'notes/loaded',
      notes: [
        note({ id: 'a', ts: '2026-01-01T00:00:00Z' }),
        note({ id: 'b', ts: '2026-02-01T00:00:00Z' }),
      ],
    })
    expect(h.state.notes.map((n) => n.id)).toEqual(['b', 'a'])
  })

  it('toggleExpand fetches expansion once, then collapses without re-fetch', () => {
    const h = testComponent(def)
    h.send({ type: 'sessions/loaded', sessions: [{ id: 's1', noteCount: 1 }] })
    h.send({ type: 'row/toggleExpand', id: 'n1' })
    expect(h.state.expandedNoteId).toBe('n1')
    expect(h.state.expansions['n1']).toBe('loading')
    expect(h.effects).toEqual([{ type: 'fetchExpansion', id: 'n1', sessionId: 's1' }])
    // hydrate, collapse, re-expand → no second fetch (cached)
    h.send({
      type: 'expansion/loaded',
      id: 'n1',
      data: { prose: 'p', frontmatter: { kind: 'text', author: 'human' }, history: [], repro: [] },
    })
    h.send({ type: 'row/toggleExpand', id: 'n1' })
    expect(h.state.expandedNoteId).toBe(null)
    h.send({ type: 'row/toggleExpand', id: 'n1' })
    expect(h.effects).toEqual([])
  })

  it('selection toggles + bulk delete clears and emits bulkDelete', () => {
    const h = testComponent(def)
    h.send({ type: 'sessions/loaded', sessions: [{ id: 's1', noteCount: 1 }] })
    h.send({ type: 'row/toggleSelect', id: 'a' })
    h.send({ type: 'row/toggleSelect', id: 'b' })
    h.send({ type: 'row/toggleSelect', id: 'a' }) // toggle off
    expect(h.state.selectedIds).toEqual(['b'])
    h.send({ type: 'bulk/delete' })
    expect(h.state.selectedIds).toEqual([])
    expect(h.effects).toEqual([{ type: 'bulkDelete', ids: ['b'], sessionId: 's1' }])
  })

  it('bulk wontfix emits a bulkStatus effect', () => {
    const h = testComponent(def)
    h.send({ type: 'sessions/loaded', sessions: [{ id: 's1', noteCount: 1 }] })
    h.send({ type: 'row/toggleSelect', id: 'x' })
    h.send({ type: 'bulk/wontfix' })
    expect(h.effects).toEqual([{ type: 'bulkStatus', ids: ['x'], to: 'wontfix', sessionId: 's1' }])
  })

  it('edit start/change/save emits patchProse with the draft', () => {
    const h = testComponent(def)
    h.send({ type: 'sessions/loaded', sessions: [{ id: 's1', noteCount: 1 }] })
    h.send({ type: 'edit/start', id: 'n1', prose: 'old' })
    expect(h.state.editingNoteId).toBe('n1')
    h.send({ type: 'edit/change', value: 'new prose' })
    h.send({ type: 'edit/save' })
    expect(h.state.editingNoteId).toBe(null)
    expect(h.effects).toEqual([
      { type: 'patchProse', id: 'n1', prose: 'new prose', sessionId: 's1' },
    ])
  })

  it('edit cancel drops back to view mode without an effect', () => {
    const h = testComponent(def)
    h.send({ type: 'edit/start', id: 'n1', prose: 'x' })
    h.send({ type: 'edit/cancel' })
    expect(h.state.editingNoteId).toBe(null)
    expect(h.effects).toEqual([])
  })

  it('diff accept/reject post status for the original task', () => {
    const h = testComponent(def)
    h.send({ type: 'sessions/loaded', sessions: [{ id: 's1', noteCount: 1 }] })
    h.send({ type: 'diff/accept', taskId: 't9' })
    expect(h.effects).toEqual([
      { type: 'postStatus', taskId: 't9', to: 'accepted', sessionId: 's1' },
    ])
    h.send({ type: 'diff/reject', taskId: 't9' })
    expect(h.effects).toEqual([
      { type: 'postStatus', taskId: 't9', to: 'rejected', sessionId: 's1' },
    ])
  })

  it('lightbox open/close tracks the src', () => {
    const h = testComponent(def)
    h.send({ type: 'lightbox/open', src: 'blob:abc' })
    expect(h.state.lightboxSrc).toBe('blob:abc')
    h.send({ type: 'lightbox/close' })
    expect(h.state.lightboxSrc).toBe(null)
  })

  it('session/select resets expansion + selection + cache and refetches', () => {
    const h = testComponent(def)
    h.send({
      type: 'sessions/loaded',
      sessions: [
        { id: 's1', noteCount: 1 },
        { id: 's2', noteCount: 1 },
      ],
    })
    h.send({ type: 'row/toggleSelect', id: 'a' })
    h.send({ type: 'row/toggleExpand', id: 'b' })
    h.send({ type: 'session/select', id: 's1' })
    expect(h.state.selectedIds).toEqual([])
    expect(h.state.expandedNoteId).toBe(null)
    expect(h.state.expansions).toEqual({})
    expect(h.effects).toEqual([{ type: 'fetchNotes', sessionId: 's1' }])
  })
})
