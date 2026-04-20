import type { AuditEntry } from '../protocol.js'

export type AuditSink = {
  write: (entry: AuditEntry) => void | Promise<void>
}

export const consoleAuditSink: AuditSink = {
  write(entry) {
    process.stdout.write(JSON.stringify(entry) + '\n')
  },
}
