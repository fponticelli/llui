import type { State, Msg, Effect, Route, PageState } from './types'
import { http, cancel } from '@llui/effects'
import { searchUrl, repoUrl, contentsUrl, readmeUrl, issuesUrl, JSON_HEADERS, HTML_HEADERS } from './api'
import { router, routing } from './router'

export function initState(): State {
  return {
    route: router.match(location.hash),
    query: '',
    pageState: { page: 'search', repos: [], total: 0, pageNum: 0 },
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
        { ...state, route, loading: true, error: null, pageState: { page: 'search', repos: [], total: 0, pageNum: 0 } },
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

    case 'searchOk': {
      const ps = state.pageState
      if (ps.page !== 'search') return [state, []]
      return [{ ...state, loading: false, pageState: { ...ps, repos: msg.payload.items, total: msg.payload.total_count } }, []]
    }

    case 'repoOk': {
      const ps = state.pageState
      if (ps.page === 'repo') return [{ ...state, loading: false, pageState: { ...ps, repo: msg.payload } }, []]
      if (ps.page === 'tree') return [{ ...state, pageState: { ...ps, repo: msg.payload } }, []]
      return [state, []]
    }

    case 'contentsOk': {
      const ps = state.pageState
      if (Array.isArray(msg.payload)) {
        if (ps.page === 'repo') return [{ ...state, loading: false, pageState: { ...ps, tree: msg.payload } }, []]
        if (ps.page === 'tree') return [{ ...state, loading: false, pageState: { ...ps, tree: msg.payload, file: null } }, []]
      } else {
        if (ps.page === 'tree') return [{ ...state, loading: false, pageState: { ...ps, file: msg.payload, tree: [] } }, []]
      }
      return [{ ...state, loading: false }, []]
    }

    case 'readmeOk': {
      const ps = state.pageState
      if (ps.page === 'repo') return [{ ...state, pageState: { ...ps, readme: msg.payload } }, []]
      return [state, []]
    }

    case 'issuesOk': {
      const ps = state.pageState
      if (ps.page === 'repo') return [{ ...state, loading: false, pageState: { ...ps, issues: msg.payload } }, []]
      return [state, []]
    }

    case 'apiError': {
      const raw = msg.error
      const errMsg = typeof raw === 'string' ? raw
        : (raw as Record<string, unknown>)?.message
          ? String((raw as Record<string, unknown>).message)
          : 'API request failed'
      return [{ ...state, error: errMsg, loading: false }, []]
    }

    case 'nextPage': {
      const ps = state.pageState
      if (ps.page !== 'search') return [state, []]
      const page = ps.pageNum + 1
      return [
        { ...state, loading: true, pageState: { ...ps, pageNum: page } },
        [http({ url: searchUrl(state.query, page), headers: JSON_HEADERS, onSuccess: 'searchOk', onError: 'apiError' })],
      ]
    }

    case 'prevPage': {
      const ps = state.pageState
      if (ps.page !== 'search') return [state, []]
      const page = Math.max(0, ps.pageNum - 1)
      return [
        { ...state, loading: true, pageState: { ...ps, pageNum: page } },
        [http({ url: searchUrl(state.query, page), headers: JSON_HEADERS, onSuccess: 'searchOk', onError: 'apiError' })],
      ]
    }

    case 'openPath': {
      const r = state.route
      const owner = r.page === 'repo' || r.page === 'tree' ? r.owner : ''
      const name = r.page === 'repo' || r.page === 'tree' ? r.name : ''
      if (!owner) return [state, []]
      const route: Route = { page: 'tree', owner, name, path: msg.path }
      return navigateTo(state, route)
    }
  }
}

function navigateTo(state: State, route: Route): [State, Effect[]] {
  const effects: Effect[] = [routing.push(route)]

  let pageState: PageState
  switch (route.page) {
    case 'search':
      pageState = { page: 'search', repos: [], total: 0, pageNum: 0 }
      if (route.q) {
        effects.push(http({ url: searchUrl(route.q, 0), headers: JSON_HEADERS, onSuccess: 'searchOk', onError: 'apiError' }))
        return [{ ...state, route, query: route.q, pageState, loading: true, error: null }, effects]
      }
      return [{ ...state, route, query: route.q, pageState, loading: false, error: null }, []]

    case 'repo':
      pageState = { page: 'repo', repo: null, tab: route.tab, tree: [], readme: '', issues: [] }
      effects.push(http({ url: repoUrl(route.owner, route.name), headers: JSON_HEADERS, onSuccess: 'repoOk', onError: 'apiError' }))
      if (route.tab === 'code') {
        effects.push(http({ url: contentsUrl(route.owner, route.name, ''), headers: JSON_HEADERS, onSuccess: 'contentsOk', onError: 'apiError' }))
        effects.push(http({ url: readmeUrl(route.owner, route.name), headers: HTML_HEADERS, onSuccess: 'readmeOk', onError: 'apiError' }))
      } else {
        effects.push(http({ url: issuesUrl(route.owner, route.name), headers: JSON_HEADERS, onSuccess: 'issuesOk', onError: 'apiError' }))
      }
      return [{ ...state, route, pageState, loading: true, error: null }, effects]

    case 'tree':
      pageState = { page: 'tree', repo: null, tree: [], file: null }
      effects.push(http({ url: repoUrl(route.owner, route.name), headers: JSON_HEADERS, onSuccess: 'repoOk', onError: 'apiError' }))
      effects.push(http({ url: contentsUrl(route.owner, route.name, route.path), headers: JSON_HEADERS, onSuccess: 'contentsOk', onError: 'apiError' }))
      return [{ ...state, route, pageState, loading: true, error: null }, effects]
  }
}
