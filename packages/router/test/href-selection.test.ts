import { describe, it, expect } from 'vitest'
import { createRouter, route, param } from '../src/index'

// Issue #104 — `href()` must produce the correct URL from a PLAIN route object.
// Selection used to freeze the builder's output computed with sample params
// ('1') and demand strict equality on every frozen field, so any field that
// varies with the real params — or any non-default value for a
// builder-emitted one — fell through to the fallback URL. The only exact path
// was a non-enumerable SYMBOL tag, which cannot survive the framework's own
// JSON-serializable-State contract (devtools time travel, replayTrace, agent
// snapshots, SSR hydration all hand `href()` a serialized route).

type UserRoute = { page: 'home' } | { page: 'user'; id: string; tab: string }

function userRouter() {
  return createRouter<UserRoute>([
    route([], () => ({ page: 'home' })),
    route(['user', param('id')], ({ id }) => ({ page: 'user', id: id!, tab: 'profile' })),
  ])
}

describe('#104 href() selects on route SHAPE, not sample-computed values', () => {
  it('resolves a route that omits a builder-emitted default', () => {
    expect(userRouter().href({ page: 'user', id: '7' } as UserRoute)).toBe('#/user/7')
  })

  it('resolves a NON-default value for a builder-emitted field', () => {
    // `tab` is not representable in this URL, so it cannot disqualify the def
    // that owns it — the only correct URL is still /user/7.
    expect(userRouter().href({ page: 'user', id: '7', tab: 'settings' })).toBe('#/user/7')
  })

  it('resolves a param-DERIVED field', () => {
    type R = { page: 'home' } | { page: 'user'; id: string; title: string }
    const router = createRouter<R>([
      route([], () => ({ page: 'home' })),
      route(['user', param('id')], ({ id }) => ({
        page: 'user',
        id: id!,
        title: `User ${id}`,
      })),
    ])
    // The frozen sample value was 'User 1', so every real title mismatched.
    expect(router.href({ page: 'user', id: '42', title: 'User 42' })).toBe('#/user/42')
  })

  it('still discriminates two defs by a genuinely constant field', () => {
    // The relaxation must not cost the discriminant: `tab` is the only thing
    // separating these two URL templates.
    type R = { page: 'profile'; username: string; tab: 'authored' | 'favorited' }
    const router = createRouter<R>(
      [
        route(['profile', param('username')], ({ username }) => ({
          page: 'profile' as const,
          username: username!,
          tab: 'authored' as const,
        })),
        route(['profile', param('username'), 'favorites'], ({ username }) => ({
          page: 'profile' as const,
          username: username!,
          tab: 'favorited' as const,
        })),
      ],
      { fallback: { page: 'profile', username: '', tab: 'authored' } },
    )
    expect(router.href({ page: 'profile', username: 'bob', tab: 'authored' })).toBe('#/profile/bob')
    expect(router.href({ page: 'profile', username: 'bob', tab: 'favorited' })).toBe(
      '#/profile/bob/favorites',
    )
  })
})

describe('#104 a serialized route formats identically to a matched one', () => {
  const router = userRouter()

  const shapes = ['#/', '#/user/7', '#/user/hello%20world']

  it('href(JSON round-trip of a matched route) equals href(matched route)', () => {
    for (const input of shapes) {
      const matched = router.match(input)
      const serialized = JSON.parse(JSON.stringify(matched)) as UserRoute
      expect(router.href(serialized)).toBe(router.href(matched))
    }
  })

  it('holds for a route whose builder emits a param-DERIVED field', () => {
    // This is the shape the symbol tag was hiding: the tagged object formatted
    // correctly while its serialized twin — what devtools time travel,
    // replayTrace, agent snapshots and SSR hydration all hand back — did not.
    type R = { page: 'home' } | { page: 'user'; id: string; title: string }
    const derived = createRouter<R>([
      route([], () => ({ page: 'home' })),
      route(['user', param('id')], ({ id }) => ({ page: 'user', id: id!, title: `User ${id}` })),
    ])
    const matched = derived.match('#/user/7')
    const serialized = JSON.parse(JSON.stringify(matched)) as R
    expect(derived.href(matched)).toBe('#/user/7')
    expect(derived.href(serialized)).toBe(derived.href(matched))
  })

  it('a matched route carries no hidden symbol tag', () => {
    // Routes live in State, which must be JSON-serializable. A non-enumerable
    // symbol carrying the RouteDef is not a legal carrier for anything
    // reachable from State — and a fast path only it can take is a fast path
    // that silently breaks for every serialized route.
    for (const input of shapes) {
      expect(Object.getOwnPropertySymbols(router.match(input) as object)).toEqual([])
    }
  })
})

describe('#104 the build()-call-count property from the perf fix survives', () => {
  it('never calls a route builder while formatting', () => {
    let builds = 0
    const count = <T>(f: () => T) => {
      builds++
      return f()
    }
    type R = { page: 'home' } | { page: 'user'; id: string; tab: string }
    const router = createRouter<R>([
      route([], () => count(() => ({ page: 'home' as const }))),
      route(['user', param('id')], ({ id }) =>
        count(() => ({ page: 'user' as const, id: id!, tab: 'profile' })),
      ),
    ])

    // A bounded, per-def constant at construction — the analysis that
    // classifies each emitted field runs once per def, never per format.
    expect(builds).toBeLessThanOrEqual(2 * router.routes.length + 1)

    builds = 0
    for (let i = 0; i < 50; i++) {
      expect(router.href({ page: 'user', id: String(i), tab: 'profile' })).toBe(`#/user/${i}`)
    }
    expect(builds).toBe(0)
  })
})
