// CompilerModule + ModuleRegistry — v2c §2 visitor-registry primitive.
//
// Modules accumulate findings during a single AST walk per file and
// contribute emissions after the walk completes. The walker visits each
// node once; every module registered for that node's SyntaxKind sees it.
//
// This file defines the interfaces + the registry. The actual modules
// (`compiler-core`, `compiler-agent`, `compiler-ssr`, `compiler-devtools`)
// will consume them; for v2c-partial only the primitive lands, and one
// proof-of-concept module exercises it.
//
// Design contract (v2c.md §2.1):
//   - Modules NEVER walk the AST themselves — only the registry walks.
//     This keeps the cost O(nodes), not O(modules × nodes).
//   - Visitor order for a given SyntaxKind is the declaration order in
//     `llui.config.ts`'s `modules: [...]` array. Observable to module
//     authors. Alphabetical-by-name was rejected (couples correctness
//     to package names).
//   - Emission conflicts (two modules writing to the same field) are
//     a hard error, not a silent overwrite. Each module owns disjoint
//     output fields.
//   - `runtimeImports` arrays merge by union (deduplicated). Multiple
//     modules requesting the same runtime helper collapse to one
//     import.

import ts from 'typescript'
import type { Diagnostic } from './diagnostic.js'

// ── Module interface ────────────────────────────────────────────────

export interface DiagnosticDefinition {
  /** Stable id, e.g. `llui/opaque-view-call`. Per v2c §3 §8.2. */
  id: string
  /** One-line description; useful for adapter UIs that don't render the message. */
  description: string
}

/**
 * Per-file analysis output. Modules accumulate findings here during
 * visitor dispatch; emit consumes it. The shape is intentionally
 * open-ended — modules name their own slots and the umbrella's
 * orchestrator never inspects them, only forwards.
 */
export interface FileAnalysis {
  /** Source file the analysis ran over. */
  sourceFile: ts.SourceFile
  /** Per-module accumulator buckets, keyed by module name. */
  perModule: Map<string, unknown>
  /** Diagnostics emitted during the walk. */
  diagnostics: Diagnostic[]
}

/**
 * Context passed to every visitor invocation. Modules use it to record
 * findings, emit diagnostics, and consult shared state (the TS
 * Compiler-API checker, the project root, sibling-module findings if
 * dependencies allow).
 */
export interface AnalysisContext {
  sourceFile: ts.SourceFile
  /** TS TypeChecker, when the host adapter has built a Program. May be undefined for AST-only paths. */
  checker: ts.TypeChecker | undefined
  /**
   * Get the named module's accumulator slot (creating it lazily). The
   * slot is whatever shape the module wrote; type-safe access is the
   * module author's responsibility — typically via a typed `get<T>()`
   * wrapper exported alongside the module.
   */
  getSlot<T>(moduleName: string, init: () => T): T
  /** Record a diagnostic. The diagnostic's `id` should match one declared in `DiagnosticDefinition[]`. */
  reportDiagnostic(d: Diagnostic): void
}

export interface EmissionContribution {
  /** Module emitting this contribution — used for conflict reporting. */
  module: string
  /** Field name on the `ComponentDef` object literal (e.g. `__msgSchema`). */
  field: string
  /** AST expression to assign. The umbrella merges into the component()'s config arg. */
  value: ts.Expression
  /**
   * Optional per-call target. When set, this contribution applies only
   * to the named `component()` call expression; the umbrella's
   * emission-merger writes the field into that call's config-arg
   * object literal. When omitted, the contribution is *file-global*:
   * the merger writes the field into every `component()` call in the
   * file (the common case — `__msgSchema`, `__prefixes`, `__schemaHash`
   * are file-shape-derived).
   *
   * Per-call target is needed for `__componentMeta` (file + line vary
   * per call site) and any other field whose value depends on the
   * specific `component()` call location.
   *
   * Conflict-detection runs per-(field, target) tuple — two modules
   * may both contribute `__custom` if they target *different* call
   * expressions; same target on the same field is still an error.
   */
  target?: ts.CallExpression
}

export interface EmissionContext {
  sourceFile: ts.SourceFile
  factory: ts.NodeFactory
}

/**
 * A compiler module declares:
 *   - identification (name, compilerVersion semver against the umbrella);
 *   - the diagnostics it can emit (stable IDs);
 *   - per-`SyntaxKind` visitor handlers (the walker dispatches each AST
 *     node once; every module with a handler for its kind sees it);
 *   - optionally, an `emit` function that contributes ComponentDef fields
 *     after the walk completes;
 *   - optionally, `runtimeImports` declaring which `@llui/dom` symbols
 *     its emissions reference.
 */
export interface CompilerModule {
  name: string
  /** Semver range against the compiler API. v2c §5. */
  compilerVersion: string
  /** Modules this one depends on. The registry verifies presence at activation. */
  dependsOn?: string[]
  diagnostics: DiagnosticDefinition[]
  visitors: {
    [K in ts.SyntaxKind]?: (ctx: AnalysisContext, node: ts.Node) => void
  }
  /** Called once per file after the visitor pass completes. Returns this module's emission contributions. */
  emit?(ctx: EmissionContext, analysis: FileAnalysis): EmissionContribution[]
  /** Runtime symbol names this module's emissions reference (from `@llui/dom`). */
  runtimeImports?: string[]
}

// ── Registry ────────────────────────────────────────────────────────

export interface RegistryRunResult {
  analysis: FileAnalysis
  emissions: EmissionContribution[]
  /** Union of runtime imports from every active module. */
  runtimeImports: string[]
}

/**
 * The visitor registry. Built once per compiler boot from the user's
 * `llui.config.ts` `modules: [...]` array; the umbrella's per-file
 * pipeline calls `run(sourceFile, checker)` to drive a complete pass.
 */
export class ModuleRegistry {
  private readonly modules: ReadonlyArray<CompilerModule>
  /** Pre-indexed by SyntaxKind for O(1) dispatch. */
  private readonly visitorsByKind: Map<ts.SyntaxKind, Array<CompilerModule>>

  constructor(modules: ReadonlyArray<CompilerModule>) {
    this.modules = modules
    this.verifyDependencies()
    this.visitorsByKind = this.buildVisitorIndex()
  }

  private verifyDependencies(): void {
    const present = new Set(this.modules.map((m) => m.name))
    for (const m of this.modules) {
      for (const dep of m.dependsOn ?? []) {
        if (!present.has(dep)) {
          throw new Error(
            `[llui] module "${m.name}" depends on "${dep}", which is not in the active module list. ` +
              `Add ${dep}() to your llui.config.ts modules array (must appear before "${m.name}"). ` +
              `See docs/proposals/v2-compiler/v2c.md §2.4.`,
          )
        }
      }
    }
  }

  private buildVisitorIndex(): Map<ts.SyntaxKind, Array<CompilerModule>> {
    const index = new Map<ts.SyntaxKind, Array<CompilerModule>>()
    for (const m of this.modules) {
      for (const kindStr of Object.keys(m.visitors)) {
        const kind = Number(kindStr) as ts.SyntaxKind
        if (!index.has(kind)) index.set(kind, [])
        index.get(kind)!.push(m)
      }
    }
    return index
  }

  /**
   * Run a full analysis + emission pass over `sourceFile`. Walks the
   * AST once, dispatching each node to every registered handler; then
   * calls each module's `emit` and merges contributions, detecting
   * conflicts.
   */
  run(sourceFile: ts.SourceFile, checker?: ts.TypeChecker): RegistryRunResult {
    const analysis: FileAnalysis = {
      sourceFile,
      perModule: new Map(),
      diagnostics: [],
    }
    const ctx: AnalysisContext = {
      sourceFile,
      checker,
      getSlot: <T>(name: string, init: () => T): T => {
        let slot = analysis.perModule.get(name) as T | undefined
        if (slot === undefined) {
          slot = init()
          analysis.perModule.set(name, slot)
        }
        return slot
      },
      reportDiagnostic: (d) => {
        analysis.diagnostics.push(d)
      },
    }

    // Single-pass walk. For each node, dispatch to every module
    // registered for its SyntaxKind, in module declaration order.
    const walk = (node: ts.Node): void => {
      const handlers = this.visitorsByKind.get(node.kind)
      if (handlers) {
        for (const m of handlers) {
          const handler = m.visitors[node.kind]
          if (handler) handler(ctx, node)
        }
      }
      ts.forEachChild(node, walk)
    }
    walk(sourceFile)

    // Emission pass — each module contributes after analysis completes.
    // Conflicts on a `field` between modules are hard errors per §2.1.
    const emissionCtx: EmissionContext = {
      sourceFile,
      factory: ts.factory,
    }
    const emissions: EmissionContribution[] = []
    // Conflict detection keyed by `(field, target)` — two modules may
    // contribute distinct per-target emissions to the same field name
    // (e.g. component-meta for two different `component()` calls in
    // one file), but two emissions with the same target on the same
    // field is the hard error from §2.1.
    const ownerByKey = new Map<string, string>()
    const keyFor = (c: EmissionContribution): string => {
      const targetId = c.target ? `@${c.target.pos}-${c.target.end}` : '*'
      return `${c.field}${targetId}`
    }
    for (const m of this.modules) {
      if (!m.emit) continue
      const contributions = m.emit(emissionCtx, analysis)
      for (const c of contributions) {
        const k = keyFor(c)
        if (ownerByKey.has(k)) {
          const other = ownerByKey.get(k)!
          throw new Error(
            `[llui/module-emission-conflict] Modules "${other}" and "${c.module}" both ` +
              `contribute to ComponentDef field "${c.field}"${c.target ? ' for the same component() call site' : ''}. ` +
              `This is a hard error — each (field, target) pair must be owned by exactly one ` +
              `module. Either deduplicate, or move one emission to a distinct field. See ` +
              `docs/proposals/v2-compiler/v2c.md §2.1.`,
          )
        }
        ownerByKey.set(k, c.module)
        emissions.push(c)
      }
    }

    // Union runtime imports.
    const runtimeImports = new Set<string>()
    for (const m of this.modules) {
      for (const imp of m.runtimeImports ?? []) runtimeImports.add(imp)
    }

    return {
      analysis,
      emissions,
      runtimeImports: [...runtimeImports].sort(),
    }
  }

  /** Module names in declaration order. Adapters surface this for debug logs / config diagnostics. */
  listModules(): string[] {
    return this.modules.map((m) => m.name)
  }

  /** All diagnostic definitions across active modules. Used by adapters to enumerate stable IDs. */
  listDiagnostics(): DiagnosticDefinition[] {
    return this.modules.flatMap((m) => m.diagnostics)
  }
}
