import { describe, it } from 'vitest'
import { derived, constant } from '../../src/signals/handle'
import type { Signal, LiveSignal, MappedSignal, ReadSignal } from '../../src/signals/types'
import { show, branch, text, each, div, span, unsafeHtml } from '../../src/signals/authoring'
import type { Renderable } from '../../src/signals/element'

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
  it('returns a MappedSignal (a ReadSignal) of the mapped type', () => {
    const _ = () => {
      const upper: MappedSignal<string> = s.at('user.id').map((id) => id.toUpperCase())
      expectType<ReadSignal<string>>(upper)
      expectType<string>(upper.peek())
      const len: ReadSignal<number> = s.at('items').map((arr) => arr.length)
      expectType<number>(len.peek())
    }
    void _
  })
})

// The signal hierarchy: `ReadSignal<T>` is the read-only supertype; `Signal<T>`
// (a PATH signal, sliceable with `.at()`) and `MappedSignal<T>` (from
// `.map()`/`derived()`, no path) both extend it, and NEITHER is assignable to the
// other. The load-bearing direction is mapped -> Signal: while it held, a helper
// typed `(job: Signal<Job>) => job.at('status')` type-checked when handed
// `state.map(...)` and threw at mount.
// (`declare`d, like `s`: these bodies are type-checked, never run.)
/** The one key of `MappedSignal['at']` — the remedy both misuse diagnostics print. */
type AtRemedy =
  'mapped signals have no state path: slice with .at() BEFORE .map(), or read with .map((v) => v.field); a parameter that only reads should be typed ReadSignal<T>'
declare const remedy: AtRemedy
declare const mapped: MappedSignal<Profile>
declare const path: Signal<Profile>
describe('signal hierarchy — ReadSignal / Signal / MappedSignal', () => {
  it('the fixtures are what they claim: .map() yields a MappedSignal, .at() a Signal', () => {
    const _ = () => {
      const m: typeof mapped = s.at('user').map((u) => u.profile)
      const p: typeof path = s.at('user.profile')
      void m
      void p
    }
    void _
  })

  it('a mapped signal is NOT a Signal (the helper that slices rejects it)', () => {
    const _ = () => {
      const slices = (p: Signal<Profile>): Signal<string> => p.at('name')
      // @ts-expect-error — a MappedSignal has no path; `slices` needs `.at()`
      slices(mapped)
      // @ts-expect-error — nor by assignment
      const asSignal: Signal<Profile> = mapped
      void asSignal
      // the paired control: the same helper accepts a path signal
      slices(path)
    }
    void _
  })

  it('a derived signal is NOT a Signal either', () => {
    const _ = () => {
      const both = derived(s.at('count'), s.at('user.id'), (n, id) => ({ n, id }))
      // @ts-expect-error — derived(...) is mapped; it has no path to slice
      const asSignal: Signal<{ n: number; id: string }> = both
      void asSignal
      const asRead: ReadSignal<{ n: number; id: string }> = both
      void asRead
    }
    void _
  })

  it('both kinds are ReadSignals (the helper that only reads accepts either)', () => {
    const _ = () => {
      const reads = (p: ReadSignal<Profile>): ReadSignal<string> => p.map((x) => x.name)
      reads(mapped)
      reads(path)
      reads(constant<Profile>({ name: 'n' }))
      const fromMapped: ReadSignal<Profile> = mapped
      const fromPath: ReadSignal<Profile> = path
      void fromMapped
      void fromPath
    }
    void _
  })

  it('a path signal is NOT a MappedSignal (the show/branch overloads rely on it)', () => {
    const _ = () => {
      // @ts-expect-error — a path signal carries `.at()`, which a MappedSignal forbids
      const asMapped: MappedSignal<Profile> = path
      void asMapped
      const control: MappedSignal<Profile> = mapped
      void control
    }
    void _
  })

  it('.at() is not part of ReadSignal', () => {
    const _ = (r: ReadSignal<Profile>) => {
      // @ts-expect-error — ReadSignal has no `.at()`; take Signal<T> to slice
      r.at('name')
      expectType<string>(r.peek().name)
      expectType<MappedSignal<string>>(r.map((p) => p.name))
    }
    void _
  })

  it('the diagnostic for a mapped signal handed to a Signal names the fix', () => {
    // The optional `at` on MappedSignal is typed as an object whose only key is
    // the remedy, so both misuse diagnostics print it. Pin the key.
    const _ = () => {
      const k: keyof NonNullable<MappedSignal<Profile>['at']> = remedy
      void k
    }
    void _
  })
})

// Every API that only READS a signal accepts `ReadSignal<T>` — so the common
// case, `state.map(...)` into an element helper, keeps compiling unannotated.
describe('read-only APIs accept both signal kinds', () => {
  it('element props, text and unsafeHtml take a mapped or a path signal', () => {
    const _ = () => {
      const label = s.at('user.id').map((id) => id.toUpperCase())
      const readParam = (r: ReadSignal<string>): Renderable => [
        div({ title: r, class: label, 'data-id': s.at('user.id') }, [
          text(r),
          text(label),
          text(s.at('count')),
          unsafeHtml(label),
          span([text(s.map((st) => st.count))]),
        ]),
      ]
      void readParam
    }
    void _
  })

  it('each takes a mapped items signal; its rows are PATH signals', () => {
    const _ = () => {
      const visible = s.at('items').map((items) => items.filter((i) => i.price > 0))
      each(visible, {
        key: (i) => i.label,
        render: (item, index) => {
          expectType<Signal<Item>>(item)
          expectType<Signal<number>>(index)
          return [text(item.at('label'))]
        },
      })
      const fromParam = (items: ReadSignal<readonly Item[]>): Renderable => [
        each(items, { key: (i) => i.label, render: (item) => [text(item.at('label'))] }),
      ]
      void fromParam
    }
    void _
  })

  it('derived takes mapped inputs', () => {
    const _ = () => {
      const a = s.at('count').map((n) => n * 2)
      const out = derived(a, s.at('user.id'), (n, id) => `${id}:${n}`)
      expectType<MappedSignal<string>>(out)
      const arr = derived([a, a.map(String)], (n, str) => `${str}${n}`)
      expectType<MappedSignal<string>>(arr)
    }
    void _
  })
})

describe('Signal.map — .at() after .map() is a compile error', () => {
  it('rejects .at() on a mapped signal (slice before mapping)', () => {
    const _ = () => {
      const mapped = s.at('user').map((u) => u.profile)
      // @ts-expect-error — .at() on a mapped signal is unavailable (slice first)
      mapped.at('name')
    }
    void _
  })

  it('still allows the idiomatic slice-then-map, and a mapped signal is a ReadSignal', () => {
    const _ = () => {
      const name: MappedSignal<string> = s
        .at('user')
        .at('profile')
        .map((p) => p.name)
      expectType<ReadSignal<string>>(name)
      // a MappedSignal flows into anything that accepts ReadSignal<T>
      const accept = (_v: ReadSignal<string>): void => {}
      accept(s.at('user.id').map((id) => id))
    }
    void _
  })

  it('allows chaining .map() after .map()', () => {
    const _ = () => {
      const out: MappedSignal<string> = s
        .at('count')
        .map((n) => n + 1)
        .map((n) => String(n))
      expectType<ReadSignal<string>>(out)
    }
    void _
  })
})

describe('derived', () => {
  it('combines independent signals (array form), callback receives spread values', () => {
    const _ = () => {
      const label: MappedSignal<string> = derived(
        [s.at('user.id'), s.at('count')],
        (id, n) => `${id}:${n}`,
      )
      expectType<ReadSignal<string>>(label)
    }
    void _
  })

  it('infers tuple element types in the callback (array form)', () => {
    const _ = () =>
      derived([s.at('count'), s.at('user.profile.email')], (n, email) => {
        expectType<number>(n)
        expectType<string | undefined>(email)
        return n
      })
    void _
  })

  it('variadic form: 2 sources, positional value types inferred', () => {
    const _ = () => {
      const label: MappedSignal<string> = derived(s.at('user.id'), s.at('count'), (id, n) => {
        expectType<string>(id)
        expectType<number>(n)
        return `${id}:${n}`
      })
      expectType<ReadSignal<string>>(label)
    }
    void _
  })

  it('variadic form: 3 sources', () => {
    const _ = () => {
      const out: MappedSignal<string> = derived(
        s.at('count'),
        s.at('user.id'),
        s.at('user.profile.email'),
        (n, id, email) => {
          expectType<number>(n)
          expectType<string>(id)
          expectType<string | undefined>(email)
          return id
        },
      )
      expectType<ReadSignal<string>>(out)
    }
    void _
  })

  it('result is a mapped signal — .at() on it is a compile error', () => {
    const _ = () => {
      // @ts-expect-error — derived(...) yields a mapped signal; slice the sources instead
      derived(s.at('count'), s.at('count'), (a, b) => ({ x: a + b })).at('x')
    }
    void _
  })
})

// A `show`/`branch` narrowed param IS the condition handle, so over a MAPPED
// condition it is a mapped signal: `.at()` on it throws at runtime, and the type
// must say so (the gallery shell #267 reached that throw through a narrowed param
// typed as a plain `Signal`).
describe('show/branch narrowed params keep a mapped condition mapped', () => {
  type Status = { kind: 'ok'; label: string } | { kind: 'err'; message: string }

  it('show over a mapped condition: the narrowed param rejects .at(), allows .map()', () => {
    const _ = () => {
      const frames = s.at('items').map((items) => items[0]!)
      show(frames, (item) => {
        expectType<MappedSignal<Item>>(item)
        // It is typed MappedSignal (not merely ReadSignal), so a `.at()` here
        // prints the remedy rather than "property does not exist".
        const r: keyof NonNullable<(typeof item)['at']> = remedy
        void r
        // @ts-expect-error — the narrowed param of a mapped condition has no path
        item.at('label')
        return [text(item.map((i) => i.label))]
      })
    }
    void _
  })

  it('branch over a mapped value: every arm param rejects .at(), allows .map()', () => {
    const _ = () => {
      const status = s
        .at('count')
        .map((n): Status => (n > 0 ? { kind: 'ok', label: 'x' } : { kind: 'err', message: 'y' }))
      branch(status, (v) => v.kind, {
        ok: (v) => {
          const r: keyof NonNullable<(typeof v)['at']> = remedy
          void r
          // @ts-expect-error — the arm param of a mapped value has no path
          v.at('label')
          return [text(v.map((x) => x.label))]
        },
        err: (v) => [text(v.map((x) => x.message))],
      })
    }
    void _
  })

  it('over a PATH condition the narrowed param still slices with .at()', () => {
    const _ = (status: Signal<Status>) => {
      show(s.at('session'), (session) => {
        expectType<Signal<{ token: string }>>(session)
        return [text(session.at('token'))]
      })
      branch(status, (v) => v.kind, {
        ok: (v) => {
          expectType<Signal<{ kind: 'ok'; label: string }>>(v)
          return [text(v.at('label'))]
        },
        err: (v) => [text(v.at('message'))],
      })
    }
    void _
  })

  it('over a ReadSignal (a helper param of unknown kind) the narrowed param reads, never slices', () => {
    const _ = () => {
      const helper = (session: ReadSignal<{ token: string } | null>): Renderable => [
        show(session, (live) => {
          // @ts-expect-error — the condition may be mapped, so the arm may not slice
          live.at('token')
          return [text(live.map((x) => x.token))]
        }),
      ]
      void helper
      const statusOf = (st: ReadSignal<Status>): Renderable => [
        branch(st, (v) => v.kind, {
          ok: (v) => [text(v.map((x) => x.label))],
          err: (v) => [text(v.map((x) => x.message))],
        }),
      ]
      void statusOf
      const keyed = (k: ReadSignal<'a' | 'b'>): Renderable => [
        branch(k, { a: () => [text('A')], b: () => [text('B')] }),
      ]
      void keyed
    }
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
