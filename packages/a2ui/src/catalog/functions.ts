/**
 * The A2UI Basic-catalog client-defined functions: formatting (`formatString`,
 * `formatNumber`, `formatCurrency`, `formatDate`, `pluralize`), validation
 * (`required`, `regex`, `length`, `numeric`, `email`) and boolean logic
 * (`and`, `or`, `not`).
 *
 * Functions are pure `(call, env) => value`; reactivity is applied at the
 * binding site. Arg names match the catalog schema.
 */

import type { CatalogFunction, EvalEnv } from '../catalog.js'
import { warnOnce } from '../catalog.js'
import type { JsonValue } from '../protocol.js'
import { resolvePointer } from '../pointer.js'
import { displayString } from '../binding.js'

function toNumber(value: JsonValue | undefined): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}
function toBool(value: JsonValue | undefined): boolean {
  return value === true || value === 'true'
}

// ── Validation ─────────────────────────────────────────────────────

const required: CatalogFunction = (_call, env) => {
  const v = env.arg('value')
  if (v === null || v === undefined || v === '') return false
  if (Array.isArray(v) && v.length === 0) return false
  return true
}

// Server-controlled RegExps run reactively (per keystroke), so cap pattern and
// input length to bound ReDoS blast radius, and cache compiled patterns so the
// same pattern isn't recompiled on every evaluation.
const MAX_REGEX_PATTERN = 1_000
const MAX_REGEX_INPUT = 10_000
const MAX_REGEX_CACHE = 256
const regexCache = new Map<string, RegExp | null>()

function compileRegex(pattern: string): RegExp | null {
  if (pattern.length > MAX_REGEX_PATTERN) return null
  const cached = regexCache.get(pattern)
  if (cached !== undefined) return cached
  let re: RegExp | null
  try {
    re = new RegExp(pattern)
  } catch {
    re = null
  }
  // Bound cache growth: distinct patterns are also server-controlled.
  if (regexCache.size >= MAX_REGEX_CACHE) regexCache.clear()
  regexCache.set(pattern, re)
  return re
}

const regex: CatalogFunction = (_call, env) => {
  const value = displayString(env.arg('value') ?? '')
  const pattern = displayString(env.arg('pattern') ?? '')
  if (pattern.length > MAX_REGEX_PATTERN) {
    warnOnce(`Rejecting regex pattern over ${MAX_REGEX_PATTERN} chars`)
    return false
  }
  if (value.length > MAX_REGEX_INPUT) {
    warnOnce(`Rejecting regex input over ${MAX_REGEX_INPUT} chars`)
    return false
  }
  const re = compileRegex(pattern)
  return re ? re.test(value) : false
}

const length: CatalogFunction = (_call, env) => {
  const n = displayString(env.arg('value') ?? '').length
  const min = env.arg('min')
  const max = env.arg('max')
  if (typeof min === 'number' && n < min) return false
  if (typeof max === 'number' && n > max) return false
  return true
}

const numeric: CatalogFunction = (_call, env) => {
  const raw = env.arg('value')
  if (raw === null || raw === undefined || raw === '' || Number.isNaN(Number(raw))) return false
  const n = toNumber(raw)
  const min = env.arg('min')
  const max = env.arg('max')
  if (typeof min === 'number' && n < min) return false
  if (typeof max === 'number' && n > max) return false
  return true
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const email: CatalogFunction = (_call, env) => EMAIL_RE.test(displayString(env.arg('value') ?? ''))

// ── Boolean logic (items are themselves dynamic → eval each) ────────

const and: CatalogFunction = (call, env) => {
  const items = call.args?.values
  return Array.isArray(items) && items.every((x) => toBool(env.eval(x)))
}
const or: CatalogFunction = (call, env) => {
  const items = call.args?.values
  return Array.isArray(items) && items.some((x) => toBool(env.eval(x)))
}
const not: CatalogFunction = (_call, env) => !toBool(env.arg('value'))

// ── Formatting ─────────────────────────────────────────────────────

function interpolate(template: string, env: EvalEnv): string {
  // `${/path}` / `${path}` interpolation with `\${` escaping. Nested function
  // calls inside `${…}` are not supported (resolve to empty).
  return template.replace(/\\\$\{|\$\{([^}]*)\}/g, (match, expr: string | undefined) => {
    if (match === '\\${') return '${'
    const key = (expr ?? '').trim()
    const src = key.startsWith('/') ? env.root : env.data
    return displayString(resolvePointer(src, key))
  })
}

const formatString: CatalogFunction = (_call, env) =>
  interpolate(displayString(env.arg('value') ?? ''), env)

function numberFormatOptions(env: EvalEnv): Intl.NumberFormatOptions {
  const decimals = env.arg('decimals')
  const grouping = env.arg('grouping')
  const opts: Intl.NumberFormatOptions = { useGrouping: grouping === true }
  if (typeof decimals === 'number') {
    opts.minimumFractionDigits = decimals
    opts.maximumFractionDigits = decimals
  }
  return opts
}

const formatNumber: CatalogFunction = (_call, env) =>
  new Intl.NumberFormat(undefined, numberFormatOptions(env)).format(toNumber(env.arg('value')))

const formatCurrency: CatalogFunction = (_call, env) => {
  const currency = displayString(env.arg('currency') ?? 'USD')
  try {
    return new Intl.NumberFormat(undefined, {
      ...numberFormatOptions(env),
      style: 'currency',
      currency,
    }).format(toNumber(env.arg('value')))
  } catch {
    return displayString(env.arg('value'))
  }
}

function formatDateTR35(date: Date, pattern: string): string {
  const pad = (n: number, l = 2): string => String(n).padStart(l, '0')
  const tokens: Record<string, string> = {
    yyyy: String(date.getFullYear()),
    yy: pad(date.getFullYear() % 100),
    MM: pad(date.getMonth() + 1),
    M: String(date.getMonth() + 1),
    dd: pad(date.getDate()),
    d: String(date.getDate()),
    HH: pad(date.getHours()),
    H: String(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
  }
  return pattern.replace(/yyyy|yy|MM|M|dd|d|HH|H|mm|ss/g, (t) => tokens[t] ?? t)
}

const formatDate: CatalogFunction = (_call, env) => {
  const raw = env.arg('value')
  const date = new Date(typeof raw === 'number' ? raw : displayString(raw))
  if (Number.isNaN(date.getTime())) return displayString(raw)
  const format = env.arg('format')
  return typeof format === 'string' ? formatDateTR35(date, format) : date.toLocaleString()
}

const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const

const pluralize: CatalogFunction = (_call, env) => {
  const n = toNumber(env.arg('value'))
  if (n === 0 && env.arg('zero') !== undefined) return displayString(env.arg('zero'))
  const category = new Intl.PluralRules().select(n)
  const chosen = (PLURAL_CATEGORIES as readonly string[]).includes(category)
    ? (env.arg(category) ?? env.arg('other'))
    : env.arg('other')
  return displayString(chosen)
}

/** The Basic-catalog function registry. */
export const basicFunctions: Readonly<Record<string, CatalogFunction>> = {
  required,
  regex,
  length,
  numeric,
  email,
  and,
  or,
  not,
  formatString,
  formatNumber,
  formatCurrency,
  formatDate,
  pluralize,
}
