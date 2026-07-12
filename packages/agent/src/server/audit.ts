import type { AuditEntry } from '../protocol.js'

export type AuditSink = {
  write: (entry: AuditEntry) => void | Promise<void>
}

/**
 * Default audit sink — RUNTIME-NEUTRAL. `createLluiAgentCore` lives in
 * the `node:*`-free core targeted at Cloudflare Workers / Deno as well as
 * Node, so the default sink must not assume `process.stdout` exists (a
 * Worker isolate has no `process.stdout`; touching it would throw and
 * turn a `/agent/mint` into a 500).
 *
 * Prefers Node's real `process.stdout` when present (keeps JSONL on the
 * true stdout stream for log shippers), and falls back to
 * `globalThis.console.log` on runtimes without it.
 */
export const consoleAuditSink: AuditSink = {
  write(entry) {
    const line = JSON.stringify(entry)
    const proc = (globalThis as { process?: { stdout?: { write?: (s: string) => void } } }).process
    const stdoutWrite = proc?.stdout?.write
    if (typeof stdoutWrite === 'function') {
      stdoutWrite.call(proc!.stdout, line + '\n')
    } else {
      globalThis.console.log(line)
    }
  },
}
