import { div, h3, p, span, ul, li, text, button, each, branch, peek } from '@llui/dom'
import type { State, Msg, Repo } from '../types'
import type { Send } from '@llui/dom'
import { routing } from '../router'

const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572A5', Rust: '#dea584',
  Go: '#00ADD8', Java: '#b07219', Ruby: '#701516', C: '#555555', 'C++': '#f34b7d',
  'C#': '#178600', PHP: '#4F5D95', Swift: '#F05138', Kotlin: '#A97BFF', Dart: '#00B4AB',
  HTML: '#e34c26', CSS: '#563d7c', Shell: '#89e051', Lua: '#000080', Zig: '#ec915c',
}

function searchRepos(s: State): Repo[] {
  const r = s.route
  if (r.page !== 'search') return []
  if (r.data.type === 'success') return r.data.data.repos
  if (r.data.type === 'loading' && r.data.stale) return r.data.stale.repos
  return []
}

function searchTotal(s: State): number {
  const r = s.route
  if (r.page !== 'search') return 0
  if (r.data.type === 'success') return r.data.data.total
  if (r.data.type === 'loading' && r.data.stale) return r.data.stale.total
  return 0
}

function currentPage(s: State): number {
  return s.route.page === 'search' ? s.route.p : 1
}

export function searchView(_s: State, send: Send<Msg>): Node[] {
  return [
    div({ class: 'container' }, [
      // Error
      ...branch<State, Msg>({
        on: (s) => s.route.page === 'search' && s.route.data.type === 'failure' ? 'error' : 'ok',
        cases: {
          error: () => [div({ class: 'error' }, [
            text((s: State) => {
              const r = s.route
              if (r.page !== 'search' || r.data.type !== 'failure') return ''
              const err = r.data.error
              if (err.kind === 'ratelimit') return `GitHub API rate limit exceeded. ${err.retryAfter ? `Try again in ${err.retryAfter}s.` : 'Try again later.'}`
              if (err.kind === 'network') return `Network error: ${err.message}`
              return `Error: ${err.kind}`
            }),
          ])],
          ok: () => [],
        },
      }),
      // Content
      ...branch<State, Msg>({
        on: (s) => {
          const r = s.route
          if (r.page !== 'search') return 'welcome'
          if (r.data.type === 'idle') return 'welcome'
          if (r.data.type === 'loading' && !r.data.stale) return 'loading'
          const repos = searchRepos(s)
          if (repos.length === 0) return r.q ? 'empty' : 'welcome'
          return 'results'
        },
        cases: {
          welcome: () => [div({ class: 'loading' }, [text('Search for GitHub repositories to get started.')])],
          loading: () => [div({ class: 'loading' }, [text('Searching...')])],
          empty: () => [div({ class: 'loading' }, [text('No repositories found.')])],
          results: (_s, send) => [
            ul({ class: 'repo-list' }, [
              ...each<State, Repo, Msg>({
                items: (s) => searchRepos(s),
                key: (r) => r.id,
                render: ({ item, send }) => [repoItem(item, send)],
              }),
            ]),
            div({ class: 'pagination' }, [
              button({
                disabled: (s: State) => currentPage(s) <= 1,
                onClick: () => send({ type: 'prevPage' }),
              }, [text('← Previous')]),
              text((s: State) => {
                const total = searchTotal(s)
                if (total <= 10) return ''
                return ` Page ${currentPage(s)} of ${Math.ceil(total / 10)} `
              }),
              button({
                disabled: (s: State) => currentPage(s) * 10 >= searchTotal(s),
                onClick: () => send({ type: 'nextPage' }),
              }, [text('Next →')]),
            ]),
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
      routing.link(
        send,
        { page: 'repo', owner, name, tab: 'code', data: { type: 'loading' } },
        {},
        [text(item((r) => r.full_name))],
      ),
    ]),
    p({}, [text(item((r) => r.description ?? ''))]),
    div({ class: 'repo-meta' }, [
      ...(() => {
        const lang = item((r) => r.language)()
        if (!lang) return []
        return [span({}, [
          span({ class: 'lang-dot', style: `background-color: ${LANG_COLORS[lang] ?? '#ccc'}` }),
          text(item((r) => r.language ?? '')),
        ])]
      })(),
      span({}, [text(item((r) => `★ ${r.stargazers_count.toLocaleString()}`))]),
      span({}, [text(item((r) => `🍴 ${r.forks_count.toLocaleString()}`))]),
      span({}, [text(item((r) => `Updated ${new Date(r.updated_at).toLocaleDateString()}`))]),
    ]),
  ])
}
