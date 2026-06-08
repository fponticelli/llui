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
