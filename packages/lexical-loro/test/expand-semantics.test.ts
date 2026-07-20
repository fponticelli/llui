/**
 * GATING SPIKE — can Loro's per-mark `expand` semantics (`LoroDoc#configTextStyle`)
 * reproduce Lexical's text-format-at-boundary behaviour?
 *
 * Ground truth for the Lexical side is derived by RUNNING Lexical headless.
 * The Loro side runs a real `LoroText` under a candidate expand table.
 *
 * ── Harness fidelity note ──────────────────────────────────────────────────
 * `TextNode.select()` does NOT set `RangeSelection.format` (LexicalTextNode.ts
 * :871-910) — in a browser the format is set when a native DOM selection is
 * resolved into a RangeSelection, which headless Lexical never does. Two
 * internal, non-exported rules govern that path; `placeCaret()` below applies
 * them verbatim so the headless run reproduces the browser:
 *
 *   1. BOUNDARY NORMALIZATION — `resolveSelectionPointOnBoundary`
 *      (LexicalSelection.ts:3164-3204). For a COLLAPSED caret `isBackward` is
 *      false (`isBefore` is strict), so a caret at offset 0 of a text node
 *      whose previous sibling is a mergeable text node is moved to the END of
 *      that previous sibling. Lexical's caret is therefore LEFT-BIASED at every
 *      text-run boundary.
 *   2. FORMAT INHERITANCE — `$internalCreateRangeSelection`
 *      (LexicalSelection.ts:3638-3655): when the resolved anchor is a different
 *      node from the previous selection's anchor, `selection.format` is set to
 *      `anchorNode.getFormat()`.
 *
 * Everything downstream of `placeCaret` — `formatText`, `insertText`, node
 * splitting, normalization — is real Lexical.
 */
import { describe, expect, it } from 'vitest'
import { createHeadlessEditor } from '@lexical/headless'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  TEXT_TYPE_TO_FORMAT,
  type LexicalEditor,
  type RangeSelection,
  type TextFormatType,
  type TextNode,
} from 'lexical'
import { LoroDoc, type LoroText } from 'loro-crdt'
import { LORO_TEXT_FORMATS, type LoroTextFormat } from '../src/index'

// ---------------------------------------------------------------------------
// Shared run model
// ---------------------------------------------------------------------------

/** A maximal stretch of text sharing one format bitmask. */
type Run = { text: string; format: number }

type ExpandType = 'before' | 'after' | 'none' | 'both'

const EXPANDS: readonly ExpandType[] = ['before', 'after', 'none', 'both']

/** Coalesce adjacent equal-format runs so the two sides compare structurally. */
const normalize = (runs: readonly Run[]): Run[] => {
  const out: Run[] = []
  for (const run of runs) {
    if (run.text === '') continue
    const last = out[out.length - 1]
    if (last !== undefined && last.format === run.format) {
      last.text += run.text
    } else {
      out.push({ text: run.text, format: run.format })
    }
  }
  return out
}

const bit = (format: LoroTextFormat): number => {
  const value = TEXT_TYPE_TO_FORMAT[format as TextFormatType]
  if (value === undefined) throw new Error(`unknown Lexical format: ${format}`)
  return value
}

const same = (a: readonly Run[], b: readonly Run[]): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

// ---------------------------------------------------------------------------
// Lexical ground truth (headless)
// ---------------------------------------------------------------------------

const makeEditor = (): LexicalEditor =>
  createHeadlessEditor({
    namespace: 'expand-spike',
    onError: (error: Error) => {
      throw error
    },
  })

type LexicalCase = {
  /** Initial paragraph content. */
  runs: readonly Run[]
  /** Character index of the collapsed caret within the paragraph. */
  caret: number
  /**
   * Which text node the browser's caret lands in when `caret` sits exactly on a
   * run boundary. Lexical normalizes both to the LEFT run (rule 1 above), so
   * this only exists to PROVE that the normalization makes the choice moot.
   */
  side?: 'left' | 'right'
  /** Formats toggled on the collapsed selection before typing. */
  toggle?: readonly LoroTextFormat[]
  /** Text typed at the caret. */
  type: string
}

/** Apply Lexical's two browser-path caret rules (see the fidelity note). */
const placeCaret = (
  nodes: readonly TextNode[],
  caret: number,
  side: 'left' | 'right',
): RangeSelection => {
  let index = 0
  let node = nodes[0]
  let offset = 0
  if (node === undefined) throw new Error('no text nodes')
  for (const candidate of nodes) {
    const length = candidate.getTextContentSize()
    const local = caret - index
    if (local >= 0 && local <= length) {
      node = candidate
      offset = local
      // Prefer the right-hand node when the caller asked for it and the caret
      // is at that node's start; otherwise stop at the first node containing it.
      if (!(side === 'right' && local === length && candidate !== nodes[nodes.length - 1])) {
        break
      }
    }
    index += length
  }

  // Rule 1: collapsed caret at offset 0 normalizes onto the previous text node.
  if (offset === 0) {
    const previous = node.getPreviousSibling()
    if ($isTextNode(previous) && !node.isUnmergeable()) {
      node = previous
      offset = previous.getTextContentSize()
    }
  }

  node.select(offset, offset)
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) throw new Error('expected range selection')
  // Rule 2: the caret inherits the resolved anchor node's format.
  selection.setFormat(node.getFormat())
  return selection
}

/** Drive real Lexical and read back the resulting runs. */
const runLexical = (testCase: LexicalCase): Run[] => {
  const editor = makeEditor()
  let result: Run[] = []
  editor.update(
    () => {
      const paragraph = $createParagraphNode()
      const nodes = testCase.runs.map((run) => $createTextNode(run.text).setFormat(run.format))
      paragraph.append(...nodes)
      $getRoot().clear().append(paragraph)

      const selection = placeCaret(nodes, testCase.caret, testCase.side ?? 'left')
      for (const format of testCase.toggle ?? []) {
        selection.formatText(format as TextFormatType)
      }
      if (testCase.type !== '') selection.insertText(testCase.type)
    },
    { discrete: true },
  )
  editor.getEditorState().read(() => {
    result = normalize(
      $getRoot()
        .getAllTextNodes()
        .map((node) => ({ text: node.getTextContent(), format: node.getFormat() })),
    )
  })
  return result
}

// ---------------------------------------------------------------------------
// Loro mirror
// ---------------------------------------------------------------------------

type ExpandTable = Readonly<Record<string, { expand: ExpandType }>>

const uniformTable = (expand: ExpandType): ExpandTable =>
  Object.fromEntries(LORO_TEXT_FORMATS.map((f) => [f, { expand }]))

/** Seed a LoroText with the given runs, one independent named mark per format bit. */
const seed = (text: LoroText, runs: readonly Run[]): void => {
  text.insert(0, runs.map((r) => r.text).join(''))
  let index = 0
  for (const run of runs) {
    const end = index + run.text.length
    for (const format of LORO_TEXT_FORMATS) {
      if ((run.format & bit(format)) !== 0) {
        text.mark({ start: index, end }, format, true)
      }
    }
    index = end
  }
}

type DeltaItem = { insert?: unknown; attributes?: Record<string, unknown> }

const readLoro = (text: LoroText): Run[] => {
  const delta = text.toDelta() as readonly DeltaItem[]
  return normalize(
    delta.map((item) => {
      const attributes = item.attributes ?? {}
      let format = 0
      for (const key of LORO_TEXT_FORMATS) {
        if (attributes[key] === true) format |= bit(key)
      }
      return { text: String(item.insert ?? ''), format }
    }),
  )
}

/**
 * Mirror a Lexical case on Loro: same initial runs, same typed text at the same
 * character index. `applyToggle` models a binding that, after inserting, pushes
 * the caret's pending format onto the inserted range explicitly.
 */
const runLoro = (testCase: LexicalCase, table: ExpandTable, applyToggle = false): Run[] => {
  const doc = new LoroDoc()
  doc.configTextStyle(table)
  const text = doc.getText('text')
  seed(text, testCase.runs)
  text.insert(testCase.caret, testCase.type)
  if (applyToggle) {
    for (const format of testCase.toggle ?? []) {
      text.mark({ start: testCase.caret, end: testCase.caret + testCase.type.length }, format, true)
    }
  }
  doc.commit()
  return readLoro(text)
}

// ---------------------------------------------------------------------------
// 1. Lexical's own boundary behaviour, measured per format
// ---------------------------------------------------------------------------

describe('Lexical ground truth: boundary behaviour per format', () => {
  it.each(LORO_TEXT_FORMATS)('typing at the END of a %s run extends it', (format) => {
    const f = bit(format)
    expect(runLexical({ runs: [{ text: 'abc', format: f }], caret: 3, type: 'X' })).toEqual([
      { text: 'abcX', format: f },
    ])
  })

  it.each(LORO_TEXT_FORMATS)(
    'typing at the START of a %s run also extends it (no previous sibling)',
    (format) => {
      const f = bit(format)
      expect(runLexical({ runs: [{ text: 'abc', format: f }], caret: 0, type: 'X' })).toEqual([
        { text: 'Xabc', format: f },
      ])
    },
  )

  it.each(LORO_TEXT_FORMATS)(
    'typing at the START of a %s run does NOT extend it when a plain run precedes',
    (format) => {
      const f = bit(format)
      expect(
        runLexical({
          runs: [
            { text: 'ab', format: 0 },
            { text: 'cd', format: f },
          ],
          caret: 2,
          type: 'X',
        }),
      ).toEqual([
        { text: 'abX', format: 0 },
        { text: 'cd', format: f },
      ])
    },
  )

  it('is LEFT-BIASED at a boundary: the DOM side the caret came from is irrelevant', () => {
    const B = bit('bold')
    const I = bit('italic')
    const runs: readonly Run[] = [
      { text: 'ab', format: B },
      { text: 'cd', format: I },
    ]
    const fromLeft = runLexical({ runs, caret: 2, side: 'left', type: 'X' })
    const fromRight = runLexical({ runs, caret: 2, side: 'right', type: 'X' })
    // Rule 1 normalizes the right-hand caret back onto the bold run.
    expect(fromLeft).toEqual(fromRight)
    expect(fromLeft).toEqual([
      { text: 'abX', format: B },
      { text: 'cd', format: I },
    ])
  })

  it('honours a format toggled ON at a collapsed caret', () => {
    const B = bit('bold')
    expect(
      runLexical({
        runs: [{ text: 'abc', format: 0 }],
        caret: 3,
        toggle: ['bold'],
        type: 'X',
      }),
    ).toEqual([
      { text: 'abc', format: 0 },
      { text: 'X', format: B },
    ])
  })

  it('honours a format toggled OFF at a collapsed caret at the end of a run', () => {
    const B = bit('bold')
    expect(
      runLexical({
        runs: [{ text: 'abc', format: B }],
        caret: 3,
        toggle: ['bold'],
        type: 'X',
      }),
    ).toEqual([
      { text: 'abc', format: B },
      { text: 'X', format: 0 },
    ])
  })
})

// ---------------------------------------------------------------------------
// 2. Which uniform expand table reproduces plain typing (no pending toggle)?
// ---------------------------------------------------------------------------

type NamedCase = { name: string } & LexicalCase

/** Every no-toggle boundary case a caret can reach inside one paragraph. */
const plainTypingCases = (f: number): readonly NamedCase[] => [
  {
    name: 'end-of-formatted-run',
    runs: [{ text: 'abc', format: f }],
    caret: 3,
    type: 'X',
  },
  {
    name: 'paragraph-start-of-formatted-run',
    runs: [{ text: 'abc', format: f }],
    caret: 0,
    type: 'X',
  },
  {
    name: 'interior-of-formatted-run',
    runs: [{ text: 'abc', format: f }],
    caret: 1,
    type: 'X',
  },
  {
    // Caret normalizes LEFT onto the formatted run -> Lexical keeps the format.
    name: 'boundary-formatted-then-plain',
    runs: [
      { text: 'ab', format: f },
      { text: 'cd', format: 0 },
    ],
    caret: 2,
    type: 'X',
  },
  {
    // Caret normalizes LEFT onto the plain run -> Lexical drops the format.
    name: 'boundary-plain-then-formatted',
    runs: [
      { text: 'ab', format: 0 },
      { text: 'cd', format: f },
    ],
    caret: 2,
    type: 'X',
  },
  {
    name: 'paragraph-end-of-plain-run',
    runs: [
      { text: 'ab', format: f },
      { text: 'cd', format: 0 },
    ],
    caret: 4,
    type: 'X',
  },
]

/** Case names where a uniform expand table diverges from Lexical, per table. */
const DIVERGENCES: Readonly<Record<ExpandType, readonly string[]>> = {
  before: [
    'end-of-formatted-run',
    'boundary-formatted-then-plain',
    'boundary-plain-then-formatted',
  ],
  after: ['paragraph-start-of-formatted-run'],
  none: [
    'end-of-formatted-run',
    'paragraph-start-of-formatted-run',
    'boundary-formatted-then-plain',
  ],
  both: ['boundary-plain-then-formatted'],
}

describe('uniform expand tables vs Lexical, plain typing', () => {
  it.each(EXPANDS)('expand=%s diverges on exactly a known set of cases', (expand) => {
    const table = uniformTable(expand)
    const failing = new Set<string>()
    for (const format of LORO_TEXT_FORMATS) {
      for (const testCase of plainTypingCases(bit(format))) {
        if (!same(runLoro(testCase, table), runLexical(testCase))) {
          failing.add(testCase.name)
        }
      }
    }
    // The divergence set is format-INDEPENDENT: every one of the 11 formats
    // fails on exactly the same cases, so a per-format table cannot help.
    expect([...failing].sort()).toEqual([...DIVERGENCES[expand]].sort())
  })

  it('no uniform expand table is divergence-free', () => {
    for (const expand of EXPANDS) {
      expect(DIVERGENCES[expand].length).toBeGreaterThan(0)
    }
  })

  it('expand=after is the closest fit: one residual case, at paragraph start', () => {
    expect(DIVERGENCES.after).toEqual(['paragraph-start-of-formatted-run'])
    const table = uniformTable('after')
    for (const format of LORO_TEXT_FORMATS) {
      for (const testCase of plainTypingCases(bit(format))) {
        if (testCase.name === 'paragraph-start-of-formatted-run') continue
        expect(runLoro(testCase, table)).toEqual(runLexical(testCase))
      }
    }
  })

  it('DIVERGENCE 1: typing at index 0 of a formatted first run', () => {
    const B = bit('bold')
    const testCase: LexicalCase = {
      runs: [{ text: 'abc', format: B }],
      caret: 0,
      type: 'X',
    }
    // Lexical: the caret has no previous sibling to normalize onto, so it stays
    // in the bold node at offset 0 and inherits bold.
    expect(runLexical(testCase)).toEqual([{ text: 'Xabc', format: B }])
    // Loro with expand=after: the insert is before the mark start, so plain.
    expect(runLoro(testCase, uniformTable('after'))).toEqual([
      { text: 'X', format: 0 },
      { text: 'abc', format: B },
    ])
    // expand=both fixes THIS case but breaks the plain|formatted boundary.
    expect(runLoro(testCase, uniformTable('both'))).toEqual(runLexical(testCase))
    const boundary: LexicalCase = {
      runs: [
        { text: 'ab', format: 0 },
        { text: 'cd', format: B },
      ],
      caret: 2,
      type: 'X',
    }
    expect(runLexical(boundary)).toEqual([
      { text: 'abX', format: 0 },
      { text: 'cd', format: B },
    ])
    expect(runLoro(boundary, uniformTable('both'))).toEqual([
      { text: 'ab', format: 0 },
      { text: 'Xcd', format: B },
    ])
    // => no single uniform value satisfies both. And the conflict is between
    //    two cases of the SAME format, so a PER-FORMAT table cannot help either.
  })
})

// ---------------------------------------------------------------------------
// 3. A pending format toggled at a collapsed caret has no expand expression
// ---------------------------------------------------------------------------

describe('DIVERGENCE 2: format toggled at a collapsed caret', () => {
  const B = bit('bold')

  const toggledOn: LexicalCase = {
    runs: [{ text: 'abc', format: 0 }],
    caret: 3,
    toggle: ['bold'],
    type: 'X',
  }
  const toggledOff: LexicalCase = {
    runs: [{ text: 'abc', format: B }],
    caret: 3,
    toggle: ['bold'],
    type: 'X',
  }

  it('no expand table reproduces toggle-ON, because there is no mark to expand from', () => {
    expect(runLexical(toggledOn)).toEqual([
      { text: 'abc', format: 0 },
      { text: 'X', format: B },
    ])
    for (const expand of EXPANDS) {
      expect(runLoro(toggledOn, uniformTable(expand))).toEqual([{ text: 'abcX', format: 0 }])
    }
  })

  it('no expand table reproduces toggle-OFF under the expand=after that plain typing requires', () => {
    expect(runLexical(toggledOff)).toEqual([
      { text: 'abc', format: B },
      { text: 'X', format: 0 },
    ])
    // expand=after (required by section 2) greedily bolds the typed character.
    expect(runLoro(toggledOff, uniformTable('after'))).toEqual([{ text: 'abcX', format: B }])
    expect(runLoro(toggledOff, uniformTable('both'))).toEqual([{ text: 'abcX', format: B }])
  })

  it('an explicit post-insert mark/unmark DOES reproduce both (the required binding strategy)', () => {
    expect(runLoro(toggledOn, uniformTable('after'), true)).toEqual(runLexical(toggledOn))
    // toggle-OFF needs an explicit unmark of the inserted range.
    const doc = new LoroDoc()
    doc.configTextStyle(uniformTable('after'))
    const text = doc.getText('text')
    seed(text, toggledOff.runs)
    text.insert(3, 'X')
    text.unmark({ start: 3, end: 4 }, 'bold')
    doc.commit()
    expect(readLoro(text)).toEqual(runLexical(toggledOff))
  })
})

// ---------------------------------------------------------------------------
// 4. Concurrency — what decomposing the bitmask into named marks BUYS
// ---------------------------------------------------------------------------

describe('two peers concurrently formatting overlapping ranges', () => {
  const B = bit('bold')
  const I = bit('italic')

  const forked = (table: ExpandTable): { a: LoroDoc; b: LoroDoc } => {
    const a = new LoroDoc()
    a.setPeerId(1n)
    a.configTextStyle(table)
    a.getText('text').insert(0, 'abcdef')
    a.commit()
    const b = new LoroDoc()
    b.setPeerId(2n)
    b.configTextStyle(table)
    b.import(a.export({ mode: 'snapshot' }))
    return { a, b }
  }

  const sync = (a: LoroDoc, b: LoroDoc): void => {
    const fromA = a.export({ mode: 'update' })
    const fromB = b.export({ mode: 'update' })
    a.import(fromB)
    b.import(fromA)
  }

  it('independent named marks MERGE: bold|italic on the overlap', () => {
    const { a, b } = forked(uniformTable('after'))
    a.getText('text').mark({ start: 0, end: 4 }, 'bold', true)
    a.commit()
    b.getText('text').mark({ start: 2, end: 6 }, 'italic', true)
    b.commit()
    sync(a, b)

    const expected: Run[] = [
      { text: 'ab', format: B },
      { text: 'cd', format: B | I },
      { text: 'ef', format: I },
    ]
    expect(readLoro(a.getText('text'))).toEqual(expected)
    expect(readLoro(b.getText('text'))).toEqual(expected)
  })

  it('the SAME merge as one bitmask value silently drops a toggle (why we decompose)', () => {
    const table: ExpandTable = { format: { expand: 'after' } }
    const a = new LoroDoc()
    a.setPeerId(1n)
    a.configTextStyle(table)
    a.getText('text').insert(0, 'abcdef')
    a.commit()
    const b = new LoroDoc()
    b.setPeerId(2n)
    b.configTextStyle(table)
    b.import(a.export({ mode: 'snapshot' }))

    a.getText('text').mark({ start: 2, end: 4 }, 'format', B)
    a.commit()
    b.getText('text').mark({ start: 2, end: 4 }, 'format', I)
    b.commit()
    sync(a, b)

    const delta = a.getText('text').toDelta() as readonly DeltaItem[]
    const overlap = delta.find((d) => String(d.insert ?? '') === 'cd')
    const value = overlap?.attributes?.format
    // Last-writer-wins: one toggle survives, the union is NOT produced.
    expect(value === B || value === I).toBe(true)
    expect(value).not.toBe(B | I)
  })

  it('DIVERGENCE 3: a CONCURRENT remote insert at a mark boundary ignores expand', () => {
    const { a, b } = forked(uniformTable('after'))
    a.getText('text').mark({ start: 0, end: 3 }, 'bold', true)
    a.commit()
    // Peer B types at index 3 — exactly the mark's end boundary — without
    // having seen the mark. expand=after would extend a LOCAL insert here.
    b.getText('text').insert(3, 'X')
    b.commit()
    sync(a, b)

    const merged = readLoro(a.getText('text'))
    expect(merged).toEqual(readLoro(b.getText('text')))
    // The typed character is NOT bold, even though a local insert at the same
    // index under expand=after would have been.
    expect(merged).toEqual([
      { text: 'abc', format: B },
      { text: 'Xdef', format: 0 },
    ])
    // Sequential (non-concurrent) insert at the same index DOES expand:
    const { a: a2 } = forked(uniformTable('after'))
    a2.getText('text').mark({ start: 0, end: 3 }, 'bold', true)
    a2.commit()
    a2.getText('text').insert(3, 'X')
    a2.commit()
    expect(readLoro(a2.getText('text'))).toEqual([
      { text: 'abcX', format: B },
      { text: 'def', format: 0 },
    ])
  })
})

// ---------------------------------------------------------------------------
// 5. Verdict
// ---------------------------------------------------------------------------

describe('VERDICT: a configTextStyle table alone is NOT sufficient', () => {
  it('summarises the three measured divergences', () => {
    // 1. No uniform expand value matches Lexical on all plain-typing boundaries;
    //    `after` is closest, missing only the paragraph-start case.
    expect(EXPANDS.every((e) => DIVERGENCES[e].length > 0)).toBe(true)
    expect(DIVERGENCES.after).toEqual(['paragraph-start-of-formatted-run'])

    // 2. A PER-FORMAT table cannot rescue it: the divergence set is identical
    //    for all 11 formats, so there is no format that wants a different value.
    const perFormat = new Map<LoroTextFormat, string[]>()
    const table = uniformTable('after')
    for (const format of LORO_TEXT_FORMATS) {
      perFormat.set(
        format,
        plainTypingCases(bit(format))
          .filter((c) => !same(runLoro(c, table), runLexical(c)))
          .map((c) => c.name),
      )
    }
    const sets = new Set([...perFormat.values()].map((v) => JSON.stringify(v)))
    expect(sets.size).toBe(1)

    // 3. A format toggled at a collapsed caret has NO expression as an expand
    //    rule at all — it must be replayed as an explicit mark/unmark.
    const toggled: LexicalCase = {
      runs: [{ text: 'abc', format: 0 }],
      caret: 3,
      toggle: ['bold'],
      type: 'X',
    }
    expect(EXPANDS.some((e) => same(runLoro(toggled, uniformTable(e)), runLexical(toggled)))).toBe(
      false,
    )
    expect(runLoro(toggled, table, true)).toEqual(runLexical(toggled))
  })

  it('the schema that DOES work: named marks + expand=after + explicit replay of the caret format', () => {
    const table = uniformTable('after')
    for (const format of LORO_TEXT_FORMATS) {
      for (const testCase of plainTypingCases(bit(format))) {
        const lexical = runLexical(testCase)
        // The binding replays Lexical's resulting runs, so the local result is
        // authoritative regardless of expand; expand only decides what happens
        // to text a REMOTE peer concurrently inserts at a mark boundary.
        const doc = new LoroDoc()
        doc.configTextStyle(table)
        const text = doc.getText('text')
        seed(text, lexical)
        doc.commit()
        expect(readLoro(text)).toEqual(lexical)
      }
    }
  })
})
