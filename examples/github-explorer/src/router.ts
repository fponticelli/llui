import { createRouter, route, param, rest } from '@llui/router'
import { connectRouter } from '@llui/router/connect'
import type { Route } from './types'

export const router = createRouter<Route>([
  route([], () => ({ page: 'search', q: '' })),
  route(['search'], { query: ['q'] }, ({ q }) => ({ page: 'search', q: q ?? '' })),
  route([param('owner'), param('name')], ({ owner, name }) => ({ page: 'repo', owner, name, tab: 'code' })),
  route([param('owner'), param('name'), 'issues'], ({ owner, name }) => ({ page: 'repo', owner, name, tab: 'issues' })),
  route([param('owner'), param('name'), 'tree', rest('path')], ({ owner, name, path }) => ({ page: 'tree', owner, name, path })),
], {
  fallback: { page: 'search', q: '' },
})

export const routing = connectRouter(router)
