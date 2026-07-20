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
  type TextFormatType,
  type TextNode,
} from 'lexical'
import { LoroDoc, type LoroText } from 'loro-crdt'

import {
  applyMarkOps,
  applyTextDiff,
  bitmaskFromAttributes,
  bitmaskFromFormats,
  diffRunFormats,
  diffText,
  diffTextWithCursor,
  formatBit,
  formatsFromBitmask,
  FORMAT_BITS,
  initDoc,
  KNOWN_FORMAT_MASK,
  LORO_TEXT_FORMATS,
  normalizeRuns,
  runsFromDelta,
  runsFromText,
  runsText,
  type LoroTextFormat,
  type TextRun,
} from '../src/index.js'

const BOLD = formatBit('bold')
const ITALIC = formatBit('italic')
const CODE = formatBit('code')

// ---------------------------------------------------------------------------
// Format vocabulary
// ---------------------------------------------------------------------------

describe('format bits', () => {
  it('are derived from Lexical, not hardcoded', () => {
    for (const format of LORO_TEXT_FORMATS) {
      expect(FORMAT_BITS[format]).toBe(TEXT_TYPE_TO_FORMAT[format as TextFormatType])
    }
  })

  it('are distinct single bits', () => {
    const seen = new Set<number>()
    for (const format of LORO_TEXT_FORMATS) {
      const bit = FORMAT_BITS[format]
      expect(bit).toBeGreaterThan(0)
      expect(bit & (bit - 1)).toBe(0) // exactly one bit set
      expect(seen.has(bit)).toBe(false)
      seen.add(bit)
    }
  })

  it('KNOWN_FORMAT_MASK is the union of every representable bit', () => {
    expect(KNOWN_FORMAT_MASK).toBe(bitmaskFromFormats(LORO_TEXT_FORMATS))
    for (const format of LORO_TEXT_FORMATS) {
      expect(KNOWN_FORMAT_MASK & FORMAT_BITS[format]).toBe(FORMAT_BITS[format])
    }
  })
})

describe('bitmask ↔ named formats', () => {
  it('round-trips every single format', () => {
    for (const format of LORO_TEXT_FORMATS) {
      expect(formatsFromBitmask(formatBit(format))).toEqual([format])
    }
  })

  it('round-trips a combination, in bit order', () => {
    const mask = BOLD | ITALIC | CODE
    expect(formatsFromBitmask(mask)).toEqual(['bold', 'italic', 'code'])
    expect(bitmaskFromFormats(formatsFromBitmask(mask))).toBe(mask)
  })

  it('round-trips the full mask and the empty mask', () => {
    expect(formatsFromBitmask(0)).toEqual([])
    expect(bitmaskFromFormats([])).toBe(0)
    expect(formatsFromBitmask(KNOWN_FORMAT_MASK)).toEqual([...LORO_TEXT_FORMATS])
  })

  it('ignores bits it cannot represent rather than inventing a format', () => {
    const unknownBit = 1 << 30
    expect(formatsFromBitmask(BOLD | unknownBit)).toEqual(['bold'])
  })
})

describe('bitmaskFromAttributes', () => {
  it('reads set marks', () => {
    expect(bitmaskFromAttributes({ bold: true, italic: true })).toBe(BOLD | ITALIC)
  })

  it('treats a missing bag as unformatted', () => {
    expect(bitmaskFromAttributes(undefined)).toBe(0)
    expect(bitmaskFromAttributes({})).toBe(0)
  })

  it('treats an UNMARKED attribute as off — Loro reports it as explicit null', () => {
    // This is the case that silently re-applies a removed format if you test
    // for key presence instead of the value.
    expect(bitmaskFromAttributes({ bold: null })).toBe(0)
    expect(bitmaskFromAttributes({ bold: false })).toBe(0)
    expect(bitmaskFromAttributes({ bold: null, italic: true })).toBe(ITALIC)
  })

  it('ignores foreign attributes', () => {
    expect(bitmaskFromAttributes({ bold: true, comment: 'x' })).toBe(BOLD)
  })
})

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

describe('normalizeRuns', () => {
  it('coalesces adjacent equal-format runs', () => {
    expect(
      normalizeRuns([
        { text: 'ab', format: 0 },
        { text: 'cd', format: 0 },
      ]),
    ).toEqual([{ text: 'abcd', format: 0 }])
  })

  it('keeps differing formats apart', () => {
    expect(
      normalizeRuns([
        { text: 'ab', format: BOLD },
        { text: 'cd', format: 0 },
      ]),
    ).toEqual([
      { text: 'ab', format: BOLD },
      { text: 'cd', format: 0 },
    ])
  })

  it('drops empty runs, including between two mergeable ones', () => {
    expect(
      normalizeRuns([
        { text: 'ab', format: 0 },
        { text: '', format: BOLD },
        { text: 'cd', format: 0 },
      ]),
    ).toEqual([{ text: 'abcd', format: 0 }])
  })

  it('does not mutate its input', () => {
    const input: TextRun[] = [
      { text: 'ab', format: 0 },
      { text: 'cd', format: 0 },
    ]
    normalizeRuns(input)
    expect(input).toHaveLength(2)
  })

  it('runsText concatenates', () => {
    expect(
      runsText([
        { text: 'ab', format: BOLD },
        { text: 'cd', format: 0 },
      ]),
    ).toBe('abcd')
  })
})

describe('runsFromDelta', () => {
  it('projects a Loro delta into normalized runs', () => {
    expect(
      runsFromDelta([
        { insert: 'ab', attributes: { bold: true } },
        { insert: 'cd' },
        { insert: 'ef', attributes: { bold: null } },
      ]),
    ).toEqual([
      { text: 'ab', format: BOLD },
      { text: 'cdef', format: 0 },
    ])
  })

  it('projects a live LoroText', () => {
    const doc = new LoroDoc()
    initDoc(doc, LORO_TEXT_FORMATS)
    const text = doc.getText('t')
    text.insert(0, 'abcdef')
    text.mark({ start: 0, end: 2 }, 'bold', true)
    text.mark({ start: 1, end: 3 }, 'italic', true)
    doc.commit()

    expect(runsFromText(text)).toEqual([
      { text: 'a', format: BOLD },
      { text: 'b', format: BOLD | ITALIC },
      { text: 'c', format: ITALIC },
      { text: 'def', format: 0 },
    ])
  })
})

// ---------------------------------------------------------------------------
// diffRunFormats
// ---------------------------------------------------------------------------

const plain = (text: string): TextRun[] => [{ text, format: 0 }]

describe('diffRunFormats', () => {
  it('emits nothing when the runs already match', () => {
    expect(diffRunFormats(plain('abc'), plain('abc'))).toEqual([])
  })

  it('emits nothing when only the SEGMENTATION differs', () => {
    // Lexical split a node where Loro did not. Same document, no ops.
    const current = [{ text: 'abc', format: BOLD }]
    const target = [
      { text: 'a', format: BOLD },
      { text: 'bc', format: BOLD },
    ]
    expect(diffRunFormats(current, target)).toEqual([])
  })

  it('marks a newly formatted range', () => {
    expect(
      diffRunFormats(plain('abcdef'), [
        { text: 'ab', format: 0 },
        { text: 'cd', format: BOLD },
        { text: 'ef', format: 0 },
      ]),
    ).toEqual([{ kind: 'mark', start: 2, end: 4, format: 'bold' }])
  })

  it('unmarks a removed format', () => {
    expect(diffRunFormats([{ text: 'abc', format: BOLD }], plain('abc'))).toEqual([
      { kind: 'unmark', start: 0, end: 3, format: 'bold' },
    ])
  })

  it('coalesces contiguous differing characters into ONE op', () => {
    const current = [
      { text: 'a', format: 0 },
      { text: 'b', format: 0 },
      { text: 'c', format: 0 },
    ]
    expect(diffRunFormats(current, [{ text: 'abc', format: BOLD }])).toEqual([
      { kind: 'mark', start: 0, end: 3, format: 'bold' },
    ])
  })

  it('emits separate ops for disjoint ranges of the same format', () => {
    expect(
      diffRunFormats(plain('abcdef'), [
        { text: 'a', format: BOLD },
        { text: 'bcde', format: 0 },
        { text: 'f', format: BOLD },
      ]),
    ).toEqual([
      { kind: 'mark', start: 0, end: 1, format: 'bold' },
      { kind: 'mark', start: 5, end: 6, format: 'bold' },
    ])
  })

  it('emits a mark and an unmark for the same format in one diff', () => {
    const current = [
      { text: 'abc', format: BOLD },
      { text: 'def', format: 0 },
    ]
    const target = [
      { text: 'abc', format: 0 },
      { text: 'def', format: BOLD },
    ]
    // Ops for one format come in positional order.
    expect(diffRunFormats(current, target)).toEqual([
      { kind: 'unmark', start: 0, end: 3, format: 'bold' },
      { kind: 'mark', start: 3, end: 6, format: 'bold' },
    ])
  })

  it('diffs each format INDEPENDENTLY — the point of decomposing the bitmask', () => {
    const current = [{ text: 'abcd', format: BOLD }]
    const target = [{ text: 'abcd', format: ITALIC }]
    expect(diffRunFormats(current, target)).toEqual([
      { kind: 'unmark', start: 0, end: 4, format: 'bold' },
      { kind: 'mark', start: 0, end: 4, format: 'italic' },
    ])
  })

  it('handles every format', () => {
    for (const format of LORO_TEXT_FORMATS) {
      expect(diffRunFormats(plain('ab'), [{ text: 'ab', format: formatBit(format) }])).toEqual([
        { kind: 'mark', start: 0, end: 2, format },
      ])
    }
  })

  it('emits UTF-16 offsets, so astral characters span two positions', () => {
    expect(
      diffRunFormats(plain('😀ab'), [
        { text: '😀', format: BOLD },
        { text: 'ab', format: 0 },
      ]),
    ).toEqual([{ kind: 'mark', start: 0, end: 2, format: 'bold' }])
  })

  it('REFUSES mismatched lengths rather than silently misaligning formats', () => {
    expect(() => diffRunFormats(plain('abc'), plain('abcd'))).toThrow(
      /requires equal-length runs.*current has 3 chars, target has 4/s,
    )
  })

  it('handles empty text', () => {
    expect(diffRunFormats([], [])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The three measured divergences — the reason the run diff exists
// ---------------------------------------------------------------------------

const makeEditor = (): LexicalEditor =>
  createHeadlessEditor({
    namespace: 'text-test',
    onError: (error: Error) => {
      throw error
    },
  })

interface LexicalCase {
  readonly runs: readonly TextRun[]
  readonly caret: number
  readonly toggle?: readonly LoroTextFormat[]
  readonly type: string
}

/**
 * Drive real Lexical, applying the two browser-path caret rules headless
 * Lexical does not (boundary normalization + format inheritance). See the
 * fidelity note in `expand-semantics.test.ts` — this is the same harness.
 */
const runLexical = (testCase: LexicalCase): TextRun[] => {
  const editor = makeEditor()
  let result: TextRun[] = []
  editor.update(
    () => {
      const paragraph = $createParagraphNode()
      const nodes = testCase.runs.map((run) => $createTextNode(run.text).setFormat(run.format))
      paragraph.append(...nodes)
      $getRoot().clear().append(paragraph)

      let index = 0
      let node: TextNode = nodes[0]!
      let offset = 0
      for (const candidate of nodes) {
        const length = candidate.getTextContentSize()
        const local = testCase.caret - index
        if (local >= 0 && local <= length) {
          node = candidate
          offset = local
          break
        }
        index += length
      }
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
      selection.setFormat(node.getFormat())
      for (const format of testCase.toggle ?? []) selection.formatText(format as TextFormatType)
      if (testCase.type !== '') selection.insertText(testCase.type)
    },
    { discrete: true },
  )
  editor.getEditorState().read(() => {
    result = normalizeRuns(
      $getRoot()
        .getAllTextNodes()
        .map((node) => ({ text: node.getTextContent(), format: node.getFormat() })),
    )
  })
  return result
}

/** Seed a LoroText with runs as independent named marks. */
const seed = (text: LoroText, runs: readonly TextRun[]): void => {
  text.insert(0, runsText(runs))
  let index = 0
  for (const run of runs) {
    const end = index + run.text.length
    for (const format of formatsFromBitmask(run.format)) {
      text.mark({ start: index, end }, format, true)
    }
    index = end
  }
}

/**
 * The FULL outbound strategy: apply the text edit (letting `expand` do whatever
 * it does), then diff the resulting formats against what Lexical produced and
 * replay the difference as explicit mark/unmark ops.
 */
const runBinding = (testCase: LexicalCase): TextRun[] => {
  const doc = new LoroDoc()
  initDoc(doc, LORO_TEXT_FORMATS)
  const text = doc.getText('t')
  seed(text, testCase.runs)
  doc.commit()

  const target = runLexical(testCase)

  // 1. Reconcile the text content, biased to the caret.
  applyTextDiff(text, diffTextWithCursor(text.toString(), runsText(target), testCase.caret))
  doc.commit()
  // 2. Replay the resulting node state as explicit format ops.
  applyMarkOps(text, diffRunFormats(runsFromText(text), target))
  doc.commit()

  return runsFromText(text)
}

describe('the run diff reproduces Lexical on the three measured divergences', () => {
  it('DIVERGENCE 1: typing at index 0 of a formatted first run', () => {
    const testCase: LexicalCase = { runs: [{ text: 'abc', format: BOLD }], caret: 0, type: 'X' }
    expect(runLexical(testCase)).toEqual([{ text: 'Xabc', format: BOLD }])
    expect(runBinding(testCase)).toEqual(runLexical(testCase))
  })

  it('DIVERGENCE 2: a format toggled ON at a collapsed caret', () => {
    const testCase: LexicalCase = {
      runs: [{ text: 'abc', format: 0 }],
      caret: 3,
      toggle: ['bold'],
      type: 'X',
    }
    expect(runLexical(testCase)).toEqual([
      { text: 'abc', format: 0 },
      { text: 'X', format: BOLD },
    ])
    expect(runBinding(testCase)).toEqual(runLexical(testCase))
  })

  it('DIVERGENCE 3: a format toggled OFF at a collapsed caret', () => {
    const testCase: LexicalCase = {
      runs: [{ text: 'abc', format: BOLD }],
      caret: 3,
      toggle: ['bold'],
      type: 'X',
    }
    expect(runLexical(testCase)).toEqual([
      { text: 'abc', format: BOLD },
      { text: 'X', format: 0 },
    ])
    expect(runBinding(testCase)).toEqual(runLexical(testCase))
  })

  it('reproduces Lexical across every boundary case, for every format', () => {
    for (const format of LORO_TEXT_FORMATS) {
      const f = formatBit(format)
      const cases: readonly LexicalCase[] = [
        { runs: [{ text: 'abc', format: f }], caret: 3, type: 'X' },
        { runs: [{ text: 'abc', format: f }], caret: 0, type: 'X' },
        { runs: [{ text: 'abc', format: f }], caret: 1, type: 'X' },
        {
          runs: [
            { text: 'ab', format: f },
            { text: 'cd', format: 0 },
          ],
          caret: 2,
          type: 'X',
        },
        {
          runs: [
            { text: 'ab', format: 0 },
            { text: 'cd', format: f },
          ],
          caret: 2,
          type: 'X',
        },
        {
          runs: [
            { text: 'ab', format: f },
            { text: 'cd', format: 0 },
          ],
          caret: 4,
          type: 'X',
        },
        { runs: [{ text: 'abc', format: 0 }], caret: 3, toggle: [format], type: 'X' },
        { runs: [{ text: 'abc', format: f }], caret: 3, toggle: [format], type: 'X' },
      ]
      for (const testCase of cases) {
        expect(runBinding(testCase), `format=${format} caret=${testCase.caret}`).toEqual(
          runLexical(testCase),
        )
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Cursor-biased text diff
// ---------------------------------------------------------------------------

describe('diffTextWithCursor', () => {
  const apply = (a: string, d: { index: number; remove: number; insert: string }): string =>
    a.slice(0, d.index) + d.insert + a.slice(d.index + d.remove)

  it('reports no change for equal strings', () => {
    const diff = diffTextWithCursor('abc', 'abc', 1)
    expect(diff.remove).toBe(0)
    expect(diff.insert).toBe('')
  })

  it('places an unambiguous insert correctly regardless of cursor', () => {
    expect(diffTextWithCursor('ac', 'abc', 2)).toEqual({ index: 1, remove: 0, insert: 'b' })
  })

  it('BIASES a repeated-character insert to the cursor', () => {
    // Typing 'o' at the end of 'foo' gives 'fooo'. A plain diff reports index 1;
    // the cursor-biased diff reports index 3 — where the user actually typed.
    // Getting this wrong drags every remote caret and can attach the wrong mark.
    expect(diffTextWithCursor('foo', 'fooo', 4)).toEqual({ index: 3, remove: 0, insert: 'o' })
    // The cursor-free diff is the leftmost placement — wrong for typing.
    expect(diffText('foo', 'fooo')).toEqual({ index: 1, remove: 0, insert: 'o' })
  })

  it('biases a repeated-character insert at the START to the cursor', () => {
    expect(diffTextWithCursor('aab', 'aaab', 1)).toEqual({ index: 1, remove: 0, insert: 'a' })
  })

  it('handles a deletion', () => {
    expect(diffTextWithCursor('abcd', 'abd', 2)).toEqual({ index: 2, remove: 1, insert: '' })
  })

  it('biases a repeated-character deletion to the cursor', () => {
    expect(diffTextWithCursor('foo', 'fo', 2)).toEqual({ index: 2, remove: 1, insert: '' })
  })

  it('handles a replacement', () => {
    expect(diffTextWithCursor('abcd', 'aXd', 2)).toEqual({ index: 1, remove: 2, insert: 'X' })
  })

  it('handles insert into empty and delete to empty', () => {
    expect(diffTextWithCursor('', 'abc', 3)).toEqual({ index: 0, remove: 0, insert: 'abc' })
    expect(diffTextWithCursor('abc', '', 0)).toEqual({ index: 0, remove: 3, insert: '' })
  })

  it('never splits a surrogate pair when inserting an astral character', () => {
    const diff = diffTextWithCursor('ab', 'a😀b', 3)
    expect(diff).toEqual({ index: 1, remove: 0, insert: '😀' })
    expect(apply('ab', diff)).toBe('a😀b')
  })

  it('never splits a surrogate pair when deleting an astral character', () => {
    const diff = diffTextWithCursor('a😀b', 'ab', 1)
    expect(apply('a😀b', diff)).toBe('ab')
    expect(diff.remove).toBe(2)
  })

  it('handles adjacent identical astral characters', () => {
    const diff = diffTextWithCursor('😀😀', '😀😀😀', 6)
    expect(apply('😀😀', diff)).toBe('😀😀😀')
    expect(diff.insert).toBe('😀')
  })

  it('always produces a diff that reconstructs the target', () => {
    let seed = 0x9e3779b9
    const random = (n: number): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed % n
    }
    const alphabet = 'aab😀 \n'
    const randomString = (max: number): string => {
      let out = ''
      for (let i = random(max); i > 0; i--) out += alphabet[random(alphabet.length)]
      return out
    }
    for (let i = 0; i < 2000; i++) {
      const a = randomString(12)
      const b = randomString(12)
      const cursor = random(b.length + 1)
      expect(apply(a, diffTextWithCursor(a, b, cursor)), `${a} -> ${b} @${cursor}`).toBe(b)
    }
  })
})

describe('applyTextDiff', () => {
  const loroText = (initial: string): { doc: LoroDoc; text: LoroText } => {
    const doc = new LoroDoc()
    initDoc(doc, LORO_TEXT_FORMATS)
    const text = doc.getText('t')
    text.insert(0, initial)
    doc.commit()
    return { doc, text }
  }

  it('applies an insert', () => {
    const { doc, text } = loroText('ac')
    applyTextDiff(text, diffTextWithCursor('ac', 'abc', 2))
    doc.commit()
    expect(text.toString()).toBe('abc')
  })

  it('applies a replacement', () => {
    const { doc, text } = loroText('abcd')
    applyTextDiff(text, diffTextWithCursor('abcd', 'aXd', 2))
    doc.commit()
    expect(text.toString()).toBe('aXd')
  })

  it('writes NOTHING for a no-op diff, so a format-only edit emits no text op', () => {
    const { doc, text } = loroText('abc')
    const before = doc.export({ mode: 'update' }).length
    applyTextDiff(text, diffTextWithCursor('abc', 'abc', 1))
    doc.commit()
    expect(text.toString()).toBe('abc')
    expect(doc.export({ mode: 'update' }).length).toBe(before)
  })
})

describe('applyMarkOps', () => {
  it('applies marks and unmarks to a LoroText', () => {
    const doc = new LoroDoc()
    initDoc(doc, LORO_TEXT_FORMATS)
    const text = doc.getText('t')
    text.insert(0, 'abcdef')
    text.mark({ start: 0, end: 6 }, 'bold', true)
    doc.commit()

    const target: TextRun[] = [
      { text: 'ab', format: BOLD },
      { text: 'cd', format: ITALIC },
      { text: 'ef', format: BOLD },
    ]
    applyMarkOps(text, diffRunFormats(runsFromText(text), target))
    doc.commit()

    expect(runsFromText(text)).toEqual(target)
  })

  it('round-trips: diff then apply reaches the target for every format', () => {
    for (const format of LORO_TEXT_FORMATS) {
      const doc = new LoroDoc()
      initDoc(doc, LORO_TEXT_FORMATS)
      const text = doc.getText('t')
      text.insert(0, 'abcdef')
      doc.commit()

      const target: TextRun[] = [
        { text: 'ab', format: 0 },
        { text: 'cd', format: formatBit(format) },
        { text: 'ef', format: 0 },
      ]
      applyMarkOps(text, diffRunFormats(runsFromText(text), target))
      doc.commit()
      expect(runsFromText(text)).toEqual(target)
    }
  })
})
