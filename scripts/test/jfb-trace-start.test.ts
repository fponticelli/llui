import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { patchJfbTimelineSource, traceEventsAfterTracingStarted } from '../lib/jfb-trace-start'

const upstreamSource = `import { readFile } from "node:fs/promises";
import { writeResults } from "./writeResults.js";

async function cpu() {
  let entries = json["traceEvents"];
}

async function detail() {
  let entries = json["traceEvents"];
}
`

describe('Chrome trace-start compatibility patch', () => {
  it('drops buffered events before Chrome reports that tracing began', () => {
    const fixture = JSON.parse(
      readFileSync(
        resolve(
          import.meta.dirname,
          '../../benchmarks/jfb-patches/chrome-trace-start.fixture.json',
        ),
        'utf8',
      ),
    ) as { traceEvents: Array<{ name: string; ts: number }> }

    const filtered = traceEventsAfterTracingStarted(fixture.traceEvents)

    expect(filtered.map((event) => event.ts)).toEqual([1000, 1090, 1100, 1121, 1140])
  })

  it('patches both trace consumers idempotently', () => {
    const once = patchJfbTimelineSource(upstreamSource)
    const twice = patchJfbTimelineSource(once)

    expect(once).toContain('// === llui-chrome-trace-start:begin ===')
    expect(once.match(/traceEventsAfterTracingStarted\(json\["traceEvents"\]\)/g)).toHaveLength(2)
    expect(twice).toBe(once)
  })

  it('rejects an upstream shape that no longer has both trace consumers', () => {
    expect(() =>
      patchJfbTimelineSource(
        upstreamSource.replace(
          '\nasync function detail() {\n  let entries = json["traceEvents"];\n}\n',
          '',
        ),
      ),
    ).toThrow(/expected exactly two trace consumers/)
  })
})
