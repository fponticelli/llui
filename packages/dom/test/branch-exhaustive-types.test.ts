import { describe, it } from 'vitest'
import { branch } from '../src/primitives/branch'
import type { View } from '../src/view-helpers'

// Type-level tests. Runtime bodies wrapped in never-called arrows so
// the inert declarations don't trip the render-context guards. The
// TypeScript compile pass is the actual assertion; `@ts-expect-error`
// markers must fire exactly where annotated — an inactive marker
// triggers TS2578 and the build breaks.

type Status = 'idle' | 'loading' | 'done'
type Builder<S, M = never> = (h: View<S, M>) => Node[]
type S = { status: Status }
const b: Builder<S> = () => []

describe('branch() — narrow K (exhaustiveness enforced)', () => {
  it('compiles: all cases covered, no default', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = () =>
      branch<S, never, Status>({
        on: (s) => s.status,
        cases: { idle: b, loading: b, done: b },
      })
  })

  it('allows default alongside exhaustive cases (dead branch, but not rejected)', () => {
    // A union-typed `BranchOptions` can't cleanly forbid `default` once
    // `cases` covers every key — TS happily matches the shape against
    // the non-exhaustive branch of the union. That's acceptable: the
    // runtime never reaches `default` when a case matches, so the worst
    // outcome is a little dead code. The primary safety goal —
    // requiring `default` when cases are incomplete — still holds.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = () =>
      branch<S, never, Status>({
        on: (s) => s.status,
        cases: { idle: b, loading: b, done: b },
        default: b,
      })
  })

  it('compiles: non-exhaustive cases + default', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = () =>
      branch<S, never, Status>({
        on: (s) => s.status,
        cases: { idle: b },
        default: b,
      })
  })

  it('rejects non-exhaustive without default', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = () =>
      // @ts-expect-error — default required when cases don't cover K
      branch<S, never, Status>({
        on: (s) => s.status,
        cases: { idle: b },
      })
  })
})

describe('branch() — wide K (lenient)', () => {
  it('compiles: wide string on + cases + default', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = () =>
      branch<{ code: string }, never>({
        on: (s) => s.code,
        cases: { a: () => [], b: () => [] },
        default: () => [],
      })
  })

  it('compiles: wide string on + cases without default (lenient)', () => {
    // Wide string K can never be exhaustive, but requiring `default`
    // everywhere would churn every existing call site. Lenient: allow.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = () =>
      branch<{ code: string }, never>({
        on: (s) => s.code,
        cases: { a: () => [], b: () => [] },
      })
  })

  it('compiles: default only, no cases', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = () =>
      branch<{ epoch: number }, never>({
        on: (s) => String(s.epoch),
        default: () => [],
      })
  })
})
