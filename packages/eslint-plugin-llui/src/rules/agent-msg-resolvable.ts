import { AST_NODE_TYPES, ESLintUtils, TSESTree, type TSESLint } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

type MessageId = 'unresolvable' | 'complexTypeArg' | 'namespaceImport'
type RuleContext = TSESLint.RuleContext<MessageId, []>

/**
 * Hint suffix appended to error messages when typed-lint isn't
 * configured. Cross-file Msg detection (in the companion rules
 * `agent-missing-intent` / `agent-exclusive-annotations`) requires
 * `parserOptions.projectService: true` (or `parserOptions.project`)
 * to resolve symbols across files. The rule itself works without
 * typed-lint by using same-file heuristics; the hint just nudges
 * users toward the more precise mode.
 */
const TYPED_LINT_HINT =
  ' Tip: enable `parserOptions.projectService: true` (or `parserOptions.project`) so this rule and `agent-missing-intent` can resolve Msg unions across files.'

function hasTypedLint(context: RuleContext): boolean {
  const services = ESLintUtils.getParserServices(context, /* allowWithoutTypeInfo */ true)
  // When typed-lint isn't configured, getParserServices returns a
  // services bag with `program: null`. Truthy program means the type
  // checker is wired.
  return Boolean((services as { program?: unknown }).program)
}

/**
 * Verifies that the `Msg` type argument of every `component<S, M, E>()`
 * call is declared somewhere the LLui compiler can statically reach —
 * either in the same file or via a named import from another file.
 *
 * This catches the silent-failure case the cross-file resolver can't:
 * if a developer wires up `component<State, ImportedMsg, never>()` but
 * forgets to actually export `ImportedMsg` (typo, missing barrel
 * re-export, namespace import that the resolver doesn't follow), the
 * plugin would emit no annotations and LAP validation would silently
 * disable. CI fails here before that ever ships.
 *
 * Severity: error in `configs.recommended` and `configs.agent`. The
 * symptom (LAP accepts arbitrary type strings) is silent and can take
 * a session with the agent to surface, so erroring at lint time is
 * the right call.
 */
export const agentMsgResolvableRule = createRule({
  name: 'agent-msg-resolvable',
  meta: {
    type: 'problem',
    docs: {
      description:
        'The Msg type argument of component<>() must be locally declared or named-imported so the LLui compiler can extract its annotations.',
    },
    schema: [],
    messages: {
      unresolvable:
        'component<{{state}}, {{msg}}, {{effect}}>(): Msg type "{{msg}}" is neither declared in this file nor imported with a named import. The plugin will emit no annotations and LAP validation will silently disable. Either declare `type {{msg}} = ...` here, import it with `import {{importBraceOpen}} {{msg}} {{importBraceClose}} from "..."`, or replace it with an inline union.{{typedLintHint}}',
      complexTypeArg:
        'component<{{state}}, {{msgText}}, {{effect}}>(): Msg type argument is not a plain identifier. The LLui compiler can only chase identifier-typed type arguments — generics like `Msg<T>`, namespace-qualified names like `m.Msg`, or inline literal unions are not followed. Replace with a named type alias.{{typedLintHint}}',
      namespaceImport:
        'component<{{state}}, {{msg}}, {{effect}}>(): Msg type "{{msg}}" comes from a namespace import (`import * as ...`). The cross-file resolver does not follow namespace imports — replace with a named import: `import {{importBraceOpen}} {{msg}} {{importBraceClose}} from "..."`.{{typedLintHint}}',
    },
  },
  defaultOptions: [],
  create(context) {
    const typedLintHint = hasTypedLint(context) ? '' : TYPED_LINT_HINT
    return {
      CallExpression(node) {
        if (!isComponentCall(node)) return

        const typeParams = node.typeArguments?.params
        if (!typeParams || typeParams.length < 2) return // not enough args; type-checker will complain elsewhere

        const stateArg = typeParams[0]
        const msgArg = typeParams[1]
        const effectArg = typeParams[2]

        const stateText = stateArg ? sourceText(context, stateArg) : '?'
        const effectText = effectArg ? sourceText(context, effectArg) : 'never'

        // Reject anything that isn't a plain identifier. The plugin's
        // cross-file resolver works on identifiers; everything else
        // (Foo<T>, ns.Foo, inline literals) is undefined behavior.
        if (!msgArg || !isIdentifierTypeRef(msgArg)) {
          if (msgArg) {
            context.report({
              node: msgArg,
              messageId: 'complexTypeArg',
              data: {
                state: stateText,
                msgText: sourceText(context, msgArg),
                effect: effectText,
                typedLintHint,
              },
            })
          }
          return
        }

        const msgName = msgArg.typeName.name

        // 1. Local declaration: `type Msg = ...` or `interface Msg { ... }`
        //    Either passes; the existing agent-missing-intent /
        //    agent-exclusive-annotations rules verify variant content.
        if (hasLocalDeclaration(context, msgName)) return

        // 2. Imported via a *named* import: `import { Msg } from '...'`.
        //    The plugin's cross-file resolver follows this. Pass.
        const importKind = findImportKind(context, msgName)
        if (importKind === 'named') return

        // 3. Imported via a *namespace* import: `import * as ns from '...'`
        //    where `ns.Msg` is the type. Plugin doesn't follow these;
        //    distinct error so the fix message is specific.
        if (importKind === 'namespace') {
          context.report({
            node: msgArg,
            messageId: 'namespaceImport',
            data: {
              state: stateText,
              msg: msgName,
              effect: effectText,
              importBraceOpen: '{',
              importBraceClose: '}',
              typedLintHint,
            },
          })
          return
        }

        // 4. Not declared locally, not imported. Either a typo or
        //    missing import. Either way the build will produce an
        //    annotation-less component.
        context.report({
          node: msgArg,
          messageId: 'unresolvable',
          data: {
            state: stateText,
            msg: msgName,
            effect: effectText,
            importBraceOpen: '{',
            importBraceClose: '}',
            typedLintHint,
          },
        })
      },
    }
  },
})

function isComponentCall(node: TSESTree.CallExpression): boolean {
  // Match `component(...)` (most common) and `component<...>(...)`.
  // Don't match `something.component(...)` — only direct calls; that's
  // what the LLui compiler also matches.
  return node.callee.type === AST_NODE_TYPES.Identifier && node.callee.name === 'component'
}

function isIdentifierTypeRef(
  node: TSESTree.TypeNode,
): node is TSESTree.TSTypeReference & { typeName: TSESTree.Identifier } {
  return (
    node.type === AST_NODE_TYPES.TSTypeReference &&
    node.typeName.type === AST_NODE_TYPES.Identifier &&
    !node.typeArguments // exclude `Foo<T>` — generics are out of scope
  )
}

function hasLocalDeclaration(context: RuleContext, name: string): boolean {
  const program = context.sourceCode.ast
  for (const stmt of program.body) {
    // `type Foo = ...`
    if (stmt.type === AST_NODE_TYPES.TSTypeAliasDeclaration && stmt.id.name === name) return true
    // `interface Foo { ... }`
    if (stmt.type === AST_NODE_TYPES.TSInterfaceDeclaration && stmt.id.name === name) return true
    // `export type Foo = ...` / `export interface Foo { ... }`
    if (stmt.type === AST_NODE_TYPES.ExportNamedDeclaration && stmt.declaration) {
      const d = stmt.declaration
      if (d.type === AST_NODE_TYPES.TSTypeAliasDeclaration && d.id.name === name) return true
      if (d.type === AST_NODE_TYPES.TSInterfaceDeclaration && d.id.name === name) return true
    }
  }
  return false
}

type ImportKind = 'named' | 'namespace' | null

function findImportKind(context: RuleContext, name: string): ImportKind {
  const program = context.sourceCode.ast
  for (const stmt of program.body) {
    if (stmt.type !== AST_NODE_TYPES.ImportDeclaration) continue
    for (const spec of stmt.specifiers) {
      if (spec.local.name !== name) continue
      if (spec.type === AST_NODE_TYPES.ImportSpecifier) return 'named'
      if (spec.type === AST_NODE_TYPES.ImportNamespaceSpecifier) return 'namespace'
      // ImportDefaultSpecifier — types are rarely default-exported, treat
      // as not-found so the user gets the unresolvable hint.
    }
  }
  return null
}

function sourceText(context: RuleContext, node: TSESTree.Node): string {
  return context.sourceCode.getText(node)
}
