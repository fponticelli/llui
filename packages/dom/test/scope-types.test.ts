import { describe, it } from 'vitest'
import { scope } from '../src/primitives/scope'

// Type-level surface guards. The declarations inside each test are
// wrapped in never-called functions so the runtime body stays inert.
// `pnpm check` is the actual assertion — `@ts-expect-error` markers
// must fire where annotated. An inactive marker triggers TS2578.

describe('scope() type surface', () => {
  it('compiles: on returns string, render returns Node[]', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = () =>
      scope<{ epoch: number }>({
        on: (s) => String(s.epoch),
        render: () => [],
      })
  })

  it('rejects: on returning non-string', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = () =>
      scope<{ epoch: number }>({
        // @ts-expect-error — on must return string
        on: (s) => s.epoch,
        render: () => [],
      })
  })

  it('rejects: render missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = () =>
      // @ts-expect-error — render is required
      scope<{ epoch: number }>({
        on: (s) => String(s.epoch),
      })
  })
})
