import { div, h1, h3, a, p, span, text, each, branch, show, peek } from '@llui/dom'
import type { State, Msg, TreeEntry, Issue } from '../types'
import type { Send } from '@llui/dom'

export function repoPage(_s: State, send: Send<Msg>): Node[] {
  return [
    // Repo header
    div({ class: 'repo-header' }, [
      div({ class: 'container' }, [
        h1({}, [
          a({
            href: (s: State) => `#/${s.repo?.owner?.login ?? ''}`,
          }, [text((s: State) => s.repo?.owner?.login ?? '')]),
          text(' / '),
          a({
            href: (s: State) => `#/${s.repo?.owner?.login ?? ''}/${s.repo?.name ?? ''}`,
          }, [text((s: State) => s.repo?.name ?? '')]),
        ]),
        div({ class: 'stats' }, [
          span({}, [text((s: State) => `★ ${s.repo?.stargazers_count?.toLocaleString() ?? '0'}`)]),
          span({}, [text((s: State) => `🍴 ${s.repo?.forks_count?.toLocaleString() ?? '0'}`)]),
          span({}, [text((s: State) => `Issues: ${s.repo?.open_issues_count ?? 0}`)]),
        ]),
        ...show<State, Msg>({
          when: (s) => s.repo?.description !== null && s.repo?.description !== undefined,
          render: () => [p({}, [text((s: State) => s.repo?.description ?? '')])],
        }),
      ]),
    ]),
    // Tab nav
    div({ class: 'tab-nav' }, [
      div({ class: 'container' }, [
        a({
          class: (s: State) => s.route.page === 'repo' && s.route.tab === 'code' ? 'active' : '',
          href: (s: State) => `#/${s.repo?.owner?.login ?? ''}/${s.repo?.name ?? ''}`,
        }, [text('Code')]),
        a({
          class: (s: State) => s.route.page === 'repo' && s.route.tab === 'issues' ? 'active' : '',
          href: (s: State) => `#/${s.repo?.owner?.login ?? ''}/${s.repo?.name ?? ''}/issues`,
        }, [text('Issues')]),
      ]),
    ]),
    // Content
    div({ class: 'container' }, [
      ...branch<State, Msg>({
        on: (s) => {
          if (s.loading) return 'loading'
          if (s.route.page === 'repo' && s.route.tab === 'issues') return 'issues'
          return 'code'
        },
        cases: {
          loading: () => [div({ class: 'loading' }, [text('Loading...')])],
          code: () => [
            ...fileTree(send),
            ...readmeSection(),
          ],
          issues: (_s, send) => issuesList(send),
        },
      }),
    ]),
  ]
}

function fileTree(send: Send<Msg>): Node[] {
  return [
    div({ class: 'file-tree' }, [
      ...each<State, TreeEntry, Msg>({
        items: (s) => s.tree,
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

function readmeSection(): Node[] {
  return show<State, Msg>({
    when: (s) => s.readme.length > 0,
    render: () => [
      div({ class: 'readme' }, [
        div({ innerHTML: (s: State) => s.readme }),
      ]),
    ],
  })
}

function issuesList(send: Send<Msg>): Node[] {
  return [
    ...each<State, Issue, Msg>({
      items: (s) => s.issues,
      key: (i) => i.id,
      render: ({ item }) => [
        div({ class: 'issue-row' }, [
          h3({}, [
            text(item((i) => i.title)),
          ]),
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
  // Labels are rendered statically from the item at build time
  // This is fine because each() rebuilds entries when items change
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
