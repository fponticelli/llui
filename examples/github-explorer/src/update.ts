import type { State, Msg, Effect, Route } from './types'
import { http, cancel, debounce } from '@llui/effects'
import { searchUrl, repoUrl, contentsUrl, readmeUrl, issuesUrl, JSON_HEADERS, HTML_HEADERS } from './api'
import { router, routing } from './router'

export function initState(): State {
  return {
    route: router.match(location.hash),
    query: '',
    repos: [],
    searchTotal: 0,
    searchPage: 0,
    repo: null,
    tree: [],
    readme: '',
    issues: [],
    loading: false,
    error: null,
  }
}

export function update(state: State, msg: Msg): [State, Effect[]] {
  switch (msg.type) {
    case 'navigate':
      return navigateTo(state, msg.route)

    case 'setQuery':
      return [{ ...state, query: msg.value, error: null }, []]

    case 'submitSearch': {
      if (!state.query.trim()) return [state, []]
      const route: Route = { page: 'search', q: state.query }
      return [
        { ...state, route, loading: true, error: null, searchPage: 0 },
        [
          routing.push(route),
          cancel('search', http({
            url: searchUrl(state.query, 0),
            headers: JSON_HEADERS,
            onSuccess: 'searchOk',
            onError: 'apiError',
          })),
        ],
      ]
    }

    case 'searchOk':
      return [{ ...state, repos: msg.payload.items, searchTotal: msg.payload.total_count, loading: false }, []]

    case 'repoOk':
      return [{ ...state, repo: msg.payload, loading: false }, []]

    case 'treeOk':
      return [{ ...state, tree: msg.payload, loading: false }, []]

    case 'readmeOk':
      return [{ ...state, readme: msg.payload }, []]

    case 'issuesOk':
      return [{ ...state, issues: msg.payload, loading: false }, []]

    case 'apiError': {
      const errMsg = typeof msg.error === 'string' ? msg.error
        : (msg.error as Record<string, unknown>)?.message
          ? String((msg.error as Record<string, unknown>).message)
          : 'API request failed'
      // Check for rate limiting
      if (errMsg.includes('rate limit') || errMsg.includes('API rate')) {
        return [{ ...state, error: 'GitHub API rate limit exceeded (60 requests/hour). Try again later.', loading: false }, []]
      }
      return [{ ...state, error: errMsg, loading: false }, []]
    }

    case 'nextPage': {
      const page = state.searchPage + 1
      const q = state.route.page === 'search' ? state.route.q : state.query
      return [
        { ...state, searchPage: page, loading: true },
        [http({ url: searchUrl(q, page), headers: JSON_HEADERS, onSuccess: 'searchOk', onError: 'apiError' })],
      ]
    }

    case 'prevPage': {
      const page = Math.max(0, state.searchPage - 1)
      const q = state.route.page === 'search' ? state.route.q : state.query
      return [
        { ...state, searchPage: page, loading: true },
        [http({ url: searchUrl(q, page), headers: JSON_HEADERS, onSuccess: 'searchOk', onError: 'apiError' })],
      ]
    }

    case 'openPath': {
      // Resolve owner/name from current state — event handler only sent the path
      const r = state.route
      const owner = r.page === 'repo' || r.page === 'tree' ? r.owner : ''
      const name = r.page === 'repo' || r.page === 'tree' ? r.name : ''
      if (!owner) return [state, []]
      const route: Route = msg.isDir
        ? { page: 'tree', owner, name, path: msg.path }
        : { page: 'tree', owner, name, path: msg.path }
      return navigateTo({ ...state, route }, route)
    }
  }
}

function navigateTo(state: State, route: Route): [State, Effect[]] {
  const s: State = { ...state, route, error: null, loading: true }
  const effects: Effect[] = []

  switch (route.page) {
    case 'search':
      s.query = route.q
      if (route.q) {
        effects.push(http({ url: searchUrl(route.q, 0), headers: JSON_HEADERS, onSuccess: 'searchOk', onError: 'apiError' }))
      } else {
        s.loading = false
        s.repos = []
      }
      break

    case 'repo':
      effects.push(http({ url: repoUrl(route.owner, route.name), headers: JSON_HEADERS, onSuccess: 'repoOk', onError: 'apiError' }))
      if (route.tab === 'code') {
        effects.push(http({ url: contentsUrl(route.owner, route.name, ''), headers: JSON_HEADERS, onSuccess: 'treeOk', onError: 'apiError' }))
        effects.push(http({ url: readmeUrl(route.owner, route.name), headers: HTML_HEADERS, onSuccess: 'readmeOk', onError: 'apiError' }))
      } else {
        effects.push(http({ url: issuesUrl(route.owner, route.name), headers: JSON_HEADERS, onSuccess: 'issuesOk', onError: 'apiError' }))
      }
      break

    case 'tree':
      effects.push(http({ url: repoUrl(route.owner, route.name), headers: JSON_HEADERS, onSuccess: 'repoOk', onError: 'apiError' }))
      effects.push(http({ url: contentsUrl(route.owner, route.name, route.path), headers: JSON_HEADERS, onSuccess: 'treeOk', onError: 'apiError' }))
      break
  }

  return [s, effects]
}
