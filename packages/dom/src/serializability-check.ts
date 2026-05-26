// Dev-only state-serializability check.
//
// LLui state must be plain JSON — no Date/Map/Set/class instances/functions.
// Non-serializable state silently breaks four things that consumers rarely
// exercise during development of the offending feature itself:
//
//   1. Vite HMR — module reload calls `JSON.stringify` on prior state to
//      hand the new module's `init` an existing snapshot. Maps/Sets
//      serialize to `{}` and the HMR'd component boots with empty data.
//   2. Devtools state snapshots — the snapshot panel structured-clones
//      the state and displays it as JSON. Non-serializable values become
//      either `[object Map]` text or empty objects depending on the path.
//   3. SSR hydration (`@llui/vike`) — server-rendered state is sent as
//      JSON over the wire; classes round-trip as `{}` and reactivity
//      breaks silently on the client.
//   4. Replay/property tests (`@llui/test`) — `replayTrace` requires JSON
//      structural equality; a Map state can't be replayed reliably.
//
// The check is dev-only. It runs at two trigger points:
//   - mount: the initial state from `init()` (handled in `mount.ts`).
//   - update: the post-reducer state, but only the FIRST time after mount
//     to bound the walk cost and avoid log spam.
//
// We don't keep re-walking forever — the same warning would fire on every
// keystroke. One warning per instance is enough: the author sees a clear
// "your reducer returned a Map at `state.foo.bar`" message and fixes it.

const warnedInstances = new WeakSet<object>()

export interface NonSerializableOffender {
  path: string
  value: unknown
}

/**
 * Walks an object graph looking for non-JSON-serializable values.
 * Returns the first offender found (depth-first), or null if everything
 * is fine. Stops at depth 6 to bound runtime cost for large states.
 *
 * The check identifies: Date, Map, Set, RegExp, Promise, functions,
 * symbols, bigints, and class instances (anything whose prototype isn't
 * `Object.prototype` or `Array.prototype`).
 */
export function findNonSerializable(
  v: unknown,
  path = 'state',
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): NonSerializableOffender | null {
  if (depth > 6) return null
  if (v === null || v === undefined) return null
  const t = typeof v
  if (t === 'string' || t === 'number' || t === 'boolean') return null
  if (t === 'function') return { path, value: v }
  if (t === 'symbol' || t === 'bigint') return { path, value: v }
  if (t !== 'object') return null
  const obj = v as object
  if (seen.has(obj)) return null
  seen.add(obj)
  if (obj instanceof Date) return { path: `${path} (Date)`, value: v }
  if (obj instanceof Map) return { path: `${path} (Map)`, value: v }
  if (obj instanceof Set) return { path: `${path} (Set)`, value: v }
  if (obj instanceof RegExp) return { path: `${path} (RegExp)`, value: v }
  if (obj instanceof Promise) return { path: `${path} (Promise)`, value: v }
  // Plain objects/arrays have Object.prototype / Array.prototype. Class
  // instances have a different prototype.
  const proto = Object.getPrototypeOf(obj)
  if (proto !== null && proto !== Object.prototype && proto !== Array.prototype) {
    return { path: `${path} (${proto?.constructor?.name ?? 'class instance'})`, value: v }
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const r = findNonSerializable(v[i], `${path}[${i}]`, depth + 1, seen)
      if (r) return r
    }
    return null
  }
  for (const k of Object.keys(obj)) {
    const r = findNonSerializable(
      (obj as Record<string, unknown>)[k],
      `${path}.${k}`,
      depth + 1,
      seen,
    )
    if (r) return r
  }
  return null
}

/**
 * Emit the canonical "non-serializable state" console.warn. Centralized
 * so the mount-time and update-time call sites stay in sync as the
 * message evolves (wording, hint, link to docs, etc.).
 *
 * `phase` distinguishes the call site:
 *   - 'mount': the initial state from `init()` carried a non-serializable.
 *   - 'update': a reducer returned a non-serializable that wasn't present
 *               in the initial state.
 */
export function warnNonSerializable(
  componentName: string | undefined,
  offender: NonSerializableOffender,
  phase: 'mount' | 'update',
): void {
  const label = componentName ? `<${componentName}>` : 'component'
  const verb = phase === 'mount' ? 'initial state contains' : 'reducer returned'
  console.warn(
    `[LLui] ${label} ${verb} a non-serializable value at "${offender.path}":`,
    offender.value,
    '\nState must be plain JSON (no Date/Map/Set/class instances/functions).' +
      '\nThis breaks: HMR (state restoration replays via JSON), devtools snapshots,' +
      ' SSR/hydration (@llui/vike), and replayTrace property-tests.' +
      '\nhint: Convert to a serializable representation (e.g., Date → ISO string,' +
      ' Map → Record, class instance → plain object).',
  )
}

/**
 * Check `newState` for non-serializable values after a reducer ran.
 * Idempotent per instance — emits at most one warning per
 * `ComponentInstance`, identified by an opaque key (the instance ref).
 * Subsequent calls bail without walking.
 *
 * Returns true when a warning was emitted (used by tests).
 */
export function checkReducerOutput(
  instanceKey: object,
  componentName: string | undefined,
  newState: unknown,
): boolean {
  if (warnedInstances.has(instanceKey)) return false
  const offender = findNonSerializable(newState)
  if (!offender) return false
  warnedInstances.add(instanceKey)
  warnNonSerializable(componentName, offender, 'update')
  return true
}
