import { describe, it, expect, vi } from 'vitest'
import { consoleAuditSink } from '../../src/server/audit.js'
import type { AuditEntry } from '../../src/protocol.js'

describe('consoleAuditSink', () => {
  it('writes JSONL to stdout via process.stdout.write by default', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const entry: AuditEntry = {
      at: 12345,
      tid: 't1',
      uid: 'u1',
      event: 'mint',
      detail: { foo: 'bar' },
    }
    consoleAuditSink.write(entry)
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('"event":"mint"'))
    expect(spy).toHaveBeenCalledWith(expect.stringMatching(/\n$/))
    spy.mockRestore()
  })

  it('falls back to console.log (no throw) when process.stdout is unavailable', () => {
    // Regression: the default sink is installed by the runtime-neutral
    // core, which targets Cloudflare Workers / Deno where `process.stdout`
    // does not exist. Touching `process.stdout.write` there threw and
    // turned `/agent/mint` into a 500.
    const stdoutDesc = Object.getOwnPropertyDescriptor(process, 'stdout')
    const logSpy = vi.spyOn(globalThis.console, 'log').mockImplementation(() => {})
    try {
      Object.defineProperty(process, 'stdout', { value: undefined, configurable: true })
      const entry: AuditEntry = { at: 1, tid: 't1', uid: null, event: 'claim', detail: {} }
      expect(() => consoleAuditSink.write(entry)).not.toThrow()
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"event":"claim"'))
    } finally {
      if (stdoutDesc) Object.defineProperty(process, 'stdout', stdoutDesc)
      logSpy.mockRestore()
    }
  })
})
