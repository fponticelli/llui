import { createRouter, route, routeCodec, type StandardSchemaV1 } from '../src/index.js'
import { connectRouter } from '../src/connect.js'

declare const numberSchema: StandardSchemaV1<string, number>
const numberCodec = routeCodec(numberSchema, String)
// @ts-expect-error codecs may only override parameters declared by the template
route('/users/:id', { params: { wrong: numberCodec } })
// @ts-expect-error defaults may only name path or declared query parameters
route('/users/:id', { defaults: { wrong: 1 } })
// @ts-expect-error path and query parameters share one normalized namespace
route('/users/:id', { query: { id: numberCodec } })
declare const derivingRefinement: StandardSchemaV1<{ id: number }, { id: number; derived: string }>
// @ts-expect-error whole-route refinement must preserve the normalized shape
route('/users/:id', { params: { id: numberCodec }, refine: derivingRefinement })
const router = createRouter({
  home: route('/'),
  user: route('/users/:id', { params: { id: numberCodec } }),
  search: route('/search', {
    query: { page: numberCodec },
    defaults: { page: 1 },
  }),
})

router.href('home')
router.href('user', { id: 1 })
router.href('search', {})
router.href('search', { page: 2 })
router.location('user', { id: 1 })
router.toPath('user', { id: 1 })
const matched = router.match('/users/1')
if (matched?.name === 'user') {
  matched.params.id satisfies number
  // @ts-expect-error discriminating by name exposes only that route's parameters
  void matched.params.page
}
const routing = connectRouter(router)
routing.push('user', { id: 1 })
routing.replace('home')
routing.navigate('search', { page: 2 })
routing.link(() => undefined, 'user', { id: 1 }, {}, [])
type NavigateOnly = { type: 'navigate'; location: ReturnType<typeof router.location> }
// @ts-expect-error the default listener can also emit an explicit unmatched message
routing.listener((_message: NavigateOnly) => undefined)

// @ts-expect-error unknown route name
router.href('missing')
// @ts-expect-error parameterless route rejects params
router.href('home', {})
// @ts-expect-error required parameter is missing
router.href('user', {})
// @ts-expect-error semantic output type is enforced
router.href('user', { id: '1' })
// @ts-expect-error extra parameter is rejected
router.href('user', { id: 1, extra: true })
const extraUserParams = { id: 1, extra: true }
// @ts-expect-error exact parameter typing also rejects extra keys from variables
router.href('user', extraUserParams)
// @ts-expect-error connected operations share the same exact destination type
routing.navigate('user', { id: '1' })
// @ts-expect-error connected operations reject extra keys from variables too
routing.push('user', extraUserParams)
// @ts-expect-error location uses the same semantic output type
router.location('user', { id: '1' })
// @ts-expect-error path generation rejects unknown routes too
router.toPath('missing')
// @ts-expect-error replace rejects parameters for a parameterless route
routing.replace('home', {})
// @ts-expect-error links use the same exact destination typing
routing.link(() => undefined, 'user', { id: 1, extra: true }, {}, [])
