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

// The shape heuristic alone is not SOUND: two sample builds cannot tell a
// param-derived field from a constant when its value happens to coincide across
// them, and a def that genuinely owns that constant then wins the route. The
// URL that comes out is plausible, points at a DIFFERENT route, and is what
// `link()` puts in its href AND pushes — worse than the visible `#/` fallback
// #104 started from. The selection is therefore VERIFIED by round-tripping the
// formatted path back through `match()` whenever more than one def competes.

describe('#104 a competing def must never steal a route it cannot produce', () => {
  type Kind = 'self' | 'other'
  type R = { page: 'a' | 'b'; id: string; kind: Kind }
  const fallback: R = { page: 'a', id: '', kind: 'other' }

  // `kind` is param-DERIVED on /a/:id but reads as a constant `'other'` from
  // any sample that is not literally 'me' — while /b/:id owns `'self'` for
  // real. Sampling cannot separate these; a round-trip can.
  const aDef = route<R>(['a', param('id')], ({ id }) => ({
    page: 'a',
    id: id!,
    kind: id === 'me' ? 'self' : 'other',
  }))
  const bDef = route<R>(['b', param('id')], ({ id }) => ({ page: 'b', id: id!, kind: 'self' }))

  it('formats a param-derived field whose value coincides across the samples', () => {
    const router = createRouter<R>([aDef, bDef], { fallback })
    const matched = router.match('#/a/me')
    expect(matched).toEqual({ page: 'a', id: 'me', kind: 'self' })
    // Was `#/b/me`: a plausible, shareable URL for a route the user never asked
    // for, which `link()` would also navigate to on click.
    expect(router.href(matched)).toBe('#/a/me')
  })

  it('gives the same answer whichever order the defs are registered in', () => {
    const r: R = { page: 'a', id: 'me', kind: 'self' }
    expect(createRouter<R>([aDef, bDef], { fallback }).href(r)).toBe('#/a/me')
    expect(createRouter<R>([bDef, aDef], { fallback }).href(r)).toBe('#/a/me')
  })
})

describe('#104 def registration order must not decide the URL', () => {
  // `long: id.length > 5` is false for BOTH samples, so it is misclassified as
  // a constant on both defs and every candidate scores a contradiction. The
  // shape tiers then produced no winner at all and the last-resort loop
  // formatted with the FIRST structurally-formattable def — correct only by
  // accident of ordering.
  type R = { page: 'u'; id: string; long: boolean; mode?: 'edit' }
  const fallback: R = { page: 'u', id: '', long: false }
  const listDef = route<R>(['u', param('id')], ({ id }) => ({
    page: 'u',
    id: id!,
    long: id!.length > 5,
  }))
  const editDef = route<R>(['u', param('id'), 'edit'], ({ id }) => ({
    page: 'u',
    id: id!,
    long: id!.length > 5,
    mode: 'edit',
  }))

  for (const [label, defs] of [
    ['list first', [listDef, editDef]],
    ['edit first', [editDef, listDef]],
  ] as const) {
    it(`formats both routes correctly with the defs registered ${label}`, () => {
      const router = createRouter<R>([...defs], { fallback })
      expect(router.href({ page: 'u', id: 'averylongid', long: true })).toBe('#/u/averylongid')
      expect(router.href({ page: 'u', id: 'averylongid', long: true, mode: 'edit' })).toBe(
        '#/u/averylongid/edit',
      )
      // …and the short-id shape, where the misclassification does not bite.
      expect(router.href({ page: 'u', id: 'ab', long: false })).toBe('#/u/ab')
    })
  }
})

describe('#104 the verification is load-bearing, not a fallback tier', () => {
  // These are the shapes a simpler implementation — single-sample
  // classification, or "an omitted constant disqualifies the def" — gets wrong
  // and no earlier test caught, because the relaxed tier rescued every one.
  type R = { page: 'p'; id: string; tab?: string; mode?: string }
  const fallback: R = { page: 'p', id: '', tab: 'read' }
  const plain = route<R>(['p', param('id')], ({ id }) => ({ page: 'p', id: id!, tab: 'read' }))
  const edit = route<R>(['p', param('id'), 'edit'], ({ id }) => ({
    page: 'p',
    id: id!,
    tab: 'read',
    mode: 'edit',
  }))
  const router = createRouter<R>([plain, edit], { fallback })

  it('prefers the def that leaves nothing unexplained when the route omits a default', () => {
    // Both defs agree on every constant the route carries (`page`), and the
    // scores tie — the later-registered def used to win, emitting the /edit
    // URL for a route that carries no `mode` at all.
    expect(router.href({ page: 'p', id: '7' })).toBe('#/p/7')
    expect(router.href({ page: 'p', id: '7', tab: 'read' })).toBe('#/p/7')
  })

  it('still reaches the more specific def when the route carries its field', () => {
    expect(router.href({ page: 'p', id: '7', mode: 'edit' })).toBe('#/p/7/edit')
  })

  it('round-trips every matched route back to its own URL', () => {
    for (const input of ['#/p/7', '#/p/7/edit']) {
      expect(router.href(router.match(input))).toBe(input)
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
