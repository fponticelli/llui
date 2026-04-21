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
import { agentConnect, agentConfirm, agentLog, type AgentEffect } from '@llui/agent/client'

export type { Async, ApiError }

type AgentConnectMsg = agentConnect.AgentConnectMsg
type AgentConfirmMsg = agentConfirm.AgentConfirmMsg
type AgentLogMsg = agentLog.AgentLogMsg

export { agentConnect, agentConfirm, agentLog }

export type AgentUiState = {
  /** True for ~2s after the user clicks the Copy snippet button. */
  copied: boolean
}

export type AgentUiMsg = { type: 'Copy' } | { type: 'CopyFaded' }

export interface State {
  route: Route
  query: string
  agent: {
    connect: agentConnect.AgentConnectState
    confirm: agentConfirm.AgentConfirmState
    log: agentLog.AgentLogState
    ui: AgentUiState
  }
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
  /** @humanOnly */
  | { type: 'repoOk'; payload: Repo }
  /** @humanOnly */
  | { type: 'contentsOk'; payload: TreeEntry[] | FileContent }
  /** @humanOnly */
  | { type: 'readmeOk'; payload: string }
  /** @humanOnly */
  | { type: 'issuesOk'; payload: Issue[] }
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
  // Agent sub-component messages (envelope pattern — internal routing, not dispatchable by Claude)
  /** @humanOnly */
  | { type: 'agent'; sub: 'connect'; msg: AgentConnectMsg }
  /** @humanOnly */
  | { type: 'agent'; sub: 'confirm'; msg: AgentConfirmMsg }
  /** @humanOnly */
  | { type: 'agent'; sub: 'log'; msg: AgentLogMsg }
  /** @humanOnly */
  | { type: 'agent'; sub: 'ui'; msg: AgentUiMsg }

// ── Effects ──────────────────────────────────────────────────────

export type Effect = BuiltinEffect | RouterEffect | AgentEffect
