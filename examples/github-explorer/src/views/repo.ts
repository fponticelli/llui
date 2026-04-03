import { div, h1, h3, a, p, pre, code, span, text, each, branch, show, peek } from '@llui/dom'
import type { State, Msg, Repo, TreeEntry, Issue } from '../types'
import type { Send } from '@llui/dom'
import { routing } from '../router'

function repoFromState(s: State): Repo | null {
  const r = s.route
  if (r.page === 'repo' && r.data.type === 'success') return r.data.data.repo
  if (r.page === 'tree' && r.data.type === 'success') return r.data.data.repo
  return null
}

/** Extract owner/name from route — always available (from URL, not API) */
function routeOwnerName(s: State): { owner: string; name: string } | null {
  const r = s.route
  if (r.page === 'repo') return { owner: r.owner, name: r.name }
  if (r.page === 'tree') return { owner: r.owner, name: r.name }
  return null
}

export function repoPage(s: State, send: Send<Msg>): Node[] {
  // owner/name from route (always available)
  const rp = routeOwnerName(s)
  const owner = rp?.owner ?? ''
  const name = rp?.name ?? ''

  return [
    div({ class: 'repo-header' }, [
      div({ class: 'container' }, [
        h1({}, [
          text((s: State) => routeOwnerName(s)?.owner ?? ''),
          text(' / '),
          routing.link(send, { page: 'repo', owner, name, tab: 'code', data: { type: 'loading' } }, {},
            [text((s: State) => routeOwnerName(s)?.name ?? '')]),
        ]),
        div({ class: 'stats' }, [
          span({}, [text((s: State) => `★ ${repoFromState(s)?.stargazers_count?.toLocaleString() ?? '—'}`)]),
          span({}, [text((s: State) => `🍴 ${repoFromState(s)?.forks_count?.toLocaleString() ?? '—'}`)]),
          span({}, [text((s: State) => `Issues: ${repoFromState(s)?.open_issues_count ?? '—'}`)]),
        ]),
        ...show<State, Msg>({
          when: (s) => !!repoFromState(s)?.description,
          render: () => [p({}, [text((s: State) => repoFromState(s)?.description ?? '')])],
        }),
      ]),
    ]),
    // Tab nav
    div({ class: 'tab-nav' }, [
      div({ class: 'container' }, [
        routing.link(
          send,
          { page: 'repo', owner, name, tab: 'code', data: { type: 'loading' } },
          { class: (s: State) => s.route.page !== 'repo' || s.route.tab === 'code' ? 'active' : '' },
          [text('Code')],
        ),
        routing.link(
          send,
          { page: 'repo', owner, name, tab: 'issues', data: { type: 'loading' } },
          { class: (s: State) => s.route.page === 'repo' && s.route.tab === 'issues' ? 'active' : '' },
          [text('Issues')],
        ),
      ]),
    ]),
    // Content
    div({ class: 'container' }, [
      ...branch<State, Msg>({
        on: (s) => {
          const r = s.route
          if (r.data.type === 'loading') return 'loading'
          if (r.data.type === 'failure') return 'error'
          if (r.page === 'repo' && r.tab === 'issues') return 'issues'
          if (r.page === 'tree' && r.data.type === 'success' && 'file' in r.data.data) return 'file'
          return 'code'
        },
        cases: {
          loading: () => [div({ class: 'loading' }, [text('Loading...')])],
          error: () => [div({ class: 'error' }, [
            text((s: State) => {
              if (s.route.data.type !== 'failure') return ''
              const err = s.route.data.error
              switch (err.kind) {
                case 'notfound': return 'Repository not found.'
                case 'ratelimit': return `GitHub API rate limit exceeded. ${err.retryAfter ? `Try again in ${err.retryAfter}s.` : 'Try again later.'}`
                case 'unauthorized': return 'Authentication required.'
                case 'forbidden': return 'Access denied.'
                case 'network': return `Network error: ${err.message}`
                case 'server': return `Server error (${err.status}): ${err.message}`
                default: return 'An error occurred.'
              }
            }),
          ])],
          code: (s, send) => [
            ...breadcrumb(s, send),
            ...fileTree(send),
            ...readmeSection(),
          ],
          file: (s, send) => [
            ...breadcrumb(s, send),
            ...fileView(),
          ],
          issues: () => issuesList(),
        },
      }),
    ]),
  ]
}

function breadcrumb(s: State, send: Send<Msg>): Node[] {
  const route = s.route
  if (route.page !== 'tree') return []
  const { owner, name, path } = route
  if (!path) return []

  const parts = path.split('/')
  const crumbs: Node[] = [
    routing.link(
      send,
      { page: 'repo', owner, name, tab: 'code', data: { type: 'loading' } },
      {},
      [text(name)],
    ),
  ]

  for (let i = 0; i < parts.length; i++) {
    const partial = parts.slice(0, i + 1).join('/')
    const isLast = i === parts.length - 1
    crumbs.push(span({}, [text(' / ')]))
    if (isLast) {
      crumbs.push(span({}, [text(parts[i]!)]))
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

function fileTree(send: Send<Msg>): Node[] {
  return [
    div({ class: 'file-tree' }, [
      ...each<State, TreeEntry, Msg>({
        items: (s) => {
          const r = s.route
          let tree: TreeEntry[] = []
          if (r.page === 'repo' && r.tab === 'code' && r.data.type === 'success') tree = r.data.data.tree
          else if (r.page === 'tree' && r.data.type === 'success' && 'tree' in r.data.data) tree = r.data.data.tree
          // Sort: directories first, then alphabetical
          return [...tree].sort((a, b) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
            return a.name.localeCompare(b.name)
          })
        },
        key: (e) => e.sha,
        render: ({ item, send }) => {
          const isDir = item((e) => e.type)() === 'dir'
          return [
            div({ class: 'file-row' }, [
              span({ class: 'icon' }, [text(isDir ? '📁' : '📄')]),
              a({
                href: '#',
                onClick: (e: Event) => {
                  e.preventDefault()
                  send({ type: 'openPath', path: peek(item, (e) => e.path), isDir })
                },
              }, [text(item((e) => e.name))]),
              ...(!isDir
                ? [span({}, [text(item((e) => e.size ? formatSize(e.size) : ''))])]
                : []),
            ]),
          ]
        },
      }),
    ]),
  ]
}

function fileView(): Node[] {
  return [
    div({ class: 'file-view' }, [
      div({ class: 'file-header' }, [
        span({}, [text((s: State) => {
          const r = s.route
          if (r.page === 'tree' && r.data.type === 'success' && 'file' in r.data.data) return r.data.data.file.name
          return ''
        })]),
        span({}, [text((s: State) => {
          const r = s.route
          if (r.page === 'tree' && r.data.type === 'success' && 'file' in r.data.data) return formatSize(r.data.data.file.size)
          return ''
        })]),
      ]),
      pre({}, [
        code({}, [
          text((s: State) => {
            const r = s.route
            if (r.page !== 'tree' || r.data.type !== 'success' || !('file' in r.data.data)) return ''
            try { return atob(r.data.data.file.content) } catch { return r.data.data.file.content }
          }),
        ]),
      ]),
    ]),
  ]
}

function readmeSection(): Node[] {
  return show<State, Msg>({
    when: (s) => s.route.page === 'repo' && s.route.tab === 'code' && s.route.data.type === 'success' && s.route.data.data.readme.length > 0,
    render: () => [
      div({ class: 'readme' }, [
        div({ innerHTML: (s: State) => {
          const r = s.route
          if (r.page === 'repo' && r.tab === 'code' && r.data.type === 'success') return r.data.data.readme
          return ''
        } }),
      ]),
    ],
  })
}

function issuesList(): Node[] {
  return [
    ...show<State, Msg>({
      when: (s) => s.route.page === 'repo' && s.route.tab === 'issues' && s.route.data.type === 'success' && s.route.data.data.issues.length === 0,
      render: () => [div({ class: 'loading' }, [text('No open issues.')])],
    }),
    ...each<State, Issue, Msg>({
      items: (s) => {
        const r = s.route
        if (r.page === 'repo' && r.tab === 'issues' && r.data.type === 'success') return r.data.data.issues
        return []
      },
      key: (i) => i.id,
      render: ({ item }) => [
        div({ class: 'issue-row' }, [
          h3({}, [text(item((i) => i.title))]),
          div({ class: 'issue-meta' }, [
            text(item((i) => `#${i.number} opened by ${i.user.login} on ${new Date(i.created_at).toLocaleDateString()}`)),
            text(item((i) => i.comments > 0 ? ` · ${i.comments} comments` : '')),
          ]),
          ...labelSpans(item),
        ]),
      ],
    }),
  ]
}

function labelSpans(item: <R>(sel: (i: Issue) => R) => () => R): Node[] {
  const labels = item((i) => i.labels)()
  return labels.map((label) =>
    span({
      class: 'label',
      style: `background-color: #${label.color}; color: ${isLightColor(label.color) ? '#24292f' : '#fff'}`,
    }, [text(label.name)]),
  )
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
