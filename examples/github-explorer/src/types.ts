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

export interface FileContent {
  name: string
  path: string
  content: string
  encoding: string
  size: number
  html_url: string
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

export type SearchData = { repos: Repo[]; total: number }
export type RepoCodeData = { repo: Repo; tree: TreeEntry[]; readme: string }
export type RepoIssuesData = { repo: Repo; issues: Issue[] }
export type TreeDirData = { repo: Repo; tree: TreeEntry[] }
export type TreeFileData = { repo: Repo; file: FileContent }

export type Route =
  | { page: 'search'; q: string; p: number; data: Async<SearchData, ApiError> }
  | { page: 'repo'; owner: string; name: string; tab: 'code'; data: Async<RepoCodeData, ApiError> }
  | { page: 'repo'; owner: string; name: string; tab: 'issues'; data: Async<RepoIssuesData, ApiError> }
  | { page: 'tree'; owner: string; name: string; path: string; data: Async<TreeDirData | TreeFileData, ApiError> }

// ── State ────────────────────────────────────────────────────────

import type { Async, ApiError, Effect as BuiltinEffect } from '@llui/effects'
import type { RouterEffect } from '@llui/router/connect'

export type { Async, ApiError }

export interface State {
  route: Route
  query: string
}

// ── Messages ─────────────────────────────────────────────────────

export type Msg =
  | { type: 'navigate'; route: Route }
  | { type: 'setQuery'; value: string }
  | { type: 'submitSearch' }
  | { type: 'searchOk'; payload: { total_count: number; items: Repo[] } }
  | { type: 'repoOk'; payload: Repo }
  | { type: 'contentsOk'; payload: TreeEntry[] | FileContent }
  | { type: 'readmeOk'; payload: string }
  | { type: 'issuesOk'; payload: Issue[] }
  | { type: 'apiError'; error: ApiError }
  | { type: 'readmeError'; error: ApiError }
  | { type: 'contentsError'; error: ApiError }
  | { type: 'nextPage' }
  | { type: 'prevPage' }
  | { type: 'openPath'; path: string; isDir: boolean }

// ── Effects ──────────────────────────────────────────────────────

export type Effect = BuiltinEffect | RouterEffect
