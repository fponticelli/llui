import { createRouter, route, param, rest } from '@llui/router'
import { connectRouter } from '@llui/router/connect'
import type { Route } from './types'

export const router = createRouter<Route>([
  route([], () => ({ page: 'search', q: '', data: { type: 'idle' } })),
  route(['search'], { query: ['q'] }, ({ q }) => ({ page: 'search', q: q ?? '', data: { type: 'loading' } })),
  route([param('owner'), param('name')], ({ owner, name }) => ({ page: 'repo', owner, name, tab: 'code', data: { type: 'loading' } })),
  route([param('owner'), param('name'), 'issues'], ({ owner, name }) => ({ page: 'repo', owner, name, tab: 'issues', data: { type: 'loading' } })),
  route([param('owner'), param('name'), 'tree', rest('path')], ({ owner, name, path }) => ({ page: 'tree', owner, name, path, data: { type: 'loading' } })),
], {
  mode: 'history',
  fallback: { page: 'search', q: '', data: { type: 'idle' } },
})

export const routing = connectRouter(router)
