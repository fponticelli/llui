import {
  createRouter,
  repeatedRouteCodec,
  route,
  routeCodec,
  type RouteLocation,
  type StandardSchemaV1,
} from '@llui/router'
import { connectRouter } from '@llui/router/connect'

const stringSchema: StandardSchemaV1<string> = {
  '~standard': {
    version: 1,
    vendor: 'github-explorer',
    validate: (value) =>
      typeof value === 'string' ? { value } : { issues: [{ message: 'Expected a string' }] },
  },
}

const positivePageSchema: StandardSchemaV1<string, number> = {
  '~standard': {
    version: 1,
    vendor: 'github-explorer',
    validate: (value) => {
      const page = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN
      return Number.isSafeInteger(page) && page > 0
        ? { value: page }
        : { issues: [{ message: 'Expected a positive page number' }] }
    },
  },
}

const pathSchema: StandardSchemaV1<readonly string[], string[]> = {
  '~standard': {
    version: 1,
    vendor: 'github-explorer',
    validate: (value) =>
      Array.isArray(value) && value.every((segment) => typeof segment === 'string')
        ? { value: [...value] }
        : { issues: [{ message: 'Expected path segments' }] },
  },
}

const text = routeCodec(stringSchema, String)
const page = routeCodec(positivePageSchema, String)
const path = repeatedRouteCodec(pathSchema, (segments) => segments)

export const routes = {
  home: route('/'),
  search: route('/search', {
    query: { q: text, p: page },
    defaults: { q: '', p: 1 },
  }),
  repoCode: route('/:owner/:repo'),
  repoIssues: route('/:owner/:repo/issues'),
  tree: route('/:owner/:repo/tree/*path', { params: { path } }),
}

export type Location = RouteLocation<typeof routes>

export const router = createRouter(routes, { mode: 'history' })
export const routing = connectRouter(router)
