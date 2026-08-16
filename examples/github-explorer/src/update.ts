import type {
  State,
  Msg,
  Effect,
  Page,
  Repo,
  TreeEntry,
  FileContent,
  Issue,
  ApiError,
} from './types'
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

// True when the current page targets the given repo. A resource response whose
// owner/name doesn't match has been superseded by a later navigation, so it must
// be dropped rather than merged into the now-current page's data.
function pageMatches(state: State, owner: string, name: string): boolean {
  const page = state.page
  return (
    (page.page === 'repo' || page.page === 'tree') && page.owner === owner && page.name === name
  )
}

export function update(state: State, msg: Msg): [State, Effect[]] {
  switch (msg.type) {
    case 'navigate':
      // From popstate (browser back/forward) or router.link click
      // router.link already calls pushState, so no push needed here
      return loadPage(state, pageForLocation(msg.location))

    case 'unmatched':
      return loadPage(state, pageForUnmatched(msg.url))

    case 'setQuery': {
      const q = msg.value
      if (!q.trim()) {
        const page: Page =
          state.page.page === 'search'
            ? { ...state.page, q: '', data: { type: 'idle' } }
            : state.page
        return [{ ...state, query: q, page }, [cancel('search')]]
      }
      // Debounce: set the page to loading, then fire the delayed search.
      const page: Page =
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
      return [{ ...state, query: q, page }, [debounce('search', 300, searchHttp(searchUrl(q, 0)))]]
    }

    case 'submitSearch': {
      if (!state.query.trim()) return [state, []]
      const page: Page = { page: 'search', q: state.query, p: 1, data: { type: 'loading' } }
      return [
        { ...state, page },
        [
          routing.push('search', { q: state.query, p: 1 }),
          cancel('search', searchHttp(searchUrl(state.query, 0))),
        ],
      ]
    }

    case 'searchOk': {
      const q = state.query
      const page: Page =
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
      if (page.page === 'search' && page.q) {
        effects.push(routing.replace('search', { q: page.q, p: page.p }))
      }
      return [{ ...state, page }, effects]
    }

    case 'repoOk':
      // Drop a response the user has navigated away from (stale race winner).
      if (!pageMatches(state, msg.owner, msg.name)) return [state, []]
      return withRepoLoaded(state, msg.payload)

    case 'contentsOk':
      if (!pageMatches(state, msg.owner, msg.name)) return [state, []]
      return withContentsLoaded(state, msg.payload)

    case 'readmeOk':
      if (!pageMatches(state, msg.owner, msg.name)) return [state, []]
      return withReadmeLoaded(state, msg.payload)

    case 'issuesOk':
      if (!pageMatches(state, msg.owner, msg.name)) return [state, []]
      return withIssuesLoaded(state, msg.payload)

    case 'apiError':
      // Only set failure if data hasn't already loaded successfully
      if (state.page.data.type !== 'success') {
        return [setPageFailure(state, msg.error), []]
      }
      return [state, []]

    case 'readmeError':
      // README is optional — a 404 just means no readme, not an error
      return [state, []]

    case 'contentsError':
      // Contents error on an otherwise loaded page — don't destroy repo data
      if (state.page.data.type === 'success') return [state, []]
      return [setPageFailure(state, msg.error), []]

    case 'nextPage':
      return changePage(state, 1)

    case 'prevPage':
      return changePage(state, -1)

    case 'openPath': {
      const currentPage = state.page
      const owner =
        currentPage.page === 'repo' || currentPage.page === 'tree' ? currentPage.owner : ''
      const name =
        currentPage.page === 'repo' || currentPage.page === 'tree' ? currentPage.name : ''
      if (!owner) return [state, []]
      const page: Page = { page: 'tree', owner, name, path: msg.path, data: { type: 'loading' } }
      const [s, effects] = loadPage(state, page)
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
 * Load data for a page. Does NOT push to history — the caller
 * decides whether to push (user action) or not (popstate).
 */
function loadPage(state: State, page: Page): [State, Effect[]] {
  if (page.page === 'notFound') {
    return [
      { ...state, page, query: '' },
      [cancel('search'), cancel('repo'), cancel('contents'), cancel('readme'), cancel('issues')],
    ]
  }
  const effects: Effect[] = []
  const nextPage = { ...page, data: { type: 'loading' as const } }

  switch (nextPage.page) {
    case 'search':
      if (nextPage.q) {
        effects.push(searchHttp(searchUrl(nextPage.q, nextPage.p - 1)))
        return [{ ...state, page: nextPage, query: nextPage.q }, effects]
      }
      return [{ ...state, page: { ...nextPage, data: { type: 'idle' } }, query: '' }, []]

    case 'repo':
      // Each resource fetch is keyed so a new navigation cancels any in-flight
      // request of the same kind (belt; the owner/name guard in `update` is the
      // suspenders). Together they prevent repo A's response landing in repo B.
      effects.push(cancel('repo', repoHttp(nextPage.owner, nextPage.name)))
      if (nextPage.tab === 'code') {
        effects.push(cancel('contents', contentsHttp(nextPage.owner, nextPage.name, '')))
        effects.push(cancel('readme', readmeHttp(nextPage.owner, nextPage.name)))
        effects.push(cancel('issues'))
      } else {
        effects.push(cancel('issues', issuesHttp(nextPage.owner, nextPage.name)))
        effects.push(cancel('contents'))
        effects.push(cancel('readme'))
      }
      return [{ ...state, page: nextPage }, effects]

    case 'tree':
      effects.push(cancel('repo', repoHttp(nextPage.owner, nextPage.name)))
      effects.push(cancel('contents', contentsHttp(nextPage.owner, nextPage.name, nextPage.path)))
      effects.push(cancel('readme'))
      effects.push(cancel('issues'))
      return [{ ...state, page: nextPage }, effects]
  }
}

export function pageForUnmatched(url: string): Page {
  return { page: 'notFound', url, data: { type: 'idle' } }
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

function setPageFailure(state: State, error: ApiError): State {
  const data = { type: 'failure' as const, error }
  switch (state.page.page) {
    case 'notFound':
      return state
    case 'search':
    case 'repo':
    case 'tree':
      return { ...state, page: { ...state.page, data } }
  }
}

function withRepoLoaded(state: State, repo: Repo): [State, Effect[]] {
  const page = state.page
  if (page.page === 'repo' && page.tab === 'code') {
    const prev = page.data.type === 'success' ? page.data.data : { repo, tree: [], readme: '' }
    return [{ ...state, page: { ...page, data: { type: 'success', data: { ...prev, repo } } } }, []]
  }
  if (page.page === 'repo' && page.tab === 'issues') {
    const prev = page.data.type === 'success' ? page.data.data : { repo, issues: [] }
    return [{ ...state, page: { ...page, data: { type: 'success', data: { ...prev, repo } } } }, []]
  }
  if (page.page === 'tree') {
    const prev = page.data.type === 'success' ? page.data.data : { repo, tree: [] }
    return [{ ...state, page: { ...page, data: { type: 'success', data: { ...prev, repo } } } }, []]
  }
  return [state, []]
}

function withContentsLoaded(state: State, payload: TreeEntry[] | FileContent): [State, Effect[]] {
  const page = state.page
  if (page.page === 'repo' && page.tab === 'code' && Array.isArray(payload)) {
    const prev =
      page.data.type === 'success' ? page.data.data : { repo: null, tree: [], readme: '' }
    return [
      { ...state, page: { ...page, data: { type: 'success', data: { ...prev, tree: payload } } } },
      [],
    ]
  }
  if (page.page === 'tree') {
    const prevRepo: Repo | null =
      page.data.type === 'success' && 'repo' in page.data.data ? page.data.data.repo : null
    if (Array.isArray(payload)) {
      return [
        {
          ...state,
          page: { ...page, data: { type: 'success', data: { repo: prevRepo, tree: payload } } },
        },
        [],
      ]
    }
    return [
      {
        ...state,
        page: { ...page, data: { type: 'success', data: { repo: prevRepo, file: payload } } },
      },
      [],
    ]
  }
  return [state, []]
}

function withReadmeLoaded(state: State, readme: string): [State, Effect[]] {
  const page = state.page
  if (page.page === 'repo' && page.tab === 'code') {
    const prev =
      page.data.type === 'success' ? page.data.data : { repo: null, tree: [], readme: '' }
    return [
      { ...state, page: { ...page, data: { type: 'success', data: { ...prev, readme } } } },
      [],
    ]
  }
  return [state, []]
}

function withIssuesLoaded(state: State, issues: Issue[]): [State, Effect[]] {
  const page = state.page
  if (page.page === 'repo' && page.tab === 'issues') {
    const prev = page.data.type === 'success' ? page.data.data : { repo: null, issues: [] }
    return [
      { ...state, page: { ...page, data: { type: 'success', data: { ...prev, issues } } } },
      [],
    ]
  }
  return [state, []]
}

function changePage(state: State, delta: number): [State, Effect[]] {
  const page = state.page
  if (page.page !== 'search' || page.data.type !== 'success') return [state, []]
  const p = Math.max(1, page.p + delta)
  const nextPage: Page = { ...page, p, data: { type: 'loading', stale: page.data.data } }
  return [
    { ...state, page: nextPage },
    [routing.replace('search', { q: page.q, p }), searchHttp(searchUrl(page.q, p - 1))],
  ]
}
