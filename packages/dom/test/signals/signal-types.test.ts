import { describe, it } from 'vitest'
import { derived } from '../../src/signals/types'
import type { Signal, LiveSignal } from '../../src/signals/types'

// Type-level surface guards, mirroring the repo convention (scope-types.test.ts):
// declarations live in never-called functions; `pnpm check` is the real
// assertion. `@ts-expect-error` markers MUST fire where annotated (an inactive
// marker is a TS2578 error). `expectType` pins assignability; the paired
// `@ts-expect-error` on the narrower target pins that a wider type is required
// (e.g. that `| undefined` is genuinely present).

const expectType = <T>(_v: T): void => {}

interface Profile {
  name: string
  email?: string
}
interface User {
  id: string
  profile: Profile
  roles: string[]
}
interface Item {
  price: number
  label: string
}
interface State {
  count: number
  user: User
  items: Item[]
  session: { token: string } | null
}

declare const s: Signal<State>

describe('Signal.at — leaf typing', () => {
  it('resolves a nested leaf to its value type', () => {
    const _ = () => {
      expectType<Signal<string>>(s.at('user.id'))
      expectType<string>(s.at('user.id').peek())
      expectType<number>(s.at('count').peek())
    }
    void _
  })

  it('resolves an intermediate path to a signal of the object', () => {
    const _ = () => {
      expectType<Signal<User>>(s.at('user'))
      expectType<Signal<Profile>>(s.at('user.profile'))
    }
    void _
  })

  it('chaining .at equals a single dotted path', () => {
    const _ = () => {
      expectType<string>(s.at('user').at('profile.name').peek())
      expectType<string>(s.at('user.profile.name').peek())
    }
    void _
  })
})

describe('Signal.at — nullability bubbling', () => {
  it('array index bubbles | undefined', () => {
    const _ = () => {
      const v = s.at('items.0.price').peek()
      expectType<number | undefined>(v)
      // @ts-expect-error — array index must bubble `undefined`
      const n: number = v
      void n
    }
    void _
  })

  it('optional field bubbles | undefined', () => {
    const _ = () => {
      const v = s.at('user.profile.email').peek()
      expectType<string | undefined>(v)
      // @ts-expect-error — optional field must bubble `undefined`
      const e: string = v
      void e
    }
    void _
  })

  it('nullable field bubbles | null and navigates through NonNullable', () => {
    const _ = () => {
      const v = s.at('session.token').peek()
      expectType<string | null>(v)
      // @ts-expect-error — nullable parent must bubble `null`
      const t: string = v
      void t
    }
    void _
  })

  it('array length is number, no undefined', () => {
    const _ = () => {
      expectType<number>(s.at('items.length').peek())
    }
    void _
  })
})

describe('Signal.at — invalid paths rejected', () => {
  it('rejects a misspelled segment', () => {
    const _ = () =>
      // @ts-expect-error — 'profilee' is not a key of User
      s.at('user.profilee.name')
    void _
  })

  it('rejects a non-existent top-level key', () => {
    const _ = () =>
      // @ts-expect-error — 'nope' is not a key of State
      s.at('nope')
    void _
  })

  it('rejects descending past a primitive', () => {
    const _ = () =>
      // @ts-expect-error — count is a number, has no sub-paths
      s.at('count.toFixed')
    void _
  })
})

describe('Signal.map', () => {
  it('returns a Signal of the mapped type', () => {
    const _ = () => {
      const upper: Signal<string> = s.at('user.id').map((id) => id.toUpperCase())
      expectType<Signal<string>>(upper)
      const len: Signal<number> = s.at('items').map((arr) => arr.length)
      expectType<Signal<number>>(len)
    }
    void _
  })
})

describe('derived', () => {
  it('combines independent signals, callback receives spread values', () => {
    const _ = () => {
      const label: Signal<string> = derived(
        [s.at('user.id'), s.at('count')],
        (id, n) => `${id}:${n}`,
      )
      expectType<Signal<string>>(label)
    }
    void _
  })

  it('infers tuple element types in the callback', () => {
    const _ = () =>
      derived([s.at('count'), s.at('user.profile.email')], (n, email) => {
        expectType<number>(n)
        expectType<string | undefined>(email)
        return n
      })
    void _
  })
})

describe('LiveSignal', () => {
  it('exposes peek and bind only', () => {
    const _ = (live: LiveSignal<string>) => {
      expectType<string>(live.peek())
      const off: () => void = live.bind((v) => expectType<string>(v))
      expectType<() => void>(off)
    }
    void _
  })

  it('has no at/map (derivation stays in the state declaration)', () => {
    const _ = (live: LiveSignal<State>) => {
      // @ts-expect-error — LiveSignal has no `at`
      live.at('count')
      // @ts-expect-error — LiveSignal has no `map`
      live.map((x) => x)
    }
    void _
  })
})
