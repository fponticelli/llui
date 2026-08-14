// Annotation argument grammar — the ONE tokenizer every agent-annotation
// parser goes through (`@intent`, `@example`, `@warning`, `@emits`,
// `@routeGated` in msg-annotations.ts; `@should`, `@validates` in
// msg-schema.ts).
//
// WHY THIS EXISTS (issue #89): each of those parsers used to carry its own
// `["“]([^"”]*)["”]` regex. A character class cannot express a quoted string —
// it stops at the FIRST quote, escaped or not — so a predicate containing a
// quote was silently TRUNCATED, and the "escape your quotes" workaround the
// docs advertised produced a predicate ending in a backslash. The damage lands
// at the agent boundary, which compiles these strings with `new Function`
// inside a try/catch: a truncated `@routeGated` fails to compile and degrades
// to an ALWAYS-OPEN gate; a truncated `@validates` degrades to ACCEPT
// EVERYTHING. No crash, no warning — a security-adjacent annotation quietly
// meaning the opposite of what the author wrote.
//
// THE GRAMMAR
//
//   @tag ( <string> [, <string>]* )
//   @example ( <json> )                     ← the ONE tag taking a bare literal
//
//   - The `(` must follow the tag on the SAME line (only spaces/tabs between).
//     Anything else is not a call — notably standard block-form JSDoc
//     (`@example` followed by a code block), which is left alone.
//   - A string is `"…"` or `“…”`. A curly opener must be closed by a curly
//     closer; the pairs do not mix.
//   - A <json> is a `{…}` object or `[…]` array literal, scanned to its
//     BALANCED closer (braces inside JSON strings do not count) and captured
//     VERBATIM, then required to parse as JSON. See `allowsJsonArgument`.
//   - ESCAPES: `\"`, `\“`, `\”` and `\\` produce that character. EVERY OTHER
//     backslash sequence is preserved VERBATIM (`\d` stays `\d`), so a regex
//     predicate survives the trip. Escaping is therefore the supported way to
//     put a quote inside a predicate, and it round-trips.
//   - A string MAY wrap across JSDoc lines: the continuation's `\n   * `
//     decoration collapses to one space, so long `@intent` prose reads as
//     written. JSDoc line prefixes between arguments are skipped the same way.
//
// Anything this grammar cannot read is an ERROR — never a partially-read
// value. Callers get `null`/`[]` (so nothing malformed is ever emitted) and
// the `agent-annotation-syntax` lint rule turns the same errors into a
// non-bypassable build failure (see signals/rules.ts).

/** Arity of one annotation tag. `max: null` means variadic. */
export interface AnnotationTagSpec {
  min: number
  max: number | null
  /**
   * Whether an argument may be written as a bare JSON object/array literal
   * instead of a quoted string (issue #98).
   *
   * `@example` ONLY, and deliberately so. An example IS a payload — a JSON
   * object is what the tag's value already spells, just with every inner quote
   * escaped, and thirteen files' worth of authors independently reached for
   * the unescaped form before #89 made it an error. Every other tag takes
   * something a JSON literal cannot be: `@routeGated`/`@validates` take a
   * JavaScript predicate, `@intent`/`@warning`/`@should` take prose, `@emits`
   * takes effect kinds. Accepting a brace there would invent a second spelling
   * for a concept that has exactly one — so a brace after any other tag stays
   * a build error.
   */
  json?: true
}

/**
 * Every tag that takes a parenthesized argument list. Keyed by tag name
 * WITHOUT the `@`. Flag-style tags (`@requiresConfirm`, `@humanOnly`, …) take
 * no arguments and are not part of this grammar.
 */
export const ANNOTATION_TAGS: Readonly<Record<string, AnnotationTagSpec>> = {
  intent: { min: 1, max: 1 },
  example: { min: 1, max: 1, json: true },
  warning: { min: 1, max: 1 },
  emits: { min: 1, max: null },
  routeGated: { min: 1, max: 2 },
  should: { min: 1, max: 1 },
  validates: { min: 1, max: 1 },
}

/** True when `tag` accepts the bare JSON-literal argument form. */
function allowsJsonArgument(tag: string): boolean {
  return ANNOTATION_TAGS[tag]?.json === true
}

/** A well-formed `@tag(…)` call and its parsed arguments. */
export interface AnnotationCall {
  tag: string
  args: string[]
  /** Offset of the `@` within the scanned comment text. */
  start: number
  /** Length from the `@` through the closing `)`. */
  length: number
}

/** A malformed `@tag(…)` call. Positions are relative to the scanned text. */
export interface AnnotationSyntaxError {
  tag: string
  message: string
  start: number
  length: number
}

export interface AnnotationScan {
  calls: AnnotationCall[]
  errors: AnnotationSyntaxError[]
}

const CURLY_OPEN = '“'
const CURLY_CLOSE = '”'

function isIdentChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_$]/.test(ch)
}

/**
 * Skip inter-token filler: whitespace plus the `*` that opens a continued
 * JSDoc line. Returns `text.length` when the comment's closing delimiter is
 * reached, so the caller reports "unterminated" rather than choking on `/`.
 */
function skipFiller(text: string, from: number): number {
  let k = from
  for (;;) {
    while (k < text.length && (text[k] === ' ' || text[k] === '\t' || text[k] === '\r')) k++
    if (text[k] === '*' && text[k + 1] === '/') return text.length
    if (text[k] === '\n') {
      k++
      while (k < text.length && (text[k] === ' ' || text[k] === '\t')) k++
      if (text[k] === '*' && text[k + 1] !== '/') k++
      continue
    }
    return k
  }
}

/**
 * Read one quoted string starting at `from` (which must be an opening quote).
 * Returns null when the string is unterminated (end of comment, or a
 * mismatched closer).
 *
 * A string MAY wrap across JSDoc lines — long `@intent` prose does, in this
 * repo's own sources. The continuation's `\n   * ` decoration is NOT content:
 * it collapses to a single space, so the string means what it looks like it
 * means. (The old character class kept the literal ` * ` and shipped it to the
 * LLM.)
 */
function readQuoted(text: string, from: number): { value: string; end: number } | null {
  const open = text[from]
  const close = open === '"' ? '"' : CURLY_CLOSE
  let out = ''
  let k = from + 1
  while (k < text.length) {
    const ch = text[k]
    if (ch === undefined) break
    if (ch === '\n') {
      let j = k + 1
      while (text[j] === ' ' || text[j] === '\t' || text[j] === '\r') j++
      if (text[j] === '*' && text[j + 1] === '/') return null
      if (text[j] === '*') {
        j++
        while (text[j] === ' ' || text[j] === '\t') j++
      }
      out = `${out.replace(/[ \t]+$/, '')} `
      k = j
      continue
    }
    if (ch === '\\') {
      const next = text[k + 1]
      if (next === '"' || next === CURLY_OPEN || next === CURLY_CLOSE || next === '\\') {
        out += next
        k += 2
        continue
      }
      // Not an escape this grammar owns — keep the backslash verbatim so
      // `\d`, `\s`, `\.` in a regex predicate arrive intact.
      out += ch
      k++
      continue
    }
    if (ch === close) return { value: out, end: k + 1 }
    // A string never runs past the end of the comment.
    if (ch === '*' && text[k + 1] === '/') return null
    out += ch
    k++
  }
  return null
}

/**
 * Read a bare JSON object/array literal starting at `from` (which must be `{`
 * or `[`), scanning to its BALANCED closer. Returns the captured text verbatim
 * — this grammar does not re-serialize; the author's spelling is what reaches
 * the agent, exactly as the quoted form's does.
 *
 * String-awareness is the whole trick and the reason this can live on top of
 * the existing tokenizer rather than beside it: a `}` inside a JSON string
 * (`{"a":"}"}`) must not end the scan, and neither must one behind a JSON
 * escape (`{"a":"\"}"}`). Only `"` opens a string — JSON has no other quote —
 * so `{'a':'}'}` scans "wrong", ends early, and is reported as malformed by
 * the arg-list loop or by the JSON check. That is the correct outcome: it is
 * not JSON either way, and this grammar never guesses.
 *
 * Returns null when the literal is never balanced before the end of the
 * comment, or when a closer meets the wrong opener.
 *
 * Like {@link readQuoted}, a literal MAY wrap across JSDoc lines: the
 * continuation's `\n   * ` decoration is not content and collapses to one
 * space, so a multi-line example object reads as written.
 */
function readJsonLiteral(text: string, from: number): { value: string; end: number } | null {
  const stack: string[] = []
  let out = ''
  let k = from
  let inString = false
  while (k < text.length) {
    const ch = text[k]
    if (ch === undefined) break
    if (ch === '\n') {
      let j = k + 1
      while (text[j] === ' ' || text[j] === '\t' || text[j] === '\r') j++
      if (text[j] === '*' && text[j + 1] === '/') return null
      if (text[j] === '*') {
        j++
        while (text[j] === ' ' || text[j] === '\t') j++
      }
      out = `${out.replace(/[ \t]+$/, '')} `
      k = j
      continue
    }
    if (inString) {
      if (ch === '\\') {
        // A JSON escape is two characters and NEITHER of them closes the
        // string — `"\""` is one string containing a quote.
        out += ch + (text[k + 1] ?? '')
        k += 2
        continue
      }
      if (ch === '"') inString = false
      out += ch
      k++
      continue
    }
    // A literal never runs past the end of the comment.
    if (ch === '*' && text[k + 1] === '/') return null
    if (ch === '"') {
      inString = true
      out += ch
      k++
      continue
    }
    if (ch === '{' || ch === '[') {
      stack.push(ch)
      out += ch
      k++
      continue
    }
    if (ch === '}' || ch === ']') {
      const open = stack.pop()
      if (open === undefined) return null
      if ((ch === '}') !== (open === '{')) return null
      out += ch
      k++
      if (stack.length === 0) return { value: out, end: k }
      continue
    }
    out += ch
    k++
  }
  return null
}

/** A compact, single-line excerpt for quoting the offending call in a message. */
function excerpt(text: string, start: number, end: number): string {
  const raw = text
    .slice(start, Math.min(end, text.length))
    .replace(/\s*\n\s*\*?\s*/g, ' ')
    .trim()
  return raw.length > 60 ? `${raw.slice(0, 59)}…` : raw
}

function malformed(tag: string, detail: string, offending: string): string {
  const form = allowsJsonArgument(tag)
    ? 'The argument must be a quoted string or a JSON object/array literal ' +
      `(e.g. \`@${tag}({"type":"inc"})\`). `
    : 'Arguments must be quoted strings; escape an embedded quote as `\\"` ' +
      `(e.g. \`@${tag}("v === \\"admin\\"")\`) or use single quotes inside the string. `
  return (
    `Malformed \`@${tag}(…)\` annotation — ${detail}: \`${offending}\`. ` +
    form +
    'The compiler refuses to guess: a half-read predicate opens a `@routeGated` ' +
    'gate and makes `@validates` accept everything.'
  )
}

/**
 * Scan `text` (a comment, or any string) for `@tag(…)` calls of the given tags.
 * Defaults to every tag in {@link ANNOTATION_TAGS}. Arity is enforced here, so
 * a call in `calls` is always usable as-is.
 */
export function scanAnnotationCalls(
  text: string,
  tags: readonly string[] = Object.keys(ANNOTATION_TAGS),
): AnnotationScan {
  const calls: AnnotationCall[] = []
  const errors: AnnotationSyntaxError[] = []
  if (!text) return { calls, errors }

  for (const tag of tags) {
    const spec = ANNOTATION_TAGS[tag]
    if (!spec) continue
    const needle = `@${tag}`
    let at = text.indexOf(needle)
    while (at !== -1) {
      const after = at + needle.length
      // `@intentional` must not match `@intent`.
      if (isIdentChar(text[after])) {
        at = text.indexOf(needle, after)
        continue
      }
      let k = after
      while (text[k] === ' ' || text[k] === '\t') k++
      if (text[k] !== '(') {
        // Not the call form — block-form JSDoc (`@example` + code block) or a
        // bare mention in prose. The extractors ignore it; so do we.
        at = text.indexOf(needle, after)
        continue
      }
      const parsed = parseArgList(text, k + 1, tag, at)
      if (parsed.error) {
        errors.push(parsed.error)
        at = text.indexOf(needle, parsed.end)
        continue
      }
      const args = parsed.args
      const arityBad = args.length < spec.min || (spec.max !== null && args.length > spec.max)
      if (arityBad) {
        const expected =
          spec.max === null
            ? `at least ${spec.min}`
            : spec.min === spec.max
              ? `exactly ${spec.min}`
              : `${spec.min}–${spec.max}`
        errors.push({
          tag,
          message: malformed(
            tag,
            `expected ${expected} quoted argument${spec.max === 1 ? '' : 's'}, found ${args.length}`,
            excerpt(text, at, parsed.end),
          ),
          start: at,
          length: parsed.end - at,
        })
      } else {
        calls.push({ tag, args, start: at, length: parsed.end - at })
      }
      at = text.indexOf(needle, parsed.end)
    }
  }
  calls.sort((a, b) => a.start - b.start)
  errors.sort((a, b) => a.start - b.start)
  return { calls, errors }
}

function parseArgList(
  text: string,
  from: number,
  tag: string,
  tagStart: number,
): { args: string[]; end: number; error?: AnnotationSyntaxError } {
  const args: string[] = []
  let k = from
  let wantArg = true
  for (;;) {
    k = skipFiller(text, k)
    const ch = text[k]
    if (ch === undefined) {
      return {
        args,
        end: text.length,
        error: {
          tag,
          message: malformed(
            tag,
            'the argument list is never closed (missing `)`)',
            excerpt(text, tagStart, text.length),
          ),
          start: tagStart,
          length: text.length - tagStart,
        },
      }
    }
    if (ch === ')') return { args, end: k + 1 }
    if (wantArg) {
      // The JSON-literal form (#98), for `@example` alone. Scanned to the
      // balanced closer, captured verbatim, then REQUIRED to parse as JSON:
      // a malformed literal must be a build error, never the silent drop that
      // hid this whole form for a year.
      if (allowsJsonArgument(tag) && (ch === '{' || ch === '[')) {
        const json = readJsonLiteral(text, k)
        if (!json) {
          const end = endOfCall(text, k)
          return {
            args,
            end,
            error: {
              tag,
              message: malformed(
                tag,
                `the \`${ch}\` is never balanced before the end of the comment`,
                excerpt(text, tagStart, end),
              ),
              start: tagStart,
              length: end - tagStart,
            },
          }
        }
        const invalid = jsonSyntaxError(json.value)
        if (invalid !== null) {
          return {
            args,
            end: json.end,
            error: {
              tag,
              message: malformed(
                tag,
                `the object literal is not valid JSON (${invalid})`,
                excerpt(text, tagStart, json.end),
              ),
              start: tagStart,
              length: json.end - tagStart,
            },
          }
        }
        args.push(json.value)
        k = json.end
        wantArg = false
        continue
      }
      if (ch !== '"' && ch !== CURLY_OPEN) {
        const end = endOfCall(text, k)
        return {
          args,
          end,
          error: {
            tag,
            message: malformed(
              tag,
              `expected a quoted string argument, found \`${ch}\``,
              excerpt(text, tagStart, end),
            ),
            start: tagStart,
            length: end - tagStart,
          },
        }
      }
      const str = readQuoted(text, k)
      if (!str) {
        const end = endOfCall(text, k)
        return {
          args,
          end,
          error: {
            tag,
            message: malformed(
              tag,
              'a quoted string is never closed before the end of the comment (a `“` must be closed by a `”`)',
              excerpt(text, tagStart, end),
            ),
            start: tagStart,
            length: end - tagStart,
          },
        }
      }
      args.push(str.value)
      k = str.end
      wantArg = false
      continue
    }
    if (ch === ',') {
      k++
      wantArg = true
      continue
    }
    const end = endOfCall(text, k)
    return {
      args,
      end,
      error: {
        tag,
        message: malformed(
          tag,
          `expected \`,\` or \`)\` after an argument, found \`${ch}\` (an unescaped quote inside the string ends it early)`,
          excerpt(text, tagStart, end),
        ),
        start: tagStart,
        length: end - tagStart,
      },
    }
  }
}

/**
 * `null` when `text` parses as JSON, otherwise the parser's complaint (first
 * line only — `JSON.parse` messages are long and position-relative).
 *
 * This is the second half of the #98 contract, and the reason the form is safe
 * to offer at all: the grammar can read `{not json}` as a balanced literal, so
 * without this check the tag would sail through, reach `$ma`, and hand an LLM
 * a payload it cannot use.
 */
function jsonSyntaxError(text: string): string | null {
  try {
    JSON.parse(text)
    return null
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return message.split('\n')[0] ?? 'invalid JSON'
  }
}

/**
 * Best-effort end of a broken call: the next `)` on the same logical comment,
 * or the end of the line / comment. Used only to bound the reported span and
 * to resume scanning past the broken call.
 */
function endOfCall(text: string, from: number): number {
  for (let k = from; k < text.length; k++) {
    const ch = text[k]
    if (ch === ')') return k + 1
    if (ch === '\n') return k
    if (ch === '*' && text[k + 1] === '/') return k
  }
  return text.length
}

/**
 * Arguments of the FIRST well-formed call of `tag`, or null when the tag is
 * absent or every occurrence is malformed. Malformed never degrades to a
 * partial value — that is the whole point of this module.
 */
export function firstAnnotationArgs(text: string, tag: string): string[] | null {
  const { calls } = scanAnnotationCalls(text, [tag])
  return calls[0]?.args ?? null
}

/** Arguments of every well-formed call of `tag`, in source order. */
export function allAnnotationArgs(text: string, tag: string): string[][] {
  return scanAnnotationCalls(text, [tag]).calls.map((c) => c.args)
}
