// Privacy seams — per-channel redaction hooks + prod-safe capture defaults.
//
// The HUD does not decide what's sensitive; the host does (decision: "host
// owns privacy"). We make every channel that can carry user data
// interceptable before it's persisted, and we default the heavy channels OFF
// in production so a host that wires nothing still leaks nothing.

import type { NoteBody, ReproEvent } from './note-types.js'

/**
 * Per-channel sanitize hooks, each run just before a capture is persisted.
 * Separate channels so a host can drop only the risky one rather than
 * all-or-nothing.
 */
export interface RedactHooks {
  /** Transform the debug-telemetry body (per-component state snapshot,
   *  message/effect logs, dirty trace, …). Return a replacement, e.g.
   *  `{}` to drop it entirely or a copy with `stateSnapshot` removed. */
  state?: (body: NoteBody) => NoteBody
  /** Transform recorded interactions (e.g. mask typed input values). Return
   *  `[]` to drop the repro trace. */
  repro?: (events: ReproEvent[]) => ReproEvent[]
  /** Transform the screenshot (base64 PNG, no `data:` prefix) — e.g. mask
   *  regions. Return `null` to drop the screenshot entirely. */
  screenshot?: (pngBase64: string) => string | null
}

export interface CaptureDefaults {
  /** Collect the verbose debug-telemetry body (state/message/effect dump). */
  debug: boolean
  /** Record user interactions (repro trace). */
  repro: boolean
}

/**
 * Resolve which capture channels are on. Heavy, potentially-sensitive
 * channels (debug telemetry, interaction recording) default ON in dev and
 * OFF in production; the host opts in explicitly per channel.
 */
export function resolveCaptureDefaults(
  isDev: boolean,
  opts: { captureDebug?: boolean; repro?: boolean },
): CaptureDefaults {
  return {
    debug: opts.captureDebug ?? isDev,
    repro: opts.repro ?? isDev,
  }
}

export function redactState(body: NoteBody, hook?: RedactHooks['state']): NoteBody {
  return hook ? hook(body) : body
}

/** Built-in secret shapes masked by {@link defaultSecretRedactor}. */
const DEFAULT_SECRET_PATTERNS: readonly RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, // Authorization bearer tokens
  /\bsk-[A-Za-z0-9]{16,}\b/g, // OpenAI-style secret keys
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, // JWTs
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, // email addresses
]

export interface SecretRedactorOptions {
  /** Extra regexes whose matches are masked (added to the built-ins). */
  patterns?: readonly RegExp[]
  /** Replacement token. Default `'[redacted]'`. */
  mask?: string
  /** Max recursion depth for the state walk. Default 12. */
  maxDepth?: number
}

/**
 * An **opt-in** convenience redactor for the `state` channel: deep-walks
 * the captured `stateSnapshot` / message+console logs and masks common
 * secret shapes (Bearer tokens, `sk-`/`ghp_` keys, JWTs, emails) in
 * string values. A defense-in-depth default a host can plug in
 * (`redact: { state: defaultSecretRedactor() }`); it does NOT replace
 * authoring-time care — the host still owns what's sensitive. State is
 * JSON-serializable (no cycles) by the framework contract; a depth cap
 * guards pathological inputs.
 */
export function defaultSecretRedactor(
  options: SecretRedactorOptions = {},
): (body: NoteBody) => NoteBody {
  const mask = options.mask ?? '[redacted]'
  const maxDepth = options.maxDepth ?? 12
  const patterns = [...DEFAULT_SECRET_PATTERNS, ...(options.patterns ?? [])]

  const maskString = (s: string): string => patterns.reduce((acc, re) => acc.replace(re, mask), s)

  const scrub = (value: unknown, depth: number): unknown => {
    if (typeof value === 'string') return maskString(value)
    if (depth >= maxDepth || value === null || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1))
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const scrubbed = scrub(v, depth + 1)
      // Copy reserved keys as plain data, never via the prototype setter.
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
        Object.defineProperty(out, k, {
          value: scrubbed,
          writable: true,
          enumerable: true,
          configurable: true,
        })
      } else {
        out[k] = scrubbed
      }
    }
    return out
  }

  return (body) => ({
    ...body,
    ...(body.stateSnapshot !== undefined ? { stateSnapshot: scrub(body.stateSnapshot, 0) } : {}),
    ...(body.messageLog ? { messageLog: scrub(body.messageLog, 0) as NoteBody['messageLog'] } : {}),
    ...(body.consoleLog ? { consoleLog: scrub(body.consoleLog, 0) as NoteBody['consoleLog'] } : {}),
    // Effects carry request payloads / headers (e.g. an in-flight `http`
    // effect with an `Authorization: Bearer …` header) — scrub the pending +
    // recent lists with the same deep walk so tokens don't leak through the
    // one channel the redactor previously skipped.
    ...(body.effects ? { effects: scrub(body.effects, 0) as NoteBody['effects'] } : {}),
  })
}

export function redactRepro(events: ReproEvent[], hook?: RedactHooks['repro']): ReproEvent[] {
  return hook ? hook(events) : events
}

/** Returns the (possibly transformed) base64 PNG, or null to drop it. */
export function redactScreenshot(
  pngBase64: string,
  hook?: RedactHooks['screenshot'],
): string | null {
  return hook ? hook(pngBase64) : pngBase64
}
