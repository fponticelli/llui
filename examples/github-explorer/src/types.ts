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
// `repo` is `Repo | null` because the sub-resource responses (contents / readme /
// issues) can arrive before the repo metadata does, so the page can enter its
// `success` state with the repo not yet loaded. Views render `—` placeholders
// until `repoOk` fills it in. Modeling it honestly avoids a `null as Repo` lie.
export type RepoCodeData = { repo: Repo | null; tree: TreeEntry[]; readme: string }
export type RepoIssuesData = { repo: Repo | null; issues: Issue[] }
export type TreeDirData = { repo: Repo | null; tree: TreeEntry[] }
export type TreeFileData = { repo: Repo | null; file: FileContent }

export type Route =
  | { page: 'search'; q: string; p: number; data: Async<SearchData, ApiError> }
  | { page: 'repo'; owner: string; name: string; tab: 'code'; data: Async<RepoCodeData, ApiError> }
  | {
      page: 'repo'
      owner: string
      name: string
      tab: 'issues'
      data: Async<RepoIssuesData, ApiError>
    }
  | {
      page: 'tree'
      owner: string
      name: string
      path: string
      data: Async<TreeDirData | TreeFileData, ApiError>
    }

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
  /** @intent("Navigate to a route") @alwaysAffordable */
  | { type: 'navigate'; route: Route }
  /** @intent("Update the search query") */
  | { type: 'setQuery'; value: string }
  /** @intent("Submit the current search query") */
  | { type: 'submitSearch' }
  /** @humanOnly */
  | { type: 'searchOk'; payload: { total_count: number; items: Repo[] } }
  // Each resource response carries the {owner, name} it was requested for, so the
  // reducer can drop a late response from a repo the user has since navigated away
  // from (guarding against A→B navigation races) instead of merging it into B.
  /** @humanOnly */
  | { type: 'repoOk'; owner: string; name: string; payload: Repo }
  /** @humanOnly */
  | { type: 'contentsOk'; owner: string; name: string; payload: TreeEntry[] | FileContent }
  /** @humanOnly */
  | { type: 'readmeOk'; owner: string; name: string; payload: string }
  /** @humanOnly */
  | { type: 'issuesOk'; owner: string; name: string; payload: Issue[] }
  /** @humanOnly */
  | { type: 'apiError'; error: ApiError }
  /** @humanOnly */
  | { type: 'readmeError'; error: ApiError }
  /** @humanOnly */
  | { type: 'contentsError'; error: ApiError }
  /** @intent("Go to the next page of results") */
  | { type: 'nextPage' }
  /** @intent("Go to the previous page of results") */
  | { type: 'prevPage' }
  /** @intent("Open a file or directory from the tree") @alwaysAffordable */
  | { type: 'openPath'; path: string; isDir: boolean }

// ── Effects ──────────────────────────────────────────────────────

export type Effect = BuiltinEffect | RouterEffect
