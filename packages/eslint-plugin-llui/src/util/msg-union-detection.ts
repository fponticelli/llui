import { AST_NODE_TYPES, ESLintUtils, TSESTree } from '@typescript-eslint/utils'
import * as ts from 'typescript'

/**
 * The shape `ESLintUtils.getParserServices` hands back when typed
 * lint is configured. Inlined to avoid a direct dependency on
 * `@typescript-eslint/typescript-estree` (the public surface only
 * re-exports the type via the `utils/ts-estree` entry, which isn't
 * stable across versions in the installed package layout).
 */
interface ParserServicesWithTypeInformation {
  program: ts.Program
  esTreeNodeToTSNodeMap: { get(node: TSESTree.Node): ts.Node }
}

/**
 * Hint suffix appended to error messages when typed-lint isn't
 * configured. Cross-file Msg detection requires
 * `parserOptions.projectService: true` (or `parserOptions.project`)
 * to resolve symbols across files. Without it, the rules fall back to
 * a same-file heuristic that can miss Msg unions declared in a
 * separate file with an unconventional name.
 *
 * Exported so multiple rules append the same wording — keeps the
 * upgrade path consistent across error messages.
 */
export const TYPED_LINT_HINT =
  ' Tip: enable `parserOptions.projectService: true` (or `parserOptions.project`) so this rule and `agent-missing-intent` can resolve Msg unions across files.'

/**
 * Decide whether a type alias is "definitely" or "probably" an LLui
 * Msg union, using typed-lint when available and falling back to a
 * single same-file heuristic otherwise.
 *
 * Resolution priority:
 *
 * 1. **Typed lint (definitive, cross-file).** When `parserOptions.project`
 *    is configured, we resolve the alias to its TypeScript symbol and
 *    check it against the *project-wide* set of symbols passed to
 *    `component<S, M, E>()`. This catches Msg unions declared in a
 *    different file from the call site, regardless of name. Project
 *    walk happens once per `ts.Program` and is cached.
 *
 * 2. **Same-file `component<S, M, E>()` arg name (untyped fallback).**
 *    Without typed lint we can still definitively say "this name is
 *    used as a Msg argument *in this file*" by looking at every
 *    `component()` call's type arguments. Catches the common case of
 *    co-located `type Foo = ...` + `component<S, Foo, E>(...)`.
 *
 * Name-based conventions (`name === 'Msg'`, `name.endsWith('Msg')`)
 * were dropped: they produce false positives on unrelated types ending
 * in `Msg` and add zero coverage that typed lint doesn't already give.
 *
 * Residual gap (without typed lint): Msg union declared in a separate
 * file and named arbitrarily (e.g. `type Action = ...`). The lint rule
 * running on that file has no signal. The fix is to enable typed lint
 * — `parserOptions.project: true` is enough.
 */

export interface MsgUnionDetectionContext {
  /**
   * Set of identifier names that appear as the M argument of a
   * `component<S, M, E>()` call *in the same file* being linted.
   * Always populated; works without typed lint.
   */
  sameFileMsgArgNames: Set<string>
  /**
   * When typed lint is available, the set of *symbols* used as the M
   * argument across the entire `ts.Program`. Resolves to the
   * underlying type alias regardless of how it was imported or named
   * locally. `undefined` means typed lint isn't configured; callers
   * should not treat absence as "no Msg unions in the project".
   */
  projectMsgArgSymbols: ReadonlySet<ts.Symbol> | undefined
  /**
   * Parser services when typed lint is on; `null` otherwise. Used to
   * resolve the alias's symbol for the project-wide check.
   */
  services: ParserServicesWithTypeInformation | null
}

export function isLikelyMsgUnion(
  node: TSESTree.TSTypeAliasDeclaration,
  ctx: MsgUnionDetectionContext,
): boolean {
  if (node.id.type !== AST_NODE_TYPES.Identifier) return false
  const name = node.id.name

  // 1. Typed-lint definitive check (cross-file).
  if (ctx.services && ctx.projectMsgArgSymbols) {
    const tsNode = ctx.services.esTreeNodeToTSNodeMap.get(node)
    if (ts.isTypeAliasDeclaration(tsNode)) {
      const checker = ctx.services.program.getTypeChecker()
      // The alias's own symbol is on its name node.
      const symbol = checker.getSymbolAtLocation(tsNode.name)
      if (symbol && ctx.projectMsgArgSymbols.has(symbol)) return true
    }
    // Don't return false here — fall through to the same-file heuristic
    // so the rule still fires on `type Foo` co-located with
    // `component<S, Foo, E>()` even if our project walk missed an edge
    // case (re-exports, generic instantiation, etc.).
  }

  // 2. Same-file component-arg name (works without typed lint).
  if (ctx.sameFileMsgArgNames.has(name)) return true

  return false
}

/**
 * Collect identifiers used as the M argument of any `component<...>()`
 * call in this file. The Program visitor in each rule populates this
 * set once per file and reuses for every alias check.
 */
export function collectComponentMsgArgNames(program: TSESTree.Program): Set<string> {
  const out = new Set<string>()
  const seen = new WeakSet<object>()

  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (seen.has(node as object)) return
    seen.add(node as object)

    if ('type' in node && (node as TSESTree.Node).type === AST_NODE_TYPES.CallExpression) {
      const call = node as TSESTree.CallExpression
      if (
        call.callee.type === AST_NODE_TYPES.Identifier &&
        call.callee.name === 'component' &&
        call.typeArguments
      ) {
        const msgArg = call.typeArguments.params[1]
        if (
          msgArg &&
          msgArg.type === AST_NODE_TYPES.TSTypeReference &&
          msgArg.typeName.type === AST_NODE_TYPES.Identifier
        ) {
          out.add(msgArg.typeName.name)
        }
      }
    }

    if (Array.isArray(node)) {
      for (const c of node) visit(c)
      return
    }
    for (const key of Object.keys(node)) {
      // Skip back-pointer + non-AST keys to avoid cycles.
      if (key === 'parent' || key === 'loc' || key === 'range') continue
      visit((node as Record<string, unknown>)[key])
    }
  }

  visit(program)
  return out
}

/**
 * Walk every TypeScript source file in the program, find every
 * `component<S, M, E>(...)` call, and collect the *symbols* of the
 * type arguments at position M. Returned set is a cache key — symbol
 * identity from `ts.TypeChecker` matches across files, so a Msg
 * union declared in `msg.ts` and used as `component<S, Msg, E>` in
 * `app.ts` produces a single symbol that we can compare against any
 * type alias we visit during linting.
 *
 * Cached on the program via a WeakMap so subsequent calls (e.g. for
 * different rules linting the same file, or repeated rule invocations
 * on the same program) reuse the work.
 */
const programMsgSymbolsCache = new WeakMap<ts.Program, Set<ts.Symbol>>()

export function findProjectMsgArgSymbols(
  services: ParserServicesWithTypeInformation,
): Set<ts.Symbol> {
  const program = services.program
  const cached = programMsgSymbolsCache.get(program)
  if (cached) return cached

  const checker = program.getTypeChecker()
  const out = new Set<ts.Symbol>()

  for (const sourceFile of program.getSourceFiles()) {
    // Skip declaration files and node_modules — Msg unions don't live
    // in `*.d.ts` typically, and walking node_modules is a perf hit
    // for zero benefit.
    if (sourceFile.isDeclarationFile) continue
    if (sourceFile.fileName.includes('/node_modules/')) continue

    visitForComponentCalls(sourceFile, checker, out)
  }

  programMsgSymbolsCache.set(program, out)
  return out
}

function visitForComponentCalls(node: ts.Node, checker: ts.TypeChecker, out: Set<ts.Symbol>): void {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'component' &&
    node.typeArguments
  ) {
    const msgArg = node.typeArguments[1]
    if (msgArg && ts.isTypeReferenceNode(msgArg) && ts.isIdentifier(msgArg.typeName)) {
      const sym = checker.getSymbolAtLocation(msgArg.typeName)
      if (sym) {
        // For aliased imports (`import { Msg as M } from './msg'`) the
        // local symbol points at the import alias; resolve to the
        // underlying declaration symbol so it matches the alias's own
        // symbol when we visit it later.
        const resolved = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym
        out.add(resolved)
      }
    }
  }
  ts.forEachChild(node, (child) => {
    visitForComponentCalls(child, checker, out)
  })
}

/**
 * Produce a `MsgUnionDetectionContext` for one rule invocation.
 * Wraps the typed-lint setup so individual rules don't have to repeat
 * the parserServices probing.
 */
export function buildMsgUnionDetectionContext(
  context: TSESTreeRuleContext,
  program: TSESTree.Program,
): MsgUnionDetectionContext {
  const sameFileMsgArgNames = collectComponentMsgArgNames(program)
  const services = ESLintUtils.getParserServices(context, /* allowWithoutTypeInfo */ true)
  // typed-lint may be configured (`program` is a `ts.Program`) or absent
  // (`program` is `null`). Distinguish strictly by truthiness — the
  // type definitions allow either depending on the second arg.
  const program_ = (services as { program: ts.Program | null }).program
  const typed: ParserServicesWithTypeInformation | null = program_
    ? (services as unknown as ParserServicesWithTypeInformation)
    : null
  const projectMsgArgSymbols = typed ? findProjectMsgArgSymbols(typed) : undefined
  return { sameFileMsgArgNames, projectMsgArgSymbols, services: typed }
}

// Minimal type for the ESLint Rule context — duplicated to avoid the
// rule-specific message-id generic that would force every rule to
// declare its own typed alias. Both rules using this util pass
// compatible shapes.
type TSESTreeRuleContext = Parameters<typeof ESLintUtils.getParserServices>[0]
