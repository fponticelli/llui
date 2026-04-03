// ── Domain ───────────────────────────────────────────────────────

export interface Repo {
  id: number
  full_name: string
  owner: { login: string; avatar_url: string }
  name: string
  description: string | null
  stargazers_count: number
  forks_count: number
  open_issues_count: number
  language: string | null
  updated_at: string
  html_url: string
  default_branch: string
}

export interface TreeEntry {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  sha: string
}

export interface Issue {
  id: number
  number: number
  title: string
  state: 'open' | 'closed'
  user: { login: string; avatar_url: string }
  created_at: string
  comments: number
  labels: Array<{ name: string; color: string }>
}

// ── Route ────────────────────────────────────────────────────────

export type Route =
  | { page: 'search'; q: string }
  | { page: 'repo'; owner: string; name: string; tab: 'code' | 'issues' }
  | { page: 'tree'; owner: string; name: string; path: string }

// ── State ────────────────────────────────────────────────────────

export interface State {
  route: Route
  query: string
  // Search results
  repos: Repo[]
  searchTotal: number
  searchPage: number
  // Repo detail
  repo: Repo | null
  tree: TreeEntry[]
  readme: string
  issues: Issue[]
  // Loading / errors
  loading: boolean
  error: string | null
}

// ── Messages ─────────────────────────────────────────────────────

export type Msg =
  | { type: 'navigate'; route: Route }
  | { type: 'setQuery'; value: string }
  | { type: 'submitSearch' }
  | { type: 'searchOk'; payload: { total_count: number; items: Repo[] } }
  | { type: 'repoOk'; payload: Repo }
  | { type: 'treeOk'; payload: TreeEntry[] }
  | { type: 'readmeOk'; payload: string }
  | { type: 'issuesOk'; payload: Issue[] }
  | { type: 'apiError'; error: string }
  | { type: 'nextPage' }
  | { type: 'prevPage' }
  | { type: 'openPath'; path: string; isDir: boolean }

// ── Effects ──────────────────────────────────────────────────────

import type { Effect as BuiltinEffect } from '@llui/effects'
import type { RouterEffect } from '@llui/router/connect'

export type Effect = BuiltinEffect | RouterEffect
