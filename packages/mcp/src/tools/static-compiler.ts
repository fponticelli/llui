import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { transformSignalComponentSource, collectDeps } from '@llui/compiler'
import type { ToolRegistry } from '../tool-registry.js'

/**
 * v2c §4 — MCP static-mode tools.
 *
 * Adapter over the @llui/compiler engine. Live-mode tools (in
 * `tools/compiler.ts`) call into the running runtime via `ctx.relay`;
 * static-mode tools answer the same questions from source. Useful when
 * no app is running (CI, code-review LLMs, offline analysis), and as a
 * sanity check that live answers match what the compiler would produce.
 *
 * Naming: every static tool carries the `llui_static_` prefix to keep
 * the live/static surface explicit. Tools that fundamentally need
 * runtime state (binding indices, message history, DOM trees) stay
 * live-only.
 *
 * The dispatch table in `index.ts` does NOT prefer-live-when-available
 * yet — both variants ship as distinct tool names. Future v2c work
 * unifies them under one tool that picks the right backend; this push
 * keeps them separate so the contract is observable.
 */
export function registerStaticCompilerTools(registry: ToolRegistry): void {
  registry.register(
    {
      name: 'llui_static_show_compiled',
      description:
        'Static counterpart of `llui_show_compiled`. Read a source file from disk and return its pre-transform source plus the post-transform output @llui/compiler would produce. Works without a running app.',
      schema: z.object({
        file: z
          .string()
          .describe(
            'Absolute or workspace-relative path to a .ts/.tsx file. Reads the file from disk and runs the compiler transform on it.',
          ),
      }),
    },
    'compiler',
    async (args) => {
      const absPath = resolve(args.file)
      let source: string
      try {
        source = readFileSync(absPath, 'utf8')
      } catch (err) {
        return {
          pre: null,
          post: null,
          error: `Could not read file: ${(err as Error).message}`,
        }
      }
      const output = transformSignalComponentSource(source, {
        emitAgentMetadata: true,
        fileName: absPath,
      })
      // The signal transform returns the source unchanged when the file has
      // no signal `component()` to lower; surface that as a no-op note.
      if (output === source) {
        return {
          pre: source,
          post: null,
          note: 'File contains no @llui/dom component / no reactive content; nothing to transform.',
        }
      }
      return { pre: source, post: output }
    },
  )

  registry.register(
    {
      name: 'llui_static_collect_paths',
      description:
        'Return the reactive state-access dependency paths the @llui/compiler would extract from a file (the paths the runtime gates each binding on), with a per-top-level-field breakdown. Companion to `llui_explain_mask` (live) — works without a running app, useful for understanding why a binding does/does not pick up a state change. `opaque` is true when an unresolvable accessor forced whole-state coarsening.',
      schema: z.object({
        file: z.string().describe('Absolute or workspace-relative path to a .ts/.tsx file.'),
      }),
    },
    'compiler',
    async (args) => {
      const absPath = resolve(args.file)
      let source: string
      try {
        source = readFileSync(absPath, 'utf8')
      } catch (err) {
        return {
          paths: [],
          error: `Could not read file: ${(err as Error).message}`,
        }
      }
      const { paths, opaque } = collectDeps(source)
      const sorted = [...paths].sort()

      // Top-level field rollup so callers can see which slices dominate.
      const byTopLevel = new Map<string, number>()
      for (const p of sorted) {
        const top = p.split('.', 1)[0]!
        byTopLevel.set(top, (byTopLevel.get(top) ?? 0) + 1)
      }
      const breakdown = [...byTopLevel.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([field, count]) => ({ field, count }))

      return {
        total: sorted.length,
        opaque,
        breakdown,
        paths: sorted,
      }
    },
  )
}
