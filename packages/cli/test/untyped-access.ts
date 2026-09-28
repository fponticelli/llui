/**
 * Checked access into values the scenario-protocol tests build or receive
 * UNTYPED on purpose — a `JSON.parse`d catalog, a `runInNewContext` realm
 * object, a decoded (erased) case input. Those are exactly the values the
 * protocol's `decode…` entry points take as `unknown`, so the tests keep them
 * `unknown` too and read into them one runtime-checked step at a time instead
 * of asserting a shape with a cast.
 */

/** The own data property at `keys`, failing by path when any step is not an
 * object or has no such own property. */
export function ownPath(value: unknown, ...keys: readonly (string | number)[]): unknown {
  let current: unknown = value
  const walked: (string | number)[] = []
  for (const key of keys) {
    walked.push(key)
    if (typeof current !== 'object' || current === null) {
      throw new Error(`not an object before ${walked.join('.')}`)
    }
    const descriptor = Object.getOwnPropertyDescriptor(current, key)
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new Error(`no own data property at ${walked.join('.')}`)
    }
    const next: unknown = descriptor.value
    current = next
  }
  return current
}

/** `ownPath`, additionally requiring an object (for `Reflect.set`, `Object.isFrozen`, …). */
export function ownObject(value: unknown, ...keys: readonly (string | number)[]): object {
  const found = ownPath(value, ...keys)
  if (typeof found !== 'object' || found === null) {
    throw new Error(`not an object at ${keys.join('.')}`)
  }
  return found
}

/** Attempts `values.push(...items)` exactly as a caller holding a mutable
 * reference would — on a frozen array it throws `TypeError`. */
export function pushInto(values: unknown, ...items: unknown[]): number {
  return Array.prototype.push.apply(ownObject(values), items)
}
