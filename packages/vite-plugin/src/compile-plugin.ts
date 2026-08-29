import { relative } from 'node:path'
import type { Plugin } from 'vite'
import {
  applyLintFixes,
  createModuleCache,
  lintAnnotationSyntaxSource,
  lintImperativeDomSource,
  lintSignalSource,
  lintTagSendSource,
  transformSignalComponentSourceWithMap,
  type CrossFileResolutions,
  type ResolveContext,
  type SignalLintMessage,
} from '@llui/compiler'
import { hasUseClientDirective, transformUseClientSsr } from '@llui/compiler-ssr'
import MagicString from 'magic-string'
import { preResolveAll, prependLines } from './compile-helpers.js'
import type { LluiPluginState } from './shared-state.js'

export function createCompilePlugin(state: LluiPluginState) {
  return {
    name: 'llui:compile',
    // #87 depends on LLui seeing authored TS before any normal transform.
    enforce: 'pre',

    handleHotUpdate(hmr) {
      if (!state.devMode) return
      const importers = state.typeFileImporters.get(hmr.file)
      if (!importers || importers.size === 0) return
      const invalidated = []
      for (const importerId of importers) {
        const module = hmr.server.moduleGraph.getModuleById(importerId)
        if (module) {
          hmr.server.moduleGraph.invalidateModule(module)
          invalidated.push(module)
        }
      }
      if (invalidated.length === 0) return
      return [...hmr.modules, ...invalidated]
    },

    async transform(code, id, options) {
      const cleanId = id.replace(/[?#][^]*$/, '')
      if (!/\.(?:ts|tsx|mts|cts)$/.test(cleanId)) return

      // ONE cache per transform call. It is deliberately local: lint,
      // cross-file resolution and lowering share parses within this call, while
      // no parsed module can escape into another file's transform (#93).
      const modules = createModuleCache()

      if (options?.ssr && hasUseClientDirective(code)) {
        const result = transformUseClientSsr(modules.get(cleanId, code))
        if (result) {
          const cwd = process.cwd()
          const rel = relative(cwd, id)
          const display = rel.startsWith('..') ? id : rel
          for (const warning of result.warnings) this.warn(`${display}: ${warning}`)
          const magicString = new MagicString(code)
          magicString.overwrite(0, code.length, result.output)
          const map = magicString.generateMap({ source: id, includeContent: true, hires: true })
          return { code: result.output, map }
        }
      }

      const hasComponentCall = /\bcomponent\s*[<(]/.test(code)
      const importsDomLiteral = /from\s*['"]@llui\/dom['"]/.test(code)
      if (hasComponentCall || (importsDomLiteral && /\beach\s*\(/.test(code))) {
        const lintMessages = lintSignalSource(modules.get(cleanId, code))
        if (lintMessages.length > 0) {
          const rel = relative(state.crossFileRoot ?? process.cwd(), id)
          const display = rel.length > 0 && !rel.startsWith('..') ? rel : id
          const autoFixable = lintMessages.filter(
            (message) => message.rule === 'convention' && message.fix,
          )
          const blocking = lintMessages.filter(
            (message) => !(message.rule === 'convention' && message.fix),
          )
          if (blocking.length > 0) {
            const first = blocking[0]!
            const body = blocking
              .map(
                (message) =>
                  `  ${display}:${message.line}:${message.column}  [${message.rule}] ${message.message}`,
              )
              .join('\n')
            this.error({
              message: `[llui] signal lint failed (${blocking.length} error${
                blocking.length > 1 ? 's' : ''
              }):\n${body}`,
              loc: { file: id, line: first.line, column: first.column },
            })
          }
          if (autoFixable.length > 0) {
            for (const message of autoFixable) {
              this.warn(
                `${display}:${message.line}:${message.column}  [${message.rule}] auto-fixed — ${message.message}`,
              )
            }
            code = applyLintFixes(code, autoFixable).code
          }
        }

        const module = modules.get(cleanId, code)
        const wantMetadata = hasComponentCall && (Boolean(state.agent) || state.devMode)
        let signalCrossFile: CrossFileResolutions | undefined
        if (wantMetadata && typeof this.resolve === 'function') {
          const resolveModule = this.resolve.bind(this)
          const addWatchFile =
            typeof this.addWatchFile === 'function' ? this.addWatchFile.bind(this) : undefined

          // Collect, don't throw: findTypeSource wraps readSource in best-effort
          // try/catch blocks that would swallow a thrown this.error (#89).
          const siblingLint: Array<{ file: string; msgs: SignalLintMessage[] }> = []
          const siblingSeen = new Set<string>()
          const context: ResolveContext = {
            modules,
            resolveModule: async (specifier, importer) => {
              const result = await resolveModule(specifier, importer)
              if (!result || result.external) return null
              const strippedId = result.id.split('?')[0]?.split('#')[0]
              if (!strippedId || strippedId.includes('/node_modules/')) return null
              return strippedId
            },
            readSource: async (path) => {
              const content = await state.readSourceCached(path)
              addWatchFile?.(path)
              if (state.devMode) {
                let importers = state.typeFileImporters.get(path)
                if (!importers) {
                  importers = new Set()
                  state.typeFileImporters.set(path, importers)
                }
                importers.add(id)
              }
              if (!siblingSeen.has(path)) {
                siblingSeen.add(path)
                const messages = lintAnnotationSyntaxSource(modules.get(path, content))
                if (messages.length > 0) siblingLint.push({ file: path, msgs: messages })
              }
              return content
            },
          }
          signalCrossFile = await preResolveAll(module, context)
          if (siblingLint.length > 0) {
            const first = siblingLint[0]!
            const firstMessage = first.msgs[0]!
            const body = siblingLint
              .flatMap(({ file, msgs }) => {
                const rel = relative(state.crossFileRoot ?? process.cwd(), file)
                const display = rel.length > 0 && !rel.startsWith('..') ? rel : file
                return msgs.map(
                  (message) =>
                    `  ${display}:${message.line}:${message.column}  [${message.rule}] ${message.message}`,
                )
              })
              .join('\n')
            const count = siblingLint.reduce((total, sibling) => total + sibling.msgs.length, 0)
            this.error({
              message: `[llui] signal lint failed (${count} error${count > 1 ? 's' : ''}):\n${body}`,
              loc: { file: first.file, line: firstMessage.line, column: firstMessage.column },
            })
          }
        }

        const perfDiagnosticsOn = state.perfDiagnosticsOpt ?? state.devMode
        const perfWarn = perfDiagnosticsOn
          ? (diagnostic: import('@llui/compiler').Diagnostic): void => {
              const rel = relative(state.crossFileRoot ?? process.cwd(), id)
              const display = rel.length > 0 && !rel.startsWith('..') ? rel : id
              const { line, column } = diagnostic.location.range.start
              this.warn(
                `${display}:${line + 1}:${column + 1}  [${diagnostic.id}] ${diagnostic.message}`,
              )
            }
          : undefined
        const transformed = transformSignalComponentSourceWithMap(module, {
          emitAgentMetadata: Boolean(state.agent),
          devMode: state.devMode,
          onPerfDiagnostic: perfWarn,
          crossFile: signalCrossFile,
        })
        if (hasComponentCall && transformed.map !== null) state.sawSignalComponent = true
        const bootstrap =
          state.devMode && state.mcpPort !== null
            ? `import { startRelay as __llui_startRelay } from '@llui/dom/devtools'\n` +
              `if (!globalThis.__lluiRelayStarted) { globalThis.__lluiRelayStarted = true; __llui_startRelay(${state.mcpPort})\n` +
              `  if (import.meta.hot) import.meta.hot.on('llui:mcp-ready', (d) => { if (typeof globalThis.__lluiConnect === 'function') globalThis.__lluiConnect(d?.port) }) }\n`
            : ''
        return prependLines(transformed.code, transformed.map, bootstrap, id)
      }

      const module = modules.get(cleanId, code)
      const annotationMessages = [
        ...lintAnnotationSyntaxSource(module),
        ...lintTagSendSource(module),
        // A view HELPER module builds elements with `@llui/dom` helpers and
        // carries no `component(` call, so it takes this branch — and that is
        // exactly where #231's imperative `textContent` write lived.
        ...lintImperativeDomSource(module),
      ].sort((left, right) => left.start - right.start)
      if (annotationMessages.length > 0) {
        const rel = relative(state.crossFileRoot ?? process.cwd(), id)
        const display = rel.length > 0 && !rel.startsWith('..') ? rel : id
        const first = annotationMessages[0]!
        const body = annotationMessages
          .map(
            (message) =>
              `  ${display}:${message.line}:${message.column}  [${message.rule}] ${message.message}`,
          )
          .join('\n')
        this.error({
          message: `[llui] signal lint failed (${annotationMessages.length} error${
            annotationMessages.length > 1 ? 's' : ''
          }):\n${body}`,
          loc: { file: id, line: first.line, column: first.column },
        })
      }
      return undefined
    },

    // Build-time integrity check. The signal transform is the ONLY
    // compilation path; it sets `sawSignalComponent` the moment it lowers a
    // `component()` file. If a production build reaches `generateBundle`
    // without that flag ever being set, another transform consumed the TS
    // ahead of us (plugin-order bug) or the project genuinely has no LLui
    // components — either way, fail closed.
    //
    // ANTI-RECIPE — this hook used to also run a post-bundle property-rename
    // pass over the compiler-emitted metadata keys, scoped by provenance to
    // chunks containing a compiled module. That is unfixable by construction:
    // the WRITER of those keys is app code, the READERS are `@llui/dom` and
    // `@llui/agent`, and any `manualChunks` vendor split (the stock
    // `{ vendor: ['@llui/dom'] }` included) puts them in different chunks —
    // so the pass renamed the writer and left the reader looking up the old
    // name, yielding `undefined` schemas in every production `agent: true`
    // build with no error anywhere (issue #45). The compiler now emits the
    // final short names itself (`COMPILER_META_KEYS`, mirrored in
    // `@llui/dom`'s `signals/compiler-keys.ts`), which gets the same bytes
    // with no bundle-shape dependency. Do NOT reintroduce bundle-time
    // renaming of compiler-emitted names.
    //
    // Related ANTI-RECIPE — property-MANGLING the compiler-emit fields with
    // terser/esbuild saves 570–1,406 bytes gz on the jfb bench bundle but
    // empirically regresses keyed-each ops (Update 10th, Select, Swap) by
    // 35–58 %. Verified 2026-05-20 across three measurements with both
    // implementations; the cost holds even with `compress: false`. Property
    // renames should be V8-transparent in theory; in practice V8's optimizer
    // on the jfb shape produces measurably slower code on the mangled bundle.
    // See commit d2855d7 (landed) + b63a6ef (reverted) for the full attempt.
    generateBundle(options) {
      if (state.devMode) return
      if (options.dir === undefined && options.file === undefined) return
      if ((options as { ssr?: boolean }).ssr) return
      if (!state.sawSignalComponent) {
        this.error(
          '[llui] integrity check failed: no compiled `component()` calls found in ' +
            'this build. Either the project has no LLui components (remove ' +
            '`@llui/vite-plugin` from vite.config.ts), or the plugin order is wrong ' +
            'and another transform is consuming TS before `@llui/vite-plugin` runs ' +
            "(check `enforce: 'pre'`). The signal transform sets an internal " +
            'flag whenever it lowers a `component()` file; that flag was never set.',
        )
      }
    },
  } satisfies Plugin
}
