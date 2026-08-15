import {
  componentTypeNames,
  crossFileKey,
  extractDiscriminatedUnionSchemaCrossFile,
  extractMsgAnnotationsCrossFile,
  findTypeSource,
  type CrossFileResolution,
  type CrossFileResolutions,
  type ParsedModule,
  type PreExtractedSchemas,
  type ResolveContext,
} from '@llui/compiler'
import MagicString from 'magic-string'
import type { SourceMap } from 'magic-string'
import ts from 'typescript'

/** Resolve the cross-file metadata required by every component call in a module. */
export async function preResolveAll(
  module: ParsedModule,
  context: ResolveContext,
): Promise<CrossFileResolutions | undefined> {
  if (!/\bcomponent\s*</.test(module.text)) return undefined

  const filePath = module.fileName
  const tuples = collectComponentTypeNames(module.sourceFile())
  if (tuples.size === 0) return undefined

  const resolveTypeSource = async (
    typeName: string,
  ): Promise<{ module: ParsedModule; typeName: string } | undefined> => {
    const found = await findTypeSource(typeName, module, context)
    if (!found || found.filePath === filePath) return undefined
    return { module: found.module, typeName: found.localName }
  }

  const resolutions = new Map<string, CrossFileResolution>()
  for (const [key, names] of tuples) {
    const [state, msg, effect, msgAnnotations, msgSchema, effectSchema] = await Promise.all([
      resolveTypeSource(names.state),
      resolveTypeSource(names.msg),
      resolveTypeSource(names.effect),
      extractMsgAnnotationsCrossFile(module, names.msg, context),
      extractDiscriminatedUnionSchemaCrossFile(module, names.msg, context),
      extractDiscriminatedUnionSchemaCrossFile(module, names.effect, context),
    ])

    const resolution: CrossFileResolution = {}
    if (state || msg || effect) resolution.typeSources = { state, msg, effect }
    if (msgAnnotations !== null || msgSchema !== null || effectSchema !== null) {
      const preExtracted: PreExtractedSchemas = {}
      if (msgAnnotations !== null) preExtracted.msgAnnotations = msgAnnotations
      if (msgSchema !== null) preExtracted.msgSchema = msgSchema
      if (effectSchema !== null) preExtracted.effectSchema = effectSchema
      resolution.preExtracted = preExtracted
    }
    if (resolution.typeSources || resolution.preExtracted) resolutions.set(key, resolution)
  }
  return resolutions.size > 0 ? resolutions : undefined
}

function collectComponentTypeNames(
  sourceFile: ts.SourceFile,
): Map<string, { state: string; msg: string; effect: string }> {
  const result = new Map<string, { state: string; msg: string; effect: string }>()
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'component'
    ) {
      const names = componentTypeNames(node)
      const key = crossFileKey(names)
      if (!result.has(key)) result.set(key, names)
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sourceFile, visit)
  return result
}

export interface EncodedSourceMap {
  version: 3
  file?: string
  sources: (string | null)[]
  sourcesContent?: (string | null)[]
  names: string[]
  mappings: string
}

/** Prepend whole lines while shifting or synthesizing the source map (#87). */
export function prependLines(
  code: string,
  map: SourceMap | null,
  prepend: string,
  fileName: string,
): { code: string; map: EncodedSourceMap | null } {
  if (prepend === '') return { code, map: map === null ? null : encodeMap(map) }
  if (!prepend.endsWith('\n')) {
    throw new Error(
      '[llui] prependLines: prepended content must end with a newline — a partial ' +
        'line shifts columns that a line-granular map shift cannot express.',
    )
  }
  let lines = 0
  for (let i = 0; i < prepend.length; i++) if (prepend.charCodeAt(i) === 10) lines++
  const base =
    map ??
    new MagicString(code).generateMap({ source: fileName, includeContent: true, hires: true })
  const encoded = encodeMap(base)
  return {
    code: prepend + code,
    map: { ...encoded, mappings: ';'.repeat(lines) + encoded.mappings },
  }
}

function encodeMap(map: SourceMap): EncodedSourceMap {
  return {
    version: 3,
    ...(map.file ? { file: map.file } : {}),
    sources: map.sources,
    ...(map.sourcesContent ? { sourcesContent: map.sourcesContent } : {}),
    names: map.names,
    mappings: map.mappings,
  }
}
