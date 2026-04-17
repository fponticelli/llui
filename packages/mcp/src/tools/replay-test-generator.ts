export function generateReplayTest(
  trace: {
    component: string
    entries: Array<{ msg: unknown; expectedState: unknown; expectedEffects: unknown[] }>
  },
  importPath: string,
  exportName: string,
): string {
  const traceJson = JSON.stringify(
    {
      lluiTrace: 1,
      component: trace.component,
      generatedBy: 'llui-mcp',
      timestamp: new Date().toISOString(),
      entries: trace.entries,
    },
    null,
    2,
  )
  return `import { it, expect } from 'vitest'
import { replayTrace } from '@llui/test'
import { ${exportName} } from '${importPath}'

// Auto-generated from a debugging session via llui_replay_trace MCP tool.
// Edit the trace below to trim, reorder, or adjust expected state/effects.
const trace = ${traceJson} as const

it('${trace.component}: replays ${trace.entries.length} recorded message${trace.entries.length === 1 ? '' : 's'}', () => {
  expect(() => replayTrace(${exportName}, trace as Parameters<typeof replayTrace>[1])).not.toThrow()
})
`
}
