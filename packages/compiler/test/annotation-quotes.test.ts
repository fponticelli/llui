import { describe, it, expect } from 'vitest'
import { extractMsgAnnotations as extractAnnotations } from '../src/msg-annotations.js'
import { extractMsgSchema as extractSchema } from '../src/msg-schema.js'
import { parseModule } from '../src/parse.js'

// The extractors take a parsed module (one parse per pass, real-filename
// ScriptKind — #93); these tests are about the grammar, so they name a `.ts`
// module and hand over the text.
const extractMsgAnnotations = (src: string, typeName?: string) =>
  extractAnnotations(parseModule('msg.ts', src), typeName)
const extractMsgSchema = (src: string, typeName?: string) =>
  extractSchema(parseModule('msg.ts', src), typeName)

// Issue #89 — every annotation predicate parser used a `[^"”]*` character
// class, so a predicate containing a quote was TRUNCATED at that quote and
// the escape-your-quotes workaround the docs advertised produced a predicate
// ending in a backslash. A truncated `@routeGated` is an always-open gate and
// a truncated `@validates` accepts everything, both silently (the agent
// boundary catches the resulting SyntaxError and degrades to "allow").
//
// The grammar is now a real quoted-string tokenizer:
//   - `"…"` and `“…”` (a curly opener must be closed by a curly closer),
//   - `\"` / `\“` / `\”` / `\\` are escapes,
//   - every OTHER backslash sequence is preserved verbatim, so a regex
//     predicate (`/^\d+$/`) survives the trip.

describe('annotation args — embedded quotes round-trip (issue #89)', () => {
  it('@routeGated keeps an escaped quote in the predicate AND in the reason', () => {
    const src = `
type Msg =
  /** @routeGated("state.mode === \\"admin\\"", "only while the \\"admin\\" mode is active") */
  | { type: 'purge' }
`
    const ann = extractMsgAnnotations(src)
    expect(ann?.purge?.routeGate).toBe('state.mode === "admin"')
    expect(ann?.purge?.routeGateReason).toBe('only while the "admin" mode is active')
  })

  it('@intent keeps an escaped quote', () => {
    const src = `
type Msg =
  /** @intent("Publish the \\"draft\\" revision") */
  | { type: 'publish' }
`
    expect(extractMsgAnnotations(src)?.publish?.intent).toBe('Publish the "draft" revision')
  })

  it('@example keeps an escaped quote, across multiple tags', () => {
    const src = `
type Msg =
  /**
   * @example("send({ type: 'x', label: \\"hi\\" })")
   * @example("send({ type: 'x', label: \\"bye\\" })")
   */
  | { type: 'x', label: string }
`
    expect(extractMsgAnnotations(src)?.x?.examples).toEqual([
      `send({ type: 'x', label: "hi" })`,
      `send({ type: 'x', label: "bye" })`,
    ])
  })

  it('@warning keeps an escaped quote', () => {
    const src = `
type Msg =
  /** @warning("Overwrites the \\"cloud\\" copy") */
  | { type: 'sync' }
`
    expect(extractMsgAnnotations(src)?.sync?.warning).toBe('Overwrites the "cloud" copy')
  })

  it('@emits keeps an escaped quote in each kind', () => {
    const src = `
type Msg =
  /** @emits("http:\\"GET\\"", "log") */
  | { type: 'load' }
`
    expect(extractMsgAnnotations(src)?.load?.emits).toEqual(['http:"GET"', 'log'])
  })

  it('@should keeps an escaped quote', () => {
    const src = `
      type Msg =
        | {
            type: 'setMeta'
            /** @should("Quote the source, e.g. \\"per the 2024 filing\\".") */
            source?: string
          }
    `
    expect(extractMsgSchema(src)?.variants.setMeta?.source).toEqual({
      type: 'string',
      optional: true,
      priority: 'should',
      hint: 'Quote the source, e.g. "per the 2024 filing".',
    })
  })

  it('@validates keeps an escaped quote — the predicate stays a real predicate', () => {
    const src = `
      type Msg =
        | {
            type: 'SetRole'
            /** @validates("v === \\"admin\\" || v === \\"user\\"") */
            role: string
          }
    `
    expect(extractMsgSchema(src)?.variants.SetRole?.role).toEqual({
      type: 'string',
      validates: 'v === "admin" || v === "user"',
    })
  })

  it('preserves a non-escape backslash sequence verbatim (regex predicates survive)', () => {
    const src = `
      type Msg =
        | {
            type: 'SetZip'
            /** @validates("/^\\d{5}$/.test(v)") */
            zip: string
          }
    `
    expect(extractMsgSchema(src)?.variants.SetZip?.zip).toEqual({
      type: 'string',
      validates: '/^\\d{5}$/.test(v)',
    })
  })

  it('unescapes a literal backslash (\\\\ → \\)', () => {
    const src = `
      type Msg =
        | {
            type: 'SetPath'
            /** @validates("v !== \\\\") */
            path: string
          }
    `
    expect(extractMsgSchema(src)?.variants.SetPath?.path).toEqual({
      type: 'string',
      validates: 'v !== \\',
    })
  })

  it('curly quotes still work, and an escaped curly quote round-trips', () => {
    const src = `
type Msg =
  /** @intent(“Say \\”hi\\” to the user”) */
  | { type: 'greet' }
`
    expect(extractMsgAnnotations(src)?.greet?.intent).toBe('Say ”hi” to the user')
  })

  it('single quotes inside a double-quoted predicate need no escaping (unchanged)', () => {
    const src = `
type Msg =
  /** @routeGated("state.step === 'review'") */
  | { type: 'submit' }
`
    expect(extractMsgAnnotations(src)?.submit?.routeGate).toBe("state.step === 'review'")
  })

  it('a MALFORMED tag yields no value at all — never a truncated one', () => {
    // An UNESCAPED inner quote is ambiguous (is `"x"` a second argument?).
    // The parser refuses it rather than guessing; the `agent-annotation-syntax`
    // lint rule turns it into a build error so it cannot ship.
    const src = `
type Msg =
  /** @routeGated("state.title === "x"") */
  | { type: 'go' }
`
    const ann = extractMsgAnnotations(src)
    expect(ann?.go?.routeGate).toBeNull()

    const fieldSrc = `
      type Msg =
        | {
            type: 'SetRole'
            /** @validates("v === "admin"") */
            role: string
          }
    `
    // A bare type (no rich descriptor) — not a descriptor carrying a
    // truncated `validates: 'v === '` that would accept everything.
    expect(extractMsgSchema(fieldSrc)?.variants.SetRole?.role).toBe('string')
  })

  it('a string may wrap across JSDoc lines — the `* ` decoration is not content', () => {
    // `@llui/agent`'s own Msg union wraps a long `@intent`. The old character
    // class matched across lines and kept the literal ` * ` prefixes, shipping
    // that noise to the LLM.
    const src = `
type Msg =
  /**
   * @intent("Disconnect the active agent session and clear all
   * persisted credentials. Use when the user clicks Disconnect.")
   */
  | { type: 'Disconnect' }
`
    expect(extractMsgAnnotations(src)?.Disconnect?.intent).toBe(
      'Disconnect the active agent session and clear all persisted credentials. Use when the user clicks Disconnect.',
    )
  })

  it('keeps an EMPTY argument — well-formed is not the same as absent', () => {
    // `@example("")` is well-formed and its value is `''`. Dropping it on
    // truthiness would be the silent drop this whole change exists to stop.
    const src = `
type Msg =
  /** @example("") @intent("") @warning("") */
  | { type: 'x' }
`
    const ann = extractMsgAnnotations(src)
    expect(ann?.x?.examples).toEqual([''])
    expect(ann?.x?.intent).toBe('')
    expect(ann?.x?.warning).toBe('')
  })

  it('an unterminated string yields no value', () => {
    const src = `
type Msg =
  /** @intent("never closed */
  | { type: 'oops' }
`
    expect(extractMsgAnnotations(src)?.oops?.intent).toBeNull()
  })
})

// Issue #98 — the `@example({…})` JSON-literal form.
//
// Before #89 the parsers required a quote right after `(`, so
// `@example({"type":"select"})` was silently ignored: thirteen files' worth of
// authors independently reached for that spelling and none of their examples
// ever reached the agent. #89 converted them to the escaped-quote form, which
// is correct but genuinely hostile to write and to read. The tokenizer already
// tracks quote state, so brace-matching on top of it is the cheap part; the
// load-bearing part is that a malformed literal is an ERROR, never a silent
// drop — the silent drop is what made this invisible for a year.
//
// The form is scoped to `@example` ALONE. `@routeGated`/`@validates` take
// JavaScript predicates and `@intent`/`@warning`/`@should` take prose; a brace
// there is a mistake, and accepting it would invent a second spelling of a
// concept that has none.
describe('annotation args — the `@example({…})` JSON form (issue #98)', () => {
  const examples = (body: string): string[] | undefined =>
    extractMsgAnnotations(`type Msg =\n  /** ${body} */\n  | { type: 'x' }\n`)?.x?.examples

  it("parses a JSON object argument and produces the quoted form's value", () => {
    expect(examples('@example({"type":"select","id":42})')).toEqual(['{"type":"select","id":42}'])
    // The differential: both spellings of the same example reach `$ma`
    // identically. That equality is what makes the JSON form a convenience
    // rather than a second dialect.
    expect(examples('@example({"type":"select","id":42})')).toEqual(
      examples('@example("{\\"type\\":\\"select\\",\\"id\\":42}")'),
    )
  })

  it('does not end the scan on a brace inside a string', () => {
    expect(examples('@example({"a":"}"})')).toEqual(['{"a":"}"}'])
    expect(examples('@example({"a":"{"})')).toEqual(['{"a":"{"}'])
    // …nor on a brace behind an escaped quote inside a string.
    expect(examples('@example({"a":"\\"}"})')).toEqual(['{"a":"\\"}"}'])
  })

  it('matches nested braces', () => {
    expect(examples('@example({"a":{"b":{"c":1}}})')).toEqual(['{"a":{"b":{"c":1}}}'])
  })

  it('wraps across JSDoc lines like a quoted string does', () => {
    const src = `
type Msg =
  /**
   * @example({
   *   "type": "select",
   *   "id": 42
   * })
   */
  | { type: 'x' }
`
    const got = extractMsgAnnotations(src)?.x?.examples
    expect(got).toHaveLength(1)
    expect(JSON.parse(got![0]!)).toEqual({ type: 'select', id: 42 })
  })

  it('accepts a JSON array too — an example payload is not always an object', () => {
    expect(examples('@example([{"type":"a"},{"type":"b"}])')).toEqual([
      '[{"type":"a"},{"type":"b"}]',
    ])
  })

  it('DROPS a malformed literal rather than half-reading it', () => {
    // The lint rule turns each of these into a build error (see
    // rules.test.ts); the extractor must never emit a partial value.
    expect(examples('@example({not json})')).toEqual([])
    expect(examples("@example({'type':'select'})")).toEqual([])
    expect(examples('@example({"a":1,})')).toEqual([])
    expect(examples('@example({"a":1)')).toEqual([])
  })

  it('mixes with the quoted form in one JSDoc block', () => {
    expect(examples('@example("plain prose") @example({"type":"x"})')).toEqual([
      'plain prose',
      '{"type":"x"}',
    ])
  })

  it('does NOT extend the brace form to any other tag', () => {
    const ann = (body: string) =>
      extractMsgAnnotations(`type Msg =\n  /** ${body} */\n  | { type: 'x' }\n`)?.x
    expect(ann('@intent({"a":1})')?.intent).toBeNull()
    expect(ann('@warning({"a":1})')?.warning).toBeNull()
    expect(ann('@routeGated({"a":1})')?.routeGate).toBeNull()
    expect(ann('@emits({"a":1})')?.emits).toEqual([])
  })

  it('leaves the quoted form byte-for-byte unchanged', () => {
    expect(examples('@example("send({ type: \'x\' })")')).toEqual(["send({ type: 'x' })"])
    expect(examples('@example("")')).toEqual([''])
  })
})
