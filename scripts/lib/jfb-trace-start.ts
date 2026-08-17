interface TraceEventBoundary {
  readonly name?: unknown
  readonly ts?: unknown
}

const BEGIN_MARKER = '// === llui-chrome-trace-start:begin ==='
const END_MARKER = '// === llui-chrome-trace-start:end ==='
const UPSTREAM_CONSUMER = 'let entries = json["traceEvents"];'
const PATCHED_CONSUMER = 'let entries = traceEventsAfterTracingStarted(json["traceEvents"]);'
const IMPORT_ANCHOR = 'import { writeResults } from "./writeResults.js";'

const PATCH_HELPER = `${BEGIN_MARKER}
// Chrome 150 can include buffered renderer events from before Tracing.start.
// Respect Chrome's own boundary so warm-up clicks cannot enter a measurement.
function traceEventsAfterTracingStarted(entries: any[]): any[] {
  const starts = entries
    .filter((event) => event.name === "TracingStartedInBrowser")
    .map((event) => Number(event.ts))
    .filter(Number.isFinite);
  if (starts.length === 0) return entries;
  const start = Math.max(...starts);
  return entries.filter((event) => event.ts === undefined || Number(event.ts) >= start);
}
${END_MARKER}`

export function traceEventsAfterTracingStarted<T extends TraceEventBoundary>(
  entries: readonly T[],
): T[] {
  const starts = entries
    .filter((event) => event.name === 'TracingStartedInBrowser')
    .map((event) => Number(event.ts))
    .filter(Number.isFinite)
  if (starts.length === 0) return [...entries]
  const start = Math.max(...starts)
  return entries.filter((event) => event.ts === undefined || Number(event.ts) >= start)
}

export function patchJfbTimelineSource(source: string): string {
  const markerPattern = new RegExp(
    `(?:\\r?\\n)*${escapeRegex(BEGIN_MARKER)}[\\s\\S]*?${escapeRegex(END_MARKER)}(?:\\r?\\n)*`,
    'g',
  )
  const normalized = source
    .replace(markerPattern, '\n\n')
    .replaceAll(PATCHED_CONSUMER, UPSTREAM_CONSUMER)
  const consumers = normalized.split(UPSTREAM_CONSUMER).length - 1
  if (consumers !== 2) {
    throw new Error(`expected exactly two trace consumers in JFB timeline.ts, found ${consumers}`)
  }

  const anchor = normalized.indexOf(IMPORT_ANCHOR)
  if (anchor < 0) throw new Error('JFB timeline.ts import anchor changed')
  const insertionPoint = anchor + IMPORT_ANCHOR.length
  const withHelper =
    normalized.slice(0, insertionPoint) + `\n\n${PATCH_HELPER}` + normalized.slice(insertionPoint)
  return withHelper.replaceAll(UPSTREAM_CONSUMER, PATCHED_CONSUMER)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
