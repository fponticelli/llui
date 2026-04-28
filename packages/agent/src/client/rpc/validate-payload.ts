import type { MsgSchemaShape, MsgSchemaField, MsgSchemaBareType } from '../factory.js'

/**
 * Schema-driven payload validation for agent-dispatched Msgs. Walks
 * the compiler-emitted schema against a candidate Msg and reports
 * structural errors with a path-keyed list — the kind of feedback an
 * LLM can act on in a single round trip ("set kind to one of: 'exact',
 * 'range', 'compound'") instead of probing one field at a time.
 *
 * **What this is not.** This is not a TS type-checker. The schema is
 * best-effort: cross-file types, generics, complex unions, and
 * conditional types still surface as `'unknown'` and the validator
 * accepts anything for those. The validator's job is to catch the
 * mistakes a schema-aware LLM makes — wrong enum values, missing
 * discriminants, primitive type mismatches — not to mirror the entire
 * TypeScript surface area.
 *
 * **Tolerance for `'unknown'`.** Treat `'unknown'` as "any goes." Don't
 * report errors against fields whose schema we don't know — those are
 * the schema's gaps, not the agent's.
 */

export type ValidationError = {
  /**
   * Dot-bracket path rooted at the Msg payload (NOT including `type`).
   * - top-level field: `'cells'`
   * - nested object property: `'cells.value'`
   * - array element: `'cells[0]'` (concrete index from the input)
   * - discriminated-union branch: `'format(kind=range).max'` — the
   *   parenthesised `<discriminant>=<value>` segment names which branch
   *   the error applies to, distinguishing the same field name across
   *   branches.
   */
  path: string
  code:
    | 'unknown-variant'
    | 'missing'
    | 'wrong-type'
    | 'not-in-enum'
    | 'not-array'
    | 'not-object'
    | 'missing-discriminant'
    | 'unknown-discriminant-value'
    | 'unexpected-field'
    | 'validates-failed'
  message: string
}

export type ValidationWarning = {
  path: string
  code: 'untyped-field'
  message: string
}

export type ValidationResult =
  | { ok: true; warnings?: ValidationWarning[] }
  | { ok: false; errors: ValidationError[]; warnings?: ValidationWarning[] }

export type ValidationOptions = {
  /**
   * `'strict'` rejects fields that aren't declared in the schema (typos,
   * extra keys, fields the LLM hallucinated). Also emits warnings when
   * the agent provides a value for a field whose schema is `'unknown'`
   * — the validator can't structurally check the value, so the warning
   * surfaces the gap to the LLM ("we accepted this but didn't validate
   * it"). `'lenient'` (default) accepts extras silently and treats
   * `'unknown'` as a passthrough.
   *
   * Strict mode pairs with the cross-file schema fidelity in
   * `@llui/vite-plugin`@0.0.36+: with most fields fully resolved, strict
   * is rarely surprising. Apps that haven't migrated yet may find
   * strict overzealous and should stay on lenient.
   */
  policy?: 'strict' | 'lenient'
}

export function validatePayload(
  msg: unknown,
  schema: MsgSchemaShape | null,
  opts: ValidationOptions = {},
): ValidationResult {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
    return {
      ok: false,
      errors: [{ path: '', code: 'not-object', message: 'msg must be a plain object' }],
    }
  }
  const m = msg as Record<string, unknown>
  const variantKey = m[schema?.discriminant ?? 'type']
  if (typeof variantKey !== 'string') {
    return {
      ok: false,
      errors: [
        {
          path: schema?.discriminant ?? 'type',
          code: 'missing',
          message: `msg.${schema?.discriminant ?? 'type'} must be a string variant tag`,
        },
      ],
    }
  }

  // No schema available — the compiler didn't emit one, or the LLM is
  // talking to a build that predates schema emission. Accept the msg
  // structurally; the reducer will validate semantically.
  if (!schema) return { ok: true }

  const variantSchema = schema.variants[variantKey]
  if (!variantSchema) {
    return {
      ok: false,
      errors: [
        {
          path: schema.discriminant,
          code: 'unknown-variant',
          message: `'${variantKey}' is not a known variant. Legal values: ${Object.keys(
            schema.variants,
          )
            .map((v) => `'${v}'`)
            .join(', ')}.`,
        },
      ],
    }
  }

  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []
  const policy = opts.policy ?? 'lenient'
  const payload: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(m)) {
    if (k !== schema.discriminant) payload[k] = v
  }
  validateObjectShape(payload, variantSchema, '', errors, warnings, policy)
  if (errors.length === 0) {
    return warnings.length === 0 ? { ok: true } : { ok: true, warnings }
  }
  return warnings.length === 0 ? { ok: false, errors } : { ok: false, errors, warnings }
}

function validateObjectShape(
  value: Record<string, unknown>,
  shape: Record<string, MsgSchemaField>,
  pathPrefix: string,
  errors: ValidationError[],
  warnings: ValidationWarning[],
  policy: 'strict' | 'lenient',
): void {
  for (const [name, descriptor] of Object.entries(shape)) {
    const fieldPath = pathPrefix === '' ? name : `${pathPrefix}.${name}`
    const present = Object.prototype.hasOwnProperty.call(value, name)
    const optional = isOptional(descriptor)
    const fieldValue = present ? value[name] : undefined

    if (!present || fieldValue === undefined) {
      if (!optional) {
        errors.push({
          path: fieldPath,
          code: 'missing',
          message: `required field is missing`,
        })
      }
      continue
    }

    const ft = fieldType(descriptor)
    if (ft === 'unknown' && policy === 'strict') {
      warnings.push({
        path: fieldPath,
        code: 'untyped-field',
        message: `value accepted but field schema is 'unknown' — the validator could not structurally check it. If this field is reachable across file boundaries, consider whether @llui/vite-plugin can resolve it.`,
      })
    }

    const errCountBefore = errors.length
    validateField(fieldValue, ft, fieldPath, errors, warnings, policy)
    const structurallyValid = errors.length === errCountBefore

    // Domain-invariant predicate (`@validates("expr")`). Runs only
    // when structural validation passed for this field — without the
    // right shape, the predicate would either throw (and we'd have to
    // double-report) or accidentally pass (e.g. `v.length` on a string
    // when we expected a number array). Predicate failures are errors
    // regardless of policy — the author opted into the constraint
    // deliberately.
    if (structurallyValid) {
      const validates = fieldValidatesPredicate(descriptor)
      if (validates !== null) {
        const predicate = compilePredicate(validates)
        let passed: boolean
        try {
          passed = Boolean(predicate(fieldValue))
        } catch {
          passed = false
        }
        if (!passed) {
          errors.push({
            path: fieldPath,
            code: 'validates-failed',
            message: `value violates \`@validates("${validates}")\``,
          })
        }
      }
    }
  }

  // Strict mode: reject fields the schema doesn't declare. Catches
  // typos (`{tile: 'X'}` instead of `{title: 'X'}`), hallucinated
  // fields, and stale field names from before a refactor. Lenient
  // mode accepts extras silently — same shape TypeScript's structural
  // subtyping accepts at the call site.
  if (policy === 'strict') {
    for (const key of Object.keys(value)) {
      if (key in shape) continue
      const fieldPath = pathPrefix === '' ? key : `${pathPrefix}.${key}`
      errors.push({
        path: fieldPath,
        code: 'unexpected-field',
        message: `field '${key}' is not in the schema. Legal fields: ${Object.keys(shape)
          .map((k) => `'${k}'`)
          .join(', ')}.`,
      })
    }
  }
}

function validateField(
  value: unknown,
  type: MsgSchemaBareType,
  path: string,
  errors: ValidationError[],
  warnings: ValidationWarning[],
  policy: 'strict' | 'lenient',
): void {
  if (type === 'unknown') return // schema gap; accept anything
  if (typeof type === 'string') {
    // Primitive keyword: 'string', 'number', 'boolean'.
    if (typeof value !== type) {
      errors.push({
        path,
        code: 'wrong-type',
        message: `expected ${type}, got ${describeType(value)}`,
      })
    }
    return
  }
  if ('enum' in type) {
    // Use Object.is so NaN and -0 match correctly; falls back to ===
    // semantics for ordinary values.
    const ok = type.enum.some((legal) => Object.is(legal, value) || legal === value)
    if (!ok) {
      errors.push({
        path,
        code: 'not-in-enum',
        message: `'${String(value)}' is not in the enum. Legal values: ${type.enum
          .map((v) => formatEnumValue(v))
          .join(', ')}.`,
      })
    }
    return
  }
  if (type.kind === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      errors.push({
        path,
        code: 'not-object',
        message: `expected object, got ${describeType(value)}`,
      })
      return
    }
    validateObjectShape(
      value as Record<string, unknown>,
      type.shape,
      path,
      errors,
      warnings,
      policy,
    )
    return
  }
  if (type.kind === 'array') {
    if (!Array.isArray(value)) {
      errors.push({
        path,
        code: 'not-array',
        message: `expected array, got ${describeType(value)}`,
      })
      return
    }
    for (let i = 0; i < value.length; i++) {
      validateField(value[i], type.element, `${path}[${i}]`, errors, warnings, policy)
    }
    return
  }
  if (type.kind === 'discriminated-union') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      errors.push({
        path,
        code: 'not-object',
        message: `expected discriminated-union object, got ${describeType(value)}`,
      })
      return
    }
    const obj = value as Record<string, unknown>
    const discValue = obj[type.discriminant]
    if (typeof discValue !== 'string') {
      errors.push({
        path: `${path}.${type.discriminant}`,
        code: 'missing-discriminant',
        message: `discriminant '${type.discriminant}' must be one of: ${Object.keys(type.variants)
          .map((v) => `'${v}'`)
          .join(', ')}`,
      })
      return
    }
    const branchSchema = type.variants[discValue]
    if (!branchSchema) {
      errors.push({
        path: `${path}.${type.discriminant}`,
        code: 'unknown-discriminant-value',
        message: `'${discValue}' is not a legal '${type.discriminant}'. Legal values: ${Object.keys(
          type.variants,
        )
          .map((v) => `'${v}'`)
          .join(', ')}.`,
      })
      return
    }
    // Recurse into the matched branch's payload (excluding the
    // discriminant itself, which is already validated above).
    const branchPayload: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (k !== type.discriminant) branchPayload[k] = v
    }
    const branchPath = `${path}(${type.discriminant}=${discValue})`
    validateObjectShape(branchPayload, branchSchema, branchPath, errors, warnings, policy)
  }
}

function isOptional(d: MsgSchemaField): boolean {
  return typeof d === 'object' && d !== null && 'type' in d && d.optional === true
}

function fieldType(d: MsgSchemaField): MsgSchemaBareType {
  if (typeof d === 'object' && d !== null && 'type' in d) return d.type
  return d
}

function fieldValidatesPredicate(d: MsgSchemaField): string | null {
  if (typeof d === 'object' && d !== null && 'type' in d && typeof d.validates === 'string') {
    return d.validates
  }
  return null
}

const predicateCache = new Map<string, (v: unknown) => boolean>()

/**
 * Compile a `@validates(...)` predicate string into a runtime function.
 * Caches across calls — the schema is static at runtime, so each
 * predicate is compiled at most once.
 *
 * The predicate sees `v` as the field's value and inherits the host
 * environment's globals (Math, JSON, RegExp, etc.). On any compile
 * error, returns a no-op `() => true` so a malformed predicate doesn't
 * break dispatch — the build-time linter (`agent-validates-syntax`,
 * future) is the right place to catch syntactic issues.
 */
function compilePredicate(src: string): (v: unknown) => boolean {
  let fn = predicateCache.get(src)
  if (fn) return fn
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    fn = new Function('v', `return (${src})`) as (v: unknown) => boolean
  } catch {
    fn = () => true
  }
  predicateCache.set(src, fn)
  return fn
}

function describeType(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

function formatEnumValue(v: string | number | boolean): string {
  return typeof v === 'string' ? `'${v}'` : String(v)
}
