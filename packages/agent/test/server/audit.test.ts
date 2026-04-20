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
})
