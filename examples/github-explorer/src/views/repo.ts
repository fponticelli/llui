import { div, h1, h3, a, p, span, text, show, branch, each } from '@llui/dom'
import type { State, Msg, Route, Repo, TreeEntry, Issue } from '../types'
import type { Send, Signal } from '@llui/dom'
import { routing } from '../router'
import { readmeView } from './foreign-readme'
import { codeView } from './foreign-code'

function repoFromRoute(r: Route): Repo | null {
  if (r.page === 'repo' && r.data.type === 'success') return r.data.data.repo
  if (r.page === 'tree' && r.data.type === 'success') return r.data.data.repo
  return null
}

/** Extract owner/name from route — always available (from URL, not API) */
function routeOwnerName(r: Route): { owner: string; name: string } | null {
  if (r.page === 'repo') return { owner: r.owner, name: r.name }
  if (r.page === 'tree') return { owner: r.owner, name: r.name }
  return null
}

// routing.link needs literal owner/name for href. The Route is read from
// location.pathname at branch-render time — the URL is current because
// routing.handleEffect pushes state before the navigate message resolves.
export function repoPage(routeSig: Signal<Route>, route: Route, send: Send<Msg>): Node[] {
  // owner/name from the current route (literal values for routing.link hrefs)
  const owner = 'owner' in route ? route.owner : ''
  const name = 'name' in route ? route.name : ''

  return [
    div({ class: 'repo-header' }, [
      div({ class: 'container' }, [
        h1([
          text(routeSig.map((r) => routeOwnerName(r)?.owner ?? '')),
          text(' / '),
          routing.link(
            send,
            { page: 'repo', owner, name, tab: 'code', data: { type: 'loading' } },
            {},
            [text(routeSig.map((r) => routeOwnerName(r)?.name ?? ''))],
          ),
        ]),
        div({ class: 'stats' }, [
          span([
            text(
              routeSig.map(
                (r) => `★ ${repoFromRoute(r)?.stargazers_count?.toLocaleString() ?? '—'}`,
              ),
            ),
          ]),
          span([
            text(
              routeSig.map((r) => `🍴 ${repoFromRoute(r)?.forks_count?.toLocaleString() ?? '—'}`),
            ),
          ]),
          span([
            text(routeSig.map((r) => `Issues: ${repoFromRoute(r)?.open_issues_count ?? '—'}`)),
          ]),
        ]),
        show(
          routeSig.map((r) => !!repoFromRoute(r)?.description),
          () => [p([text(routeSig.map((r) => repoFromRoute(r)?.description ?? ''))])],
        ),
      ]),
    ]),
    // Tab nav
    div({ class: 'tab-nav' }, [
      div({ class: 'container' }, [
        routing.link(
          send,
          { page: 'repo', owner, name, tab: 'code', data: { type: 'loading' } },
          {
            class: routeSig.map((r) => (r.page !== 'repo' || r.tab === 'code' ? 'active' : '')),
          },
          [text('Code')],
        ),
        routing.link(
          send,
          { page: 'repo', owner, name, tab: 'issues', data: { type: 'loading' } },
          {
            class: routeSig.map((r) => (r.page === 'repo' && r.tab === 'issues' ? 'active' : '')),
          },
          [text('Issues')],
        ),
      ]),
    ]),
    // Content
    div({ class: 'container' }, [
      branch(
        routeSig.map((r) => {
          if (r.data.type === 'loading') return 'loading'
          if (r.data.type === 'failure') return 'error'
          if (r.page === 'repo' && r.tab === 'issues') return 'issues'
          if (r.page === 'tree' && r.data.type === 'success' && 'file' in r.data.data) return 'file'
          return 'code'
        }),
        {
          loading: () => [div({ class: 'loading' }, [text('Loading...')])],
          error: () => [
            div({ class: 'error' }, [
              text(
                routeSig.map((r) => {
                  if (r.data.type !== 'failure') return ''
                  const err = r.data.error
                  switch (err.kind) {
                    case 'notfound':
                      return 'Repository not found.'
                    case 'ratelimit':
                      return `GitHub API rate limit exceeded. ${err.retryAfter ? `Try again in ${err.retryAfter}s.` : 'Try again later.'}`
                    case 'unauthorized':
                      return 'Authentication required.'
                    case 'forbidden':
                      return 'Access denied.'
                    case 'network':
                      return `Network error: ${err.message}`
                    case 'server':
                      return `Server error (${err.status}): ${err.message}`
                    default:
                      return 'An error occurred.'
                  }
                }),
              ),
            ]),
          ],
          code: () => [
            ...breadcrumb(route, send),
            ...fileTree(routeSig, send),
            ...readmeView(routeSig),
          ],
          file: () => [...breadcrumb(route, send), ...codeView(routeSig)],
          issues: () => issuesList(routeSig),
        },
      ),
    ]),
  ]
}

function breadcrumb(currentRoute: Route, send: Send<Msg>): Node[] {
  const route = currentRoute
  if (route.page !== 'tree') return []
  const { owner, name, path } = route
  if (!path) return []

  const parts = path.split('/')
  const crumbs: Node[] = [
    routing.link(send, { page: 'repo', owner, name, tab: 'code', data: { type: 'loading' } }, {}, [
      text(name),
    ]),
  ]

  for (let i = 0; i < parts.length; i++) {
    const partial = parts.slice(0, i + 1).join('/')
    const isLast = i === parts.length - 1
    crumbs.push(span([text(' / ')]))
    if (isLast) {
      crumbs.push(span([text(parts[i]!)]))
    } else {
      crumbs.push(
        routing.link(
          send,
          { page: 'tree', owner, name, path: partial, data: { type: 'loading' } },
          {},
          [text(parts[i]!)],
        ),
      )
    }
  }

  return [div({ class: 'breadcrumb' }, crumbs)]
}

function fileTree(routeSig: Signal<Route>, send: Send<Msg>): Node[] {
  return [
    div({ class: 'file-tree' }, [
      each(
        routeSig.map((r) => {
          let tree: TreeEntry[] = []
          if (r.page === 'repo' && r.tab === 'code' && r.data.type === 'success')
            tree = r.data.data.tree
          else if (r.page === 'tree' && r.data.type === 'success' && 'tree' in r.data.data)
            tree = r.data.data.tree
          // Sort: directories first, then alphabetical
          return [...tree].sort((a, b) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
            return a.name.localeCompare(b.name)
          })
        }),
        {
          key: (e) => e.sha,
          render: (item) => {
            const isDir = item.peek().type === 'dir'
            return [
              div({ class: 'file-row' }, [
                span({ class: 'icon' }, [text(isDir ? '📁' : '📄')]),
                a(
                  {
                    href: '#',
                    onClick: (e: Event) => {
                      e.preventDefault()
                      send({ type: 'openPath', path: item.peek().path, isDir })
                    },
                  },
                  [text(item.at('name'))],
                ),
                span([
                  text(item.map((e) => (e.type !== 'dir' && e.size ? formatSize(e.size) : ''))),
                ]),
              ]),
            ]
          },
        },
      ),
    ]),
  ]
}

function issuesList(routeSig: Signal<Route>): Node[] {
  return [
    show(
      routeSig.map(
        (r) =>
          r.page === 'repo' &&
          r.tab === 'issues' &&
          r.data.type === 'success' &&
          r.data.data.issues.length === 0,
      ),
      () => [div({ class: 'loading' }, [text('No open issues.')])],
    ),
    each(
      routeSig.map((r) => {
        if (r.page === 'repo' && r.tab === 'issues' && r.data.type === 'success')
          return r.data.data.issues
        return [] as Issue[]
      }),
      {
        key: (i) => i.id,
        render: (item) => [
          div({ class: 'issue-row' }, [
            h3([text(item.at('title'))]),
            div({ class: 'issue-meta' }, [
              text(
                item.map(
                  (i) =>
                    `#${i.number} opened by ${i.user.login} on ${new Date(i.created_at).toLocaleDateString()}`,
                ),
              ),
              text(item.map((i) => (i.comments > 0 ? ` · ${i.comments} comments` : ''))),
            ]),
            div({ class: 'labels' }, [
              each(
                item.map((i) => i.labels),
                {
                  key: (label) => label.name,
                  render: (label) => [
                    span(
                      {
                        class: 'label',
                        style: label.map((l) => {
                          const inverted = isLightColor(l.color) ? '#24292f' : '#fff'
                          return `background-color: #${l.color}; color: ${inverted}`
                        }),
                      },
                      [text(label.at('name'))],
                    ),
                  ],
                },
              ),
            ]),
          ]),
        ],
      },
    ),
  ]
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isLightColor(hex: string): boolean {
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 128
}
