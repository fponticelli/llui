import { div, h3, p, a, span, ul, li, text, button, each, branch, show } from '@llui/dom'
import type { State, Msg, Repo } from '../types'
import type { Send } from '@llui/dom'

const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572A5', Rust: '#dea584',
  Go: '#00ADD8', Java: '#b07219', Ruby: '#701516', C: '#555555', 'C++': '#f34b7d',
  'C#': '#178600', PHP: '#4F5D95', Swift: '#F05138', Kotlin: '#A97BFF', Dart: '#00B4AB',
  HTML: '#e34c26', CSS: '#563d7c', Shell: '#89e051', Lua: '#000080', Zig: '#ec915c',
  Elm: '#60B5CC', Haskell: '#5e5086', Scala: '#c22d40', Elixir: '#6e4a7e',
}

export function searchPage(_s: State, send: Send<Msg>): Node[] {
  return [
    div({ class: 'container' }, [
      ...errorBox(),
      ...branch<State, Msg>({
        on: (s) => s.loading ? 'loading' : s.repos.length > 0 ? 'results' : s.route.page === 'search' && s.route.q ? 'empty' : 'welcome',
        cases: {
          loading: () => [div({ class: 'loading' }, [text('Searching...')])],
          empty: () => [div({ class: 'loading' }, [text('No repositories found.')])],
          welcome: () => [div({ class: 'loading' }, [text('Search for GitHub repositories to get started.')])],
          results: (_s, send) => [
            ul({ class: 'repo-list' }, [
              ...each<State, Repo, Msg>({
                items: (s) => s.repos,
                key: (r) => r.id,
                render: ({ item, send }) => [repoItem(item, send)],
              }),
            ]),
            ...pagination(send),
          ],
        },
      }),
    ]),
  ]
}

function repoItem(
  item: <R>(sel: (r: Repo) => R) => () => R,
  send: Send<Msg>,
): HTMLElement {
  const owner = item((r) => r.owner.login)()
  const name = item((r) => r.name)()
  return li({ class: 'repo-item' }, [
    h3({}, [
      a({
        href: `#/${owner}/${name}`,
        onClick: (e: Event) => {
          e.preventDefault()
          send({ type: 'navigate', route: { page: 'repo', owner, name, tab: 'code' } })
        },
      }, [
        text(item((r) => r.full_name)),
      ]),
    ]),
    p({}, [text(item((r) => r.description ?? ''))]),
    div({ class: 'repo-meta' }, [
      ...show<State, Msg>({
        when: () => item((r) => r.language)() !== null,
        render: () => [
          span({}, [
            span({ class: 'lang-dot', style: `background-color: ${LANG_COLORS[item((r) => r.language)()!] ?? '#ccc'}` }),
            text(item((r) => r.language ?? '')),
          ]),
        ],
      }),
      span({}, [text(item((r) => `★ ${r.stargazers_count.toLocaleString()}`))]),
      span({}, [text(item((r) => `🍴 ${r.forks_count.toLocaleString()}`))]),
      span({}, [text(item((r) => `Updated ${new Date(r.updated_at).toLocaleDateString()}`))]),
    ]),
  ])
}

function errorBox(): Node[] {
  return show<State, Msg>({
    when: (s) => s.error !== null,
    render: () => [div({ class: 'error' }, [text((s: State) => s.error ?? '')])],
  })
}

function pagination(send: Send<Msg>): Node[] {
  return show<State, Msg>({
    when: (s) => s.searchTotal > 10,
    render: (s) => [
      div({ class: 'pagination' }, [
        button({
          disabled: (s: State) => s.searchPage === 0,
          onClick: () => send({ type: 'prevPage' }),
        }, [text('← Previous')]),
        text((s: State) => `Page ${s.searchPage + 1} of ${Math.ceil(s.searchTotal / 10)}`),
        button({
          disabled: (s: State) => (s.searchPage + 1) * 10 >= s.searchTotal,
          onClick: () => send({ type: 'nextPage' }),
        }, [text('Next →')]),
      ]),
    ],
  })
}
