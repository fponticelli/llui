/**
 * Wire-format codecs for non-JSON-safe values flowing across the LAP
 * boundary.
 *
 * JSON natively supports `string | number | boolean | null | array |
 * object`. Component messages and state often carry values that don't
 * round-trip through JSON: `Date`, `Blob`, `File`, `Map`, `Set`,
 * `BigInt`, `ArrayBuffer`. A codec is the convention that lets these
 * cross the wire without forcing every component author to invent
 * their own envelope.
 *
 * **Wire convention.** A non-JSON-safe runtime value travels as a
 * tagged object:
 *
 *   { __codec: '<name>', wire: <encoded form> }
 *
 * The runtime walks every value crossing the LAP boundary and applies
 * the codec registry symmetrically:
 *
 *   - **Outgoing** (component → agent, e.g. `stateAfter`): the encoder
 *     looks up a codec whose `matchesRuntime` returns true and replaces
 *     the value with its tagged shape.
 *   - **Incoming** (agent → component, e.g. dispatched `msg`): the
 *     decoder detects the tagged shape, calls the codec's `decode`,
 *     and substitutes the runtime value before `update()` runs.
 *
 * Component code never observes the tagged form. By the time a
 * reducer sees `msg.value`, a real `Date` (or whatever) is in place;
 * by the time the agent reads `stateAfter`, every `Date` has been
 * encoded.
 *
 * **Authoring.** When a Msg variant carries a non-JSON-safe field,
 * tag the variant's JSDoc with both `@intent` and `@codec("<name>")`.
 * For example, a date-input message:
 *
 *     @intent("Set the parsed date")
 *     @codec("iso-date")
 *     | { type: 'setValue'; value: Date | null }
 *
 * The `@codec` tag is documentation for human readers and the
 * eventual schema generator that publishes the message catalogue to
 * the agent client. The runtime encode/decode is registry-driven and
 * doesn't need per-field metadata.
 *
 * **Defaults.** `makeDefaultCodecs()` ships with `iso-date` (Date ↔
 * ISO 8601 string) and `epoch-millis` (Date ↔ number). The
 * `epoch-millis` codec is registered but its `matchesRuntime` returns
 * `false` by default — it's available for explicit decode but doesn't
 * shadow `iso-date` on the encode side. Consumers who prefer epoch
 * millis can construct a registry that lists `epoch-millis` first.
 *
 * **File / Blob.** Not in the default registry. File/Blob handling is
 * environment-specific (browser File API vs. Node Buffer vs. workers)
 * and the encoded form is large enough that consumers should opt in
 * deliberately. Provide your own codec via `registry.register({...})`
 * when a component needs it.
 */

export const WIRE_TAG = '__codec'
export const WIRE_VALUE = 'wire'

export interface AgentCodec<TWire = unknown, TRuntime = unknown> {
  /** Stable identifier used as the value of the `__codec` tag. */
  readonly name: string
  /** Convert a runtime value to its wire representation. */
  encode(value: TRuntime): TWire
  /** Convert a wire representation back to the runtime value. */
  decode(wire: TWire): TRuntime
  /**
   * Predicate identifying runtime values this codec should handle. The
   * universal encoder calls this on every value it walks; the first
   * codec to return `true` claims the value.
   */
  matchesRuntime(value: unknown): boolean
}

export class CodecRegistry {
  private byName = new Map<string, AgentCodec>()
  private inOrder: AgentCodec[] = []

  register(codec: AgentCodec): void {
    this.byName.set(codec.name, codec)
    const idx = this.inOrder.findIndex((c) => c.name === codec.name)
    if (idx >= 0) this.inOrder[idx] = codec
    else this.inOrder.push(codec)
  }

  get(name: string): AgentCodec | undefined {
    return this.byName.get(name)
  }

  /**
   * First codec whose `matchesRuntime` returns true for `value`, or
   * `undefined`. Used by the encoder to decide how to wrap arbitrary
   * runtime values.
   */
  matchRuntime(value: unknown): AgentCodec | undefined {
    for (const c of this.inOrder) if (c.matchesRuntime(value)) return c
    return undefined
  }

  clone(): CodecRegistry {
    const r = new CodecRegistry()
    for (const c of this.inOrder) r.register(c)
    return r
  }
}

export const isoDateCodec: AgentCodec<string, Date> = {
  name: 'iso-date',
  matchesRuntime: (v) => v instanceof Date && !Number.isNaN(v.getTime()),
  encode: (d) => d.toISOString(),
  decode: (s) => new Date(s),
}

export const epochMillisCodec: AgentCodec<number, Date> = {
  name: 'epoch-millis',
  // Returns `false` by default so `iso-date` claims Date values when
  // both are registered. Consumers who prefer epoch millis register
  // an instance with `matchesRuntime: (v) => v instanceof Date` to
  // shadow `iso-date` on the encode side.
  matchesRuntime: () => false,
  encode: (d) => d.getTime(),
  decode: (n) => new Date(n),
}

export function makeDefaultCodecs(): CodecRegistry {
  const r = new CodecRegistry()
  r.register(isoDateCodec)
  r.register(epochMillisCodec)
  return r
}

/**
 * Recursively walk `value`. For any node a codec claims via
 * `matchesRuntime`, replace it with `{ __codec, wire }`. Returns a
 * fresh structure — never mutates the input.
 *
 * The codec match takes precedence over object/array recursion: a
 * `Date` is technically `typeof === 'object'`, but the iso-date codec
 * should claim it before the generic walker tries to enumerate keys.
 */
export function encodeForWire(value: unknown, registry: CodecRegistry): unknown {
  if (value === null || value === undefined) return value
  const codec = registry.matchRuntime(value)
  if (codec) return { [WIRE_TAG]: codec.name, [WIRE_VALUE]: codec.encode(value) }
  if (Array.isArray(value)) return value.map((v) => encodeForWire(v, registry))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as object)) {
      out[k] = encodeForWire(v, registry)
    }
    return out
  }
  return value
}

/**
 * Recursively walk `value`. For any tagged shape `{ __codec, wire }`,
 * look up the codec by name and replace with the decoded runtime
 * value. Tagged shapes whose codec name is unknown pass through
 * untouched so the consumer can inspect them directly.
 */
export function decodeFromWire(value: unknown, registry: CodecRegistry): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map((v) => decodeFromWire(v, registry))
  if (typeof value !== 'object') return value
  const obj = value as Record<string, unknown>
  if (typeof obj[WIRE_TAG] === 'string' && WIRE_VALUE in obj) {
    const codec = registry.get(obj[WIRE_TAG] as string)
    if (codec) return codec.decode(obj[WIRE_VALUE])
    return value
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    out[k] = decodeFromWire(v, registry)
  }
  return out
}
