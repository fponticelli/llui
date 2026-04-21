import type {
  State,
  Msg,
  Effect,
  Route,
  SearchData,
  Repo,
  TreeEntry,
  FileContent,
  Issue,
} from './types'
import { agentConnect, agentConfirm, agentLog } from './types'
import { http, cancel, debounce, timeout, clipboardWrite } from '@llui/effects'
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
    onSuccess: (data) => ({ type: 'repoOk', payload: data as Repo }),
    onError: (error) => ({ type: 'apiError', error }),
  })
}

function contentsHttp(owner: string, name: string, path: string) {
  return http<Msg>({
    url: contentsUrl(owner, name, path),
    headers: JSON_HEADERS,
    onSuccess: (data) => ({
      type: 'contentsOk',
      payload: data as TreeEntry[] | FileContent,
    }),
    onError: (error) => ({ type: 'contentsError', error }),
  })
}

function readmeHttp(owner: string, name: string) {
  return http<Msg>({
    url: readmeUrl(owner, name),
    headers: HTML_HEADERS,
    onSuccess: (data) => ({ type: 'readmeOk', payload: data as string }),
    onError: (error) => ({ type: 'readmeError', error }),
  })
}

function issuesHttp(owner: string, name: string) {
  return http<Msg>({
    url: issuesUrl(owner, name),
    headers: JSON_HEADERS,
    onSuccess: (data) => ({ type: 'issuesOk', payload: data as Issue[] }),
    onError: (error) => ({ type: 'apiError', error }),
  })
}

export function update(state: State, msg: Msg): [State, Effect[]] {
  switch (msg.type) {
    case 'navigate':
      // From popstate (browser back/forward) or router.link click
      // router.link already calls pushState, so no push needed here
      return loadRoute(state, msg.route)

    case 'setQuery': {
      const q = msg.value
      if (!q.trim()) {
        const route: Route =
          state.route.page === 'search'
            ? { ...state.route, q: '', data: { type: 'idle' } }
            : state.route
        return [{ ...state, query: q, route }, [cancel('search')]]
      }
      // Debounce: set route to loading, fire delayed search
      const route: Route =
        state.route.page === 'search'
          ? {
              ...state.route,
              q,
              p: 1,
              data: {
                type: 'loading',
                stale: state.route.data.type === 'success' ? state.route.data.data : undefined,
              },
            }
          : { page: 'search', q, p: 1, data: { type: 'loading' } }
      return [{ ...state, query: q, route }, [debounce('search', 300, searchHttp(searchUrl(q, 0)))]]
    }

    case 'submitSearch': {
      if (!state.query.trim()) return [state, []]
      const route: Route = { page: 'search', q: state.query, p: 1, data: { type: 'loading' } }
      return [
        { ...state, route },
        [routing.push(route), cancel('search', searchHttp(searchUrl(state.query, 0)))],
      ]
    }

    case 'searchOk': {
      const q = state.query
      const route: Route =
        state.route.page === 'search'
          ? {
              ...state.route,
              q,
              data: {
                type: 'success',
                data: { repos: msg.payload.items, total: msg.payload.total_count },
              },
            }
          : state.route
      const effects: Effect[] = []
      // Update URL to reflect search query (from debounce or submit)
      if (route.page === 'search' && route.q) effects.push(routing.replace(route))
      return [{ ...state, route }, effects]
    }

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
      const route: Route = { page: 'tree', owner, name, path: msg.path, data: { type: 'loading' } }
      const [s, effects] = loadRoute(state, route)
      return [s, [routing.push(route), ...effects]]
    }

    case 'agent': {
      switch (msg.sub) {
        case 'connect': {
          const [next, effects] = agentConnect.update(state.agent.connect, msg.msg, {
            mintUrl: '/agent/mint',
          })
          return [{ ...state, agent: { ...state.agent, connect: next } }, effects]
        }
        case 'confirm': {
          const [next, effects] = agentConfirm.update(state.agent.confirm, msg.msg)
          return [{ ...state, agent: { ...state.agent, confirm: next } }, effects]
        }
        case 'log': {
          const [next, effects] = agentLog.update(state.agent.log, msg.msg)
          return [{ ...state, agent: { ...state.agent, log: next } }, effects]
        }
        case 'ui': {
          switch (msg.msg.type) {
            case 'Copy': {
              const snippet = state.agent.connect.pendingToken?.connectSnippet ?? ''
              if (!snippet) return [state, []]
              return [
                { ...state, agent: { ...state.agent, ui: { ...state.agent.ui, copied: true } } },
                [
                  clipboardWrite(snippet),
                  timeout<Msg>(2000, {
                    type: 'agent',
                    sub: 'ui',
                    msg: { type: 'CopyFaded' },
                  }),
                ],
              ]
            }
            case 'CopyFaded':
              return [
                { ...state, agent: { ...state.agent, ui: { ...state.agent.ui, copied: false } } },
                [],
              ]
          }
        }
      }
    }
  }
}

// ── Navigation ───────────────────────────────────────────────────

/**
 * Load data for a route. Does NOT push to history — the caller
 * decides whether to push (user action) or not (popstate).
 */
function loadRoute(state: State, route: Route): [State, Effect[]] {
  const effects: Effect[] = []
  const r = { ...route, data: { type: 'loading' as const } }

  switch (r.page) {
    case 'search':
      if (r.q) {
        effects.push(searchHttp(searchUrl(r.q, r.p - 1)))
        return [{ ...state, route: r, query: r.q }, effects]
      }
      return [{ ...state, route: { ...r, data: { type: 'idle' } }, query: '' }, []]

    case 'repo':
      effects.push(repoHttp(r.owner, r.name))
      if (r.tab === 'code') {
        effects.push(contentsHttp(r.owner, r.name, ''))
        effects.push(readmeHttp(r.owner, r.name))
      } else {
        effects.push(issuesHttp(r.owner, r.name))
      }
      return [{ ...state, route: r }, effects]

    case 'tree':
      effects.push(repoHttp(r.owner, r.name))
      effects.push(contentsHttp(r.owner, r.name, r.path))
      return [{ ...state, route: r }, effects]
  }
}

// ── State update helpers ─────────────────────────────────────────

function setRouteData(state: State, data: { type: string; [k: string]: unknown }): State {
  return { ...state, route: { ...state.route, data } as Route }
}

function withSearchData(
  state: State,
  build: () => { type: 'success'; data: SearchData },
): [State, Effect[]] {
  const r = state.route
  if (r.page !== 'search') return [state, []]
  return [{ ...state, route: { ...r, data: build() } }, []]
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
    const prev =
      r.data.type === 'success'
        ? r.data.data
        : { repo: null as unknown as Repo, tree: [], readme: '' }
    return [
      { ...state, route: { ...r, data: { type: 'success', data: { ...prev, tree: payload } } } },
      [],
    ]
  }
  if (r.page === 'tree') {
    const prevRepo =
      r.data.type === 'success' && 'repo' in r.data.data
        ? r.data.data.repo
        : (null as unknown as Repo)
    if (Array.isArray(payload)) {
      return [
        {
          ...state,
          route: { ...r, data: { type: 'success', data: { repo: prevRepo, tree: payload } } },
        },
        [],
      ]
    }
    return [
      {
        ...state,
        route: { ...r, data: { type: 'success', data: { repo: prevRepo, file: payload } } },
      },
      [],
    ]
  }
  return [state, []]
}

function withReadmeLoaded(state: State, readme: string): [State, Effect[]] {
  const r = state.route
  if (r.page === 'repo' && r.tab === 'code') {
    const prev =
      r.data.type === 'success'
        ? r.data.data
        : { repo: null as unknown as Repo, tree: [], readme: '' }
    return [{ ...state, route: { ...r, data: { type: 'success', data: { ...prev, readme } } } }, []]
  }
  return [state, []]
}

function withIssuesLoaded(state: State, issues: Issue[]): [State, Effect[]] {
  const r = state.route
  if (r.page === 'repo' && r.tab === 'issues') {
    const prev =
      r.data.type === 'success' ? r.data.data : { repo: null as unknown as Repo, issues: [] }
    return [{ ...state, route: { ...r, data: { type: 'success', data: { ...prev, issues } } } }, []]
  }
  return [state, []]
}

function changePage(state: State, delta: number): [State, Effect[]] {
  const r = state.route
  if (r.page !== 'search' || r.data.type !== 'success') return [state, []]
  const p = Math.max(1, r.p + delta)
  const newRoute: Route = { ...r, p, data: { type: 'loading', stale: r.data.data } }
  return [
    { ...state, route: newRoute },
    [routing.replace(newRoute), searchHttp(searchUrl(r.q, p - 1))],
  ]
}
