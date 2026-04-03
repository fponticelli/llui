import { createRouter, route, param } from '@llui/router'
import { connectRouter } from '@llui/router/connect'
import type { Route } from './types'

export const router = createRouter<Route>([
  route([], () => ({ page: 'home', tab: 'global' })),
  route(['login'], () => ({ page: 'login' })),
  route(['register'], () => ({ page: 'register' })),
  route(['settings'], () => ({ page: 'settings' })),
  route(['editor'], () => ({ page: 'editor' })),
  route(['editor', param('slug')], ({ slug }) => ({ page: 'editor', slug })),
  route(['article', param('slug')], ({ slug }) => ({ page: 'article', slug })),
  route(['profile', param('username')], ({ username }) => ({ page: 'profile', username, tab: 'authored' })),
  route(['profile', param('username'), 'favorites'], ({ username }) => ({ page: 'profile', username, tab: 'favorited' })),
])

export const routing = connectRouter(router)
