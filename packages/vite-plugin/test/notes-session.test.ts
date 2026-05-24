import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultSessionName,
  ensureSession,
  readCurrentSessionFile,
  resolveCurrentSession,
  rotateSession,
} from '../src/notes/session.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'llui-notes-test-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('defaultSessionName', () => {
  it('formats session-YYYY-MM-DD-HHMM from a Date', () => {
    const d = new Date(Date.UTC(2026, 4, 23, 14, 32))
    expect(defaultSessionName(d)).toBe('session-2026-05-23-1432')
  })

  it('zero-pads month, day, hour, minute', () => {
    const d = new Date(Date.UTC(2026, 0, 5, 1, 7))
    expect(defaultSessionName(d)).toBe('session-2026-01-05-0107')
  })
})

describe('readCurrentSessionFile', () => {
  it('returns null when current-session file is absent', () => {
    expect(readCurrentSessionFile(dir)).toBe(null)
  })
})

describe('resolveCurrentSession', () => {
  it('creates a session dir + current-session file when none exists', () => {
    const session = resolveCurrentSession(dir, {
      now: () => new Date(Date.UTC(2026, 4, 23, 14, 32)),
    })
    expect(session.sessionId).toBe('session-2026-05-23-1432')
    expect(readdirSync(dir)).toContain('current-session')
    expect(readdirSync(dir)).toContain('session-2026-05-23-1432')
    const marker = readFileSync(join(dir, 'current-session'), 'utf8').trim()
    expect(marker).toBe('session-2026-05-23-1432')
  })

  it('reuses the existing session when current-session file points to one', () => {
    resolveCurrentSession(dir, { now: () => new Date(Date.UTC(2026, 4, 23, 14, 32)) })
    const again = resolveCurrentSession(dir, { now: () => new Date(Date.UTC(2026, 4, 24, 9, 0)) })
    expect(again.sessionId).toBe('session-2026-05-23-1432')
  })

  it('respects LLUI_SESSION_NAME env override', () => {
    const session = resolveCurrentSession(dir, {
      sessionName: 'session-custom-name',
      now: () => new Date(),
    })
    expect(session.sessionId).toBe('session-custom-name')
  })

  it('returns absolute notesDir path', () => {
    const session = resolveCurrentSession(dir, { now: () => new Date() })
    expect(session.notesDir.startsWith(dir)).toBe(true)
    expect(session.notesDir.endsWith(session.sessionId)).toBe(true)
  })
})

describe('rotateSession', () => {
  it('creates a new session dir and updates the marker', () => {
    resolveCurrentSession(dir, { now: () => new Date(Date.UTC(2026, 4, 23, 14, 32)) })
    const rotated = rotateSession(dir, { now: () => new Date(Date.UTC(2026, 4, 24, 9, 15)) })
    expect(rotated.sessionId).toBe('session-2026-05-24-0915')
    expect(readdirSync(dir)).toContain('session-2026-05-23-1432') // previous preserved
    expect(readdirSync(dir)).toContain('session-2026-05-24-0915')
    expect(readCurrentSessionFile(dir)).toBe('session-2026-05-24-0915')
  })

  it('returns previousSessionId', () => {
    resolveCurrentSession(dir, { now: () => new Date(Date.UTC(2026, 4, 23, 14, 32)) })
    const rotated = rotateSession(dir, { now: () => new Date(Date.UTC(2026, 4, 24, 9, 15)) })
    expect(rotated.previousSessionId).toBe('session-2026-05-23-1432')
  })
})

describe('ensureSession', () => {
  it('creates the session subdir if missing without touching the marker', () => {
    const sessionId = 'session-explicit'
    ensureSession(dir, sessionId)
    expect(readdirSync(dir)).toContain(sessionId)
    expect(readCurrentSessionFile(dir)).toBe(null)
  })
})
