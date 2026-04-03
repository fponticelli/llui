import { div, h1, h3, a, p, pre, code, span, text, each, branch, show, peek } from '@llui/dom'
import type { State, Msg, TreeEntry, Issue } from '../types'
import type { Send } from '@llui/dom'

function repoFromState(s: State) {
  const ps = s.pageState
  return ps.page === 'repo' || ps.page === 'tree' ? ps.repo : null
}

export function repoPage(_s: State, send: Send<Msg>): Node[] {
  return [
    // Repo header
    div({ class: 'repo-header' }, [
      div({ class: 'container' }, [
        h1({}, [
          text((s: State) => repoFromState(s)?.owner?.login ?? ''),
          text(' / '),
          a({
            href: (s: State) => {
              const r = repoFromState(s)
              return r ? `#/${r.owner.login}/${r.name}` : '#/'
            },
          }, [text((s: State) => repoFromState(s)?.name ?? '')]),
        ]),
        div({ class: 'stats' }, [
          span({}, [text((s: State) => `★ ${repoFromState(s)?.stargazers_count?.toLocaleString() ?? '0'}`)]),
          span({}, [text((s: State) => `🍴 ${repoFromState(s)?.forks_count?.toLocaleString() ?? '0'}`)]),
          span({}, [text((s: State) => `Issues: ${repoFromState(s)?.open_issues_count ?? 0}`)]),
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
        a({
          class: (s: State) => s.route.page !== 'repo' || s.route.tab === 'code' ? 'active' : '',
          href: (s: State) => {
            const r = repoFromState(s)
            return r ? `#/${r.owner.login}/${r.name}` : '#/'
          },
        }, [text('Code')]),
        a({
          class: (s: State) => s.route.page === 'repo' && s.route.tab === 'issues' ? 'active' : '',
          href: (s: State) => {
            const r = repoFromState(s)
            return r ? `#/${r.owner.login}/${r.name}/issues` : '#/'
          },
        }, [text('Issues')]),
      ]),
    ]),
    // Content
    div({ class: 'container' }, [
      ...branch<State, Msg>({
        on: (s) => {
          if (s.loading) return 'loading'
          if (s.pageState.page === 'repo' && s.pageState.tab === 'issues') return 'issues'
          if (s.pageState.page === 'tree' && s.pageState.file) return 'file'
          return 'code'
        },
        cases: {
          loading: () => [div({ class: 'loading' }, [text('Loading...')])],
          code: (s, send) => [
            ...breadcrumb(s, send),
            ...fileTree(send),
            ...readmeSection(),
          ],
          file: (s, send) => [
            ...breadcrumb(s, send),
            ...fileView(),
          ],
          issues: (_s, _send) => issuesList(),
        },
      }),
    ]),
  ]
}

// ── Breadcrumb ───────────────────────────────────────────────────

function breadcrumb(s: State, send: Send<Msg>): Node[] {
  const route = s.route
  if (route.page !== 'tree') return []
  const { owner, name, path } = route
  if (!path) return []

  const parts = path.split('/')
  const crumbs: HTMLElement[] = [
    a({
      href: `#/${owner}/${name}`,
      onClick: (e: Event) => {
        e.preventDefault()
        send({ type: 'navigate', route: { page: 'repo', owner, name, tab: 'code' } })
      },
    }, [text(name)]),
  ]

  for (let i = 0; i < parts.length; i++) {
    const partial = parts.slice(0, i + 1).join('/')
    const isLast = i === parts.length - 1
    crumbs.push(span({}, [text(' / ')]))
    if (isLast) {
      crumbs.push(span({}, [text(parts[i]!)]))
    } else {
      crumbs.push(
        a({
          href: `#/${owner}/${name}/tree/${partial}`,
          onClick: (e: Event) => {
            e.preventDefault()
            send({ type: 'navigate', route: { page: 'tree', owner, name, path: partial } })
          },
        }, [text(parts[i]!)]),
      )
    }
  }

  return [div({ class: 'breadcrumb' }, crumbs)]
}

// ── File Tree ────────────────────────────────────────────────────

function fileTree(send: Send<Msg>): Node[] {
  return [
    div({ class: 'file-tree' }, [
      ...each<State, TreeEntry, Msg>({
        items: (s) => s.pageState.page === 'repo' || s.pageState.page === 'tree' ? s.pageState.tree : [],
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

// ── File View ────────────────────────────────────────────────────

function fileView(): Node[] {
  return [
    div({ class: 'file-view' }, [
      div({ class: 'file-header' }, [
        span({}, [text((s: State) => s.pageState.page === 'tree' && s.pageState.file ? s.pageState.file.name : '')]),
        span({}, [text((s: State) => s.pageState.page === 'tree' && s.pageState.file ? formatSize(s.pageState.file.size) : '')]),
      ]),
      pre({}, [
        code({}, [
          text((s: State) => {
            if (s.pageState.page !== 'tree' || !s.pageState.file) return ''
            try { return atob(s.pageState.file.content) } catch { return s.pageState.file.content }
          }),
        ]),
      ]),
    ]),
  ]
}

// ── README ───────────────────────────────────────────────────────

function readmeSection(): Node[] {
  return show<State, Msg>({
    when: (s) => s.pageState.page === 'repo' && s.pageState.readme.length > 0,
    render: () => [
      div({ class: 'readme' }, [
        div({ innerHTML: (s: State) => s.pageState.page === 'repo' ? s.pageState.readme : '' }),
      ]),
    ],
  })
}

// ── Issues ───────────────────────────────────────────────────────

function issuesList(): Node[] {
  return [
    ...each<State, Issue, Msg>({
      items: (s) => s.pageState.page === 'repo' ? s.pageState.issues : [],
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

// ── Utilities ────────────────────────────────────────────────────

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
