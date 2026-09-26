// Which demo section FILES actually render a navigation-data family product,
// derived mechanically rather than hand-picked (#264). A hand-written list of
// "the files that matter" goes stale the moment a family product's demo
// moves to a new section or a new section starts rendering one — exactly
// what happened when `charts.ts` (holding `text-left`/`pr-3`/`ml-auto`/`mr-1`)
// was never in the guard's hand-picked list and its physical-utility
// violations went unnoticed.
//
// The derivation has two independent legs, each keyed off data the family
// already owns (never a name guessed from convention):
//   1. A product's public MACHINE import path (`ProductEntry.machine.importPath`,
//      e.g. `@llui/components/table`) is imported verbatim by both demos —
//      the baseline demo drives it directly, the registry demo drives the
//      same machine underneath its copied skin.
//   2. A product's COPIED ARTIFACT name (`ProductEntry.copiedArtifacts[].name`,
//      e.g. `table`) names the registry skin's own module, which the registry
//      demo imports as `.../ui/<name>` — baseline never imports these.
//
// A section file is "owned" by the family if its own import specifiers
// contain at least one of these tokens. `app.ts`'s own `import * as X from
// './sections/Y'` lines are what enumerate the CANDIDATE files in the first
// place, so removing or renaming a section is reflected automatically too.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * @typedef {object} DemoLocation
 * @property {string} appTsPath - absolute path to the demo's `app.ts`.
 * @property {string} sectionsDir - absolute path to that demo's `src/sections` directory.
 */

/**
 * @typedef {object} NavigationDataMachineRef
 * @property {string} kind
 * @property {string} [importPath]
 */

/**
 * @typedef {object} NavigationDataCopiedArtifactRef
 * @property {string} name
 */

/**
 * @typedef {object} NavigationDataJoinedEntryRef
 * @property {NavigationDataMachineRef} machine
 * @property {readonly NavigationDataCopiedArtifactRef[]} copiedArtifacts
 */

/**
 * Parse `app.ts`'s own section imports into absolute file paths. This is the
 * CANDIDATE set — every file the app actually mounts, in the order it names
 * them — never a hand-picked subset.
 *
 * @param {DemoLocation} demo
 * @returns {string[]}
 */
export function demoSectionFiles(demo) {
  const source = readFileSync(demo.appTsPath, 'utf8')
  const matches = [...source.matchAll(/from\s+'\.\/sections\/([\w-]+)'/g)]
  if (matches.length === 0) {
    throw new Error(`${demo.appTsPath} names no './sections/*' imports — cannot derive candidates`)
  }
  return matches.map((match) => {
    const name = match[1]
    if (name === undefined) throw new Error(`${demo.appTsPath}: unreadable section import`)
    return resolve(demo.sectionsDir, `${name}.ts`)
  })
}

/**
 * The import-specifier tokens that identify a navigation-data family
 * product's rendering inside a demo section file.
 *
 * @param {readonly NavigationDataJoinedEntryRef[]} joinedEntries
 * @returns {string[]}
 */
export function navigationDataDemoTokens(joinedEntries) {
  /** @type {Set<string>} */
  const tokens = new Set()
  for (const entry of joinedEntries) {
    if (entry.machine.kind === 'public' && typeof entry.machine.importPath === 'string') {
      tokens.add(entry.machine.importPath)
    }
    for (const artifact of entry.copiedArtifacts) {
      tokens.add(`ui/${artifact.name}'`)
      tokens.add(`ui/${artifact.name}"`)
    }
  }
  if (tokens.size === 0) {
    throw new Error('navigationDataDemoTokens: derived zero tokens from a non-empty family')
  }
  return [...tokens]
}

/**
 * Which of a demo's own candidate section files render at least one
 * navigation-data family product — a file whose own source text contains one
 * of the derived tokens.
 *
 * @param {DemoLocation} demo
 * @param {readonly string[]} tokens
 * @returns {string[]} absolute paths, sorted
 */
export function navigationDataOwnedSectionFiles(demo, tokens) {
  const candidates = demoSectionFiles(demo)
  const owned = candidates.filter((file) => {
    const source = readFileSync(file, 'utf8')
    return tokens.some((token) => source.includes(token))
  })
  if (owned.length === 0) {
    throw new Error(`No candidate section file under ${demo.sectionsDir} matched any family token`)
  }
  return owned.sort()
}
