import type { State, Msg, Effect, Route, ApiError, SearchData, RepoCodeData, RepoIssuesData, TreeDirData, TreeFileData, Repo, TreeEntry, FileContent, Issue } from './types'
import { http, cancel } from '@llui/effects'
import { searchUrl, repoUrl, contentsUrl, readmeUrl, issuesUrl, JSON_HEADERS, HTML_HEADERS } from './api'
import { router, routing } from './router'

export function initState(): State {
  const route = router.match(location.pathname + location.search)
  return {
    route,
    query: route.page === 'search' ? route.q : '',
  }
}

export function update(state: State, msg: Msg): [State, Effect[]] {
  switch (msg.type) {
    case 'navigate':
      return navigateTo(state, msg.route)

    case 'setQuery':
      return [{ ...state, query: msg.value }, []]

    case 'submitSearch': {
      if (!state.query.trim()) return [state, []]
      const route: Route = { page: 'search', q: state.query, data: { type: 'loading' } }
      return [
        { ...state, route },
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
      return withSearchData(state, (prev) => ({
        type: 'success',
        data: { repos: msg.payload.items, total: msg.payload.total_count, pageNum: prev?.pageNum ?? 0 },
      }))

    case 'repoOk':
      return withRepoLoaded(state, msg.payload)

    case 'contentsOk':
      return withContentsLoaded(state, msg.payload)

    case 'readmeOk':
      return withReadmeLoaded(state, msg.payload)

    case 'issuesOk':
      return withIssuesLoaded(state, msg.payload)

    case 'apiError':
      // Only set failure if data hasn't already loaded successfully
      if (state.route.data.type !== 'success') {
        return [setRouteData(state, { type: 'failure', error: msg.error }), []]
      }
      return [state, []]

    case 'readmeError':
      // README is optional — a 404 just means no readme, not an error
      return [state, []]

    case 'contentsError':
      // Contents error on an otherwise loaded page — don't destroy repo data
      if (state.route.data.type === 'success') return [state, []]
      return [setRouteData(state, { type: 'failure', error: msg.error }), []]

    case 'nextPage':
      return changePage(state, 1)

    case 'prevPage':
      return changePage(state, -1)

    case 'openPath': {
      const r = state.route
      const owner = r.page === 'repo' || r.page === 'tree' ? r.owner : ''
      const name = r.page === 'repo' || r.page === 'tree' ? r.name : ''
      if (!owner) return [state, []]
      return navigateTo(state, { page: 'tree', owner, name, path: msg.path, data: { type: 'loading' } })
    }
  }
}

// ── Navigation ───────────────────────────────────────────────────

function navigateTo(state: State, route: Route): [State, Effect[]] {
  const effects: Effect[] = [routing.push(route)]
  const r = { ...route, data: { type: 'loading' as const } }

  switch (r.page) {
    case 'search':
      if (r.q) {
        effects.push(http({ url: searchUrl(r.q, 0), headers: JSON_HEADERS, onSuccess: 'searchOk', onError: 'apiError' }))
        return [{ ...state, route: r, query: r.q }, effects]
      }
      return [{ ...state, route: { ...r, data: { type: 'idle' } }, query: '' }, [routing.push(r)]]

    case 'repo':
      effects.push(http({ url: repoUrl(r.owner, r.name), headers: JSON_HEADERS, onSuccess: 'repoOk', onError: 'apiError' }))
      if (r.tab === 'code') {
        effects.push(http({ url: contentsUrl(r.owner, r.name, ''), headers: JSON_HEADERS, onSuccess: 'contentsOk', onError: 'contentsError' }))
        effects.push(http({ url: readmeUrl(r.owner, r.name), headers: HTML_HEADERS, onSuccess: 'readmeOk', onError: 'readmeError' }))
      } else {
        effects.push(http({ url: issuesUrl(r.owner, r.name), headers: JSON_HEADERS, onSuccess: 'issuesOk', onError: 'apiError' }))
      }
      return [{ ...state, route: r }, effects]

    case 'tree':
      effects.push(http({ url: repoUrl(r.owner, r.name), headers: JSON_HEADERS, onSuccess: 'repoOk', onError: 'apiError' }))
      effects.push(http({ url: contentsUrl(r.owner, r.name, r.path), headers: JSON_HEADERS, onSuccess: 'contentsOk', onError: 'contentsError' }))
      return [{ ...state, route: r }, effects]
  }
}

// ── State update helpers ─────────────────────────────────────────

function setRouteData(state: State, data: { type: string; [k: string]: unknown }): State {
  return { ...state, route: { ...state.route, data } as Route }
}

function withSearchData(
  state: State,
  build: (prev: SearchData | undefined) => { type: 'success'; data: SearchData },
): [State, Effect[]] {
  const r = state.route
  if (r.page !== 'search') return [state, []]
  const prev = r.data.type === 'success' ? r.data.data : undefined
  return [{ ...state, route: { ...r, data: build(prev) } }, []]
}

function withRepoLoaded(state: State, repo: Repo): [State, Effect[]] {
  const r = state.route
  if (r.page === 'repo' && r.tab === 'code') {
    const prev = r.data.type === 'success' ? r.data.data : { repo, tree: [], readme: '' }
    return [{ ...state, route: { ...r, data: { type: 'success', data: { ...prev, repo } } } }, []]
  }
  if (r.page === 'repo' && r.tab === 'issues') {
    const prev = r.data.type === 'success' ? r.data.data : { repo, issues: [] }
    return [{ ...state, route: { ...r, data: { type: 'success', data: { ...prev, repo } } } }, []]
  }
  if (r.page === 'tree') {
    const prev = r.data.type === 'success' ? r.data.data : { repo, tree: [] }
    return [{ ...state, route: { ...r, data: { type: 'success', data: { ...prev, repo } } } }, []]
  }
  return [state, []]
}

function withContentsLoaded(state: State, payload: TreeEntry[] | FileContent): [State, Effect[]] {
  const r = state.route
  if (r.page === 'repo' && r.tab === 'code' && Array.isArray(payload)) {
    const prev = r.data.type === 'success' ? r.data.data : { repo: null as unknown as Repo, tree: [], readme: '' }
    return [{ ...state, route: { ...r, data: { type: 'success', data: { ...prev, tree: payload } } } }, []]
  }
  if (r.page === 'tree') {
    const prevRepo = r.data.type === 'success' && 'repo' in r.data.data ? r.data.data.repo : null as unknown as Repo
    if (Array.isArray(payload)) {
      return [{ ...state, route: { ...r, data: { type: 'success', data: { repo: prevRepo, tree: payload } } } }, []]
    }
    return [{ ...state, route: { ...r, data: { type: 'success', data: { repo: prevRepo, file: payload } } } }, []]
  }
  return [state, []]
}

function withReadmeLoaded(state: State, readme: string): [State, Effect[]] {
  const r = state.route
  if (r.page === 'repo' && r.tab === 'code') {
    const prev = r.data.type === 'success' ? r.data.data : { repo: null as unknown as Repo, tree: [], readme: '' }
    return [{ ...state, route: { ...r, data: { type: 'success', data: { ...prev, readme } } } }, []]
  }
  return [state, []]
}

function withIssuesLoaded(state: State, issues: Issue[]): [State, Effect[]] {
  const r = state.route
  if (r.page === 'repo' && r.tab === 'issues') {
    const prev = r.data.type === 'success' ? r.data.data : { repo: null as unknown as Repo, issues: [] }
    return [{ ...state, route: { ...r, data: { type: 'success', data: { ...prev, issues } } } }, []]
  }
  return [state, []]
}

function changePage(state: State, delta: number): [State, Effect[]] {
  const r = state.route
  if (r.page !== 'search' || r.data.type !== 'success') return [state, []]
  const pageNum = Math.max(0, r.data.data.pageNum + delta)
  const stale = r.data.data
  const newRoute: Route = { ...r, data: { type: 'loading', stale: { ...stale, pageNum } } }
  return [
    { ...state, route: newRoute },
    [http({ url: searchUrl(r.q, pageNum), headers: JSON_HEADERS, onSuccess: 'searchOk', onError: 'apiError' })],
  ]
}
