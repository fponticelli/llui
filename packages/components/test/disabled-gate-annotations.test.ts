import { describe, it, expect } from 'vitest'
import { parseModule, extractMsgAnnotations } from '@llui/compiler'
import type { MessageAnnotations } from '@llui/compiler'

declare global {
  // vite/vitest provide `import.meta.glob`; declare the narrow shape we use so the
  // type-check (raw tsc, no vite/client types) passes — same as
  // @llui/markdown's commonmark import-graph test.
  interface ImportMeta {
    glob(
      pattern: string,
      opts: { query: string; import: string; eager: true },
    ): Record<string, string>
  }
}

/**
 * The four components with a `disabled` gate carry TWO classifications of the
 * same message set: the runtime `PROGRAMMATIC` allow-list, and the `@intent` /
 * `@humanOnly` JSDoc the agent protocol reads. They answer different questions —
 * "does this survive the disabled gate" versus "may an agent dispatch this at
 * all" — but they contradicted each other in three ways, and a contradiction is
 * a promise the package cannot keep (#138 review, blocking 3 + item 9):
 *
 *  1. `setDisabled` was `@humanOnly` in all four, so `protocol.ts` REJECTS an
 *     agent's `/message` for it with reason `'human-only'`. That is precisely
 *     the caller #120 exists for: "a disabled instance can never be re-enabled
 *     … by an agent" stayed true while the source comment three lines below the
 *     allow-list called these "the host's or an agent's programmatic writes".
 *  2. A gated variant (`increment`, `commit`, `toggleAmPm`, …) advertised a
 *     bare `@intent`, so an agent was told it could step a disabled input and
 *     was then silently swallowed. Those intents now state the precondition.
 *
 * The gate cannot be DERIVED from the annotations — JSDoc is erased before the
 * reducer runs, and `@llui/components` is a plain library with no compiled
 * `$ma` metadata — so the annotations were fixed instead, and this test pins
 * their agreement using the compiler's own extractor rather than a second
 * reading of the grammar.
 */

// Sources read through vite's `?raw` glob — the repo's way of reading source
// text in a test without pulling in node:fs types (see @llui/markdown's
// commonmark import-graph test).
const RAW = import.meta.glob('../src/components/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
})

function source(file: string): string {
  const entry = Object.entries(RAW).find(([p]) => p.endsWith(`/${file}.ts`))
  if (!entry) throw new Error(`source not found: ${file}.ts`)
  return entry[1]
}

function annotations(file: string, typeName: string): Record<string, MessageAnnotations> {
  const mod = parseModule(`${file}.ts`, source(file))
  const extracted = extractMsgAnnotations(mod, typeName)
  expect(extracted, `no Msg union found in ${file}.ts`).not.toBeNull()
  return extracted!
}

/** The runtime allow-list, read from the source it is declared in. */
function programmatic(file: string): Set<string> {
  const decl = /const PROGRAMMATIC[^=]*=\s*new Set\(\[?([\s\S]*?)\]?\)/.exec(source(file))
  expect(decl, `no PROGRAMMATIC declaration in ${file}.ts`).not.toBeNull()
  return new Set([...decl![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!))
}

const GATED = [
  { file: 'number-input', msg: 'NumberInputMsg', gates: ['disabled', 'readonly'] },
  { file: 'slider', msg: 'SliderMsg', gates: ['disabled'] },
  { file: 'time-picker', msg: 'TimePickerMsg', gates: ['disabled'] },
  { file: 'pin-input', msg: 'PinInputMsg', gates: ['disabled'] },
] as const

describe('the disabled gate agrees with the agent annotations', () => {
  for (const { file, msg, gates } of GATED) {
    describe(file, () => {
      it('every message that survives the gate is agent-dispatchable', () => {
        const ann = annotations(file, msg)
        const blocked = [...programmatic(file)].filter((t) => ann[t]?.dispatchMode === 'human-only')
        expect(blocked).toEqual([])
      })

      it('setDisabled is agent-dispatchable — #120 is about re-enabling BY AN AGENT', () => {
        const ann = annotations(file, msg)
        expect(ann['setDisabled']).toBeDefined()
        expect(ann['setDisabled']!.dispatchMode).toBe('shared')
        expect(ann['setDisabled']!.intent).not.toBeNull()
      })

      it('every gated variant an agent may still send documents the precondition', () => {
        const ann = annotations(file, msg)
        const allow = programmatic(file)
        const undocumented = Object.entries(ann)
          .filter(([type, a]) => !allow.has(type) && a.dispatchMode !== 'human-only')
          .filter(([, a]) => !gates.every((g) => (a.intent ?? '').includes(g)))
          .map(([type]) => type)
        expect(undocumented).toEqual([])
      })
    })
  }
})
