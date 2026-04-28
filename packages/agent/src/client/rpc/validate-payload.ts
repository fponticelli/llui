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
  message: string
}

export type ValidationResult = { ok: true } | { ok: false; errors: ValidationError[] }

export function validatePayload(msg: unknown, schema: MsgSchemaShape | null): ValidationResult {
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
  const payload: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(m)) {
    if (k !== schema.discriminant) payload[k] = v
  }
  validateObjectShape(payload, variantSchema, '', errors)
  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

function validateObjectShape(
  value: Record<string, unknown>,
  shape: Record<string, MsgSchemaField>,
  pathPrefix: string,
  errors: ValidationError[],
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

    validateField(fieldValue, fieldType(descriptor), fieldPath, errors)
  }
}

function validateField(
  value: unknown,
  type: MsgSchemaBareType,
  path: string,
  errors: ValidationError[],
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
    validateObjectShape(value as Record<string, unknown>, type.shape, path, errors)
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
      validateField(value[i], type.element, `${path}[${i}]`, errors)
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
    validateObjectShape(branchPayload, branchSchema, branchPath, errors)
  }
}

function isOptional(d: MsgSchemaField): boolean {
  return typeof d === 'object' && d !== null && 'type' in d && d.optional === true
}

function fieldType(d: MsgSchemaField): MsgSchemaBareType {
  if (typeof d === 'object' && d !== null && 'type' in d) return d.type
  return d
}

function describeType(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

function formatEnumValue(v: string | number | boolean): string {
  return typeof v === 'string' ? `'${v}'` : String(v)
}
