import type { State, Msg, Effect, Page, Repo, TreeEntry, FileContent, Issue } from './types'
import type { Location } from './router'
import { http, cancel, debounce } from '@llui/effects'
import {
  searchUrl,
  repoUrl,
  contentsUrl,
  readmeUrl,
  issuesUrl,
  JSON_HEADERS,
  HTML_HEADERS,
} from './api'
import { routing } from './router'

// ── Typed http helpers ──────────────────────────────────────────

function searchHttp(url: string) {
  return http<Msg>({
    url,
    headers: JSON_HEADERS,
    onSuccess: (data) => ({
      type: 'searchOk',
      payload: data as { total_count: number; items: Repo[] },
    }),
    onError: (error) => ({ type: 'apiError', error }),
  })
}

function repoHttp(owner: string, name: string) {
  return http<Msg>({
    url: repoUrl(owner, name),
    headers: JSON_HEADERS,
    onSuccess: (data) => ({ type: 'repoOk', owner, name, payload: data as Repo }),
    onError: (error) => ({ type: 'apiError', error }),
  })
}

function contentsHttp(owner: string, name: string, path: string) {
  return http<Msg>({
    url: contentsUrl(owner, name, path),
    headers: JSON_HEADERS,
    onSuccess: (data) => ({
      type: 'contentsOk',
      owner,
      name,
      payload: data as TreeEntry[] | FileContent,
    }),
    onError: (error) => ({ type: 'contentsError', error }),
  })
}

function readmeHttp(owner: string, name: string) {
  return http<Msg>({
    url: readmeUrl(owner, name),
    headers: HTML_HEADERS,
    onSuccess: (data) => ({ type: 'readmeOk', owner, name, payload: data as string }),
    onError: (error) => ({ type: 'readmeError', error }),
  })
}

function issuesHttp(owner: string, name: string) {
  return http<Msg>({
    url: issuesUrl(owner, name),
    headers: JSON_HEADERS,
    onSuccess: (data) => ({ type: 'issuesOk', owner, name, payload: data as Issue[] }),
    onError: (error) => ({ type: 'apiError', error }),
  })
}

// True when the current route targets the given repo. A resource response whose
// owner/name doesn't match has been superseded by a later navigation, so it must
// be dropped rather than merged into the now-current route's data.
function routeMatches(state: State, owner: string, name: string): boolean {
  const r = state.page
  return (r.page === 'repo' || r.page === 'tree') && r.owner === owner && r.name === name
}

export function update(state: State, msg: Msg): [State, Effect[]] {
  switch (msg.type) {
    case 'navigate':
      // From popstate (browser back/forward) or router.link click
      // router.link already calls pushState, so no push needed here
      return loadRoute(state, pageForLocation(msg.location))

    case 'setQuery': {
      const q = msg.value
      if (!q.trim()) {
        const route: Page =
          state.page.page === 'search'
            ? { ...state.page, q: '', data: { type: 'idle' } }
            : state.page
        return [{ ...state, query: q, page: route }, [cancel('search')]]
      }
      // Debounce: set route to loading, fire delayed search
      const route: Page =
        state.page.page === 'search'
          ? {
              ...state.page,
              q,
              p: 1,
              data: {
                type: 'loading',
                stale: state.page.data.type === 'success' ? state.page.data.data : undefined,
              },
            }
          : { page: 'search', q, p: 1, data: { type: 'loading' } }
      return [
        { ...state, query: q, page: route },
        [debounce('search', 300, searchHttp(searchUrl(q, 0)))],
      ]
    }

    case 'submitSearch': {
      if (!state.query.trim()) return [state, []]
      const route: Page = { page: 'search', q: state.query, p: 1, data: { type: 'loading' } }
      return [
        { ...state, page: route },
        [
          routing.push('search', { q: state.query, p: 1 }),
          cancel('search', searchHttp(searchUrl(state.query, 0))),
        ],
      ]
    }

    case 'searchOk': {
      const q = state.query
      const route: Page =
        state.page.page === 'search'
          ? {
              ...state.page,
              q,
              data: {
                type: 'success',
                data: { repos: msg.payload.items, total: msg.payload.total_count },
              },
            }
          : state.page
      const effects: Effect[] = []
      // Update URL to reflect search query (from debounce or submit)
      if (route.page === 'search' && route.q) {
        effects.push(routing.replace('search', { q: route.q, p: route.p }))
      }
      return [{ ...state, page: route }, effects]
    }

    case 'repoOk':
      // Drop a response the user has navigated away from (stale race winner).
      if (!routeMatches(state, msg.owner, msg.name)) return [state, []]
      return withRepoLoaded(state, msg.payload)

    case 'contentsOk':
      if (!routeMatches(state, msg.owner, msg.name)) return [state, []]
      return withContentsLoaded(state, msg.payload)

    case 'readmeOk':
      if (!routeMatches(state, msg.owner, msg.name)) return [state, []]
      return withReadmeLoaded(state, msg.payload)

    case 'issuesOk':
      if (!routeMatches(state, msg.owner, msg.name)) return [state, []]
      return withIssuesLoaded(state, msg.payload)

    case 'apiError':
      // Only set failure if data hasn't already loaded successfully
      if (state.page.data.type !== 'success') {
        return [setRouteData(state, { type: 'failure', error: msg.error }), []]
      }
      return [state, []]

    case 'readmeError':
      // README is optional — a 404 just means no readme, not an error
      return [state, []]

    case 'contentsError':
      // Contents error on an otherwise loaded page — don't destroy repo data
      if (state.page.data.type === 'success') return [state, []]
      return [setRouteData(state, { type: 'failure', error: msg.error }), []]

    case 'nextPage':
      return changePage(state, 1)

    case 'prevPage':
      return changePage(state, -1)

    case 'openPath': {
      const r = state.page
      const owner = r.page === 'repo' || r.page === 'tree' ? r.owner : ''
      const name = r.page === 'repo' || r.page === 'tree' ? r.name : ''
      if (!owner) return [state, []]
      const route: Page = { page: 'tree', owner, name, path: msg.path, data: { type: 'loading' } }
      const [s, effects] = loadRoute(state, route)
      return [
        s,
        [
          routing.push('tree', { owner, repo: name, path: msg.path.split('/').filter(Boolean) }),
          ...effects,
        ],
      ]
    }
  }
}

// ── Navigation ───────────────────────────────────────────────────

/**
 * Load data for a route. Does NOT push to history — the caller
 * decides whether to push (user action) or not (popstate).
 */
function loadRoute(state: State, route: Page): [State, Effect[]] {
  const effects: Effect[] = []
  const r = { ...route, data: { type: 'loading' as const } }

  switch (r.page) {
    case 'search':
      if (r.q) {
        effects.push(searchHttp(searchUrl(r.q, r.p - 1)))
        return [{ ...state, page: r, query: r.q }, effects]
      }
      return [{ ...state, page: { ...r, data: { type: 'idle' } }, query: '' }, []]

    case 'repo':
      // Each resource fetch is keyed so a new navigation cancels any in-flight
      // request of the same kind (belt; the owner/name guard in `update` is the
      // suspenders). Together they prevent repo A's response landing in repo B.
      effects.push(cancel('repo', repoHttp(r.owner, r.name)))
      if (r.tab === 'code') {
        effects.push(cancel('contents', contentsHttp(r.owner, r.name, '')))
        effects.push(cancel('readme', readmeHttp(r.owner, r.name)))
        effects.push(cancel('issues'))
      } else {
        effects.push(cancel('issues', issuesHttp(r.owner, r.name)))
        effects.push(cancel('contents'))
        effects.push(cancel('readme'))
      }
      return [{ ...state, page: r }, effects]

    case 'tree':
      effects.push(cancel('repo', repoHttp(r.owner, r.name)))
      effects.push(cancel('contents', contentsHttp(r.owner, r.name, r.path)))
      effects.push(cancel('readme'))
      effects.push(cancel('issues'))
      return [{ ...state, page: r }, effects]
  }
}

export function pageForLocation(location: Location): Page {
  switch (location.name) {
    case 'home':
      return { page: 'search', q: '', p: 1, data: { type: 'idle' } }
    case 'search':
      return {
        page: 'search',
        q: location.params.q,
        p: location.params.p,
        data: { type: 'loading' },
      }
    case 'repoCode':
      return {
        page: 'repo',
        owner: location.params.owner,
        name: location.params.repo,
        tab: 'code',
        data: { type: 'loading' },
      }
    case 'repoIssues':
      return {
        page: 'repo',
        owner: location.params.owner,
        name: location.params.repo,
        tab: 'issues',
        data: { type: 'loading' },
      }
    case 'tree':
      return {
        page: 'tree',
        owner: location.params.owner,
        name: location.params.repo,
        path: location.params.path.join('/'),
        data: { type: 'loading' },
      }
  }
}

// ── State update helpers ─────────────────────────────────────────

function setRouteData(state: State, data: { type: string; [k: string]: unknown }): State {
  return { ...state, page: { ...state.page, data } as Page }
}

function withRepoLoaded(state: State, repo: Repo): [State, Effect[]] {
  const r = state.page
  if (r.page === 'repo' && r.tab === 'code') {
    const prev = r.data.type === 'success' ? r.data.data : { repo, tree: [], readme: '' }
    return [{ ...state, page: { ...r, data: { type: 'success', data: { ...prev, repo } } } }, []]
  }
  if (r.page === 'repo' && r.tab === 'issues') {
    const prev = r.data.type === 'success' ? r.data.data : { repo, issues: [] }
    return [{ ...state, page: { ...r, data: { type: 'success', data: { ...prev, repo } } } }, []]
  }
  if (r.page === 'tree') {
    const prev = r.data.type === 'success' ? r.data.data : { repo, tree: [] }
    return [{ ...state, page: { ...r, data: { type: 'success', data: { ...prev, repo } } } }, []]
  }
  return [state, []]
}

function withContentsLoaded(state: State, payload: TreeEntry[] | FileContent): [State, Effect[]] {
  const r = state.page
  if (r.page === 'repo' && r.tab === 'code' && Array.isArray(payload)) {
    const prev = r.data.type === 'success' ? r.data.data : { repo: null, tree: [], readme: '' }
    return [
      { ...state, page: { ...r, data: { type: 'success', data: { ...prev, tree: payload } } } },
      [],
    ]
  }
  if (r.page === 'tree') {
    const prevRepo: Repo | null =
      r.data.type === 'success' && 'repo' in r.data.data ? r.data.data.repo : null
    if (Array.isArray(payload)) {
      return [
        {
          ...state,
          page: { ...r, data: { type: 'success', data: { repo: prevRepo, tree: payload } } },
        },
        [],
      ]
    }
    return [
      {
        ...state,
        page: { ...r, data: { type: 'success', data: { repo: prevRepo, file: payload } } },
      },
      [],
    ]
  }
  return [state, []]
}

function withReadmeLoaded(state: State, readme: string): [State, Effect[]] {
  const r = state.page
  if (r.page === 'repo' && r.tab === 'code') {
    const prev = r.data.type === 'success' ? r.data.data : { repo: null, tree: [], readme: '' }
    return [{ ...state, page: { ...r, data: { type: 'success', data: { ...prev, readme } } } }, []]
  }
  return [state, []]
}

function withIssuesLoaded(state: State, issues: Issue[]): [State, Effect[]] {
  const r = state.page
  if (r.page === 'repo' && r.tab === 'issues') {
    const prev = r.data.type === 'success' ? r.data.data : { repo: null, issues: [] }
    return [{ ...state, page: { ...r, data: { type: 'success', data: { ...prev, issues } } } }, []]
  }
  return [state, []]
}

function changePage(state: State, delta: number): [State, Effect[]] {
  const r = state.page
  if (r.page !== 'search' || r.data.type !== 'success') return [state, []]
  const p = Math.max(1, r.p + delta)
  const newRoute: Page = { ...r, p, data: { type: 'loading', stale: r.data.data } }
  return [
    { ...state, page: newRoute },
    [routing.replace('search', { q: r.q, p }), searchHttp(searchUrl(r.q, p - 1))],
  ]
}
