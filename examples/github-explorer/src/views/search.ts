import { div, h3, p, span, ul, li, text, button, each, branch, show } from '@llui/dom'
import type { Msg, Repo, Route } from '../types'
import type { Send, Signal, Mountable, Renderable } from '@llui/dom'
import { routing } from '../router'

const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Rust: '#dea584',
  Go: '#00ADD8',
  Java: '#b07219',
  Ruby: '#701516',
  C: '#555555',
  'C++': '#f34b7d',
  'C#': '#178600',
  PHP: '#4F5D95',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Dart: '#00B4AB',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Shell: '#89e051',
  Lua: '#000080',
  Zig: '#ec915c',
}

function searchRepos(r: Route): Repo[] {
  if (r.page !== 'search') return []
  if (r.data.type === 'success') return r.data.data.repos
  if (r.data.type === 'loading' && r.data.stale) return r.data.stale.repos
  return []
}

function searchTotal(r: Route): number {
  if (r.page !== 'search') return 0
  if (r.data.type === 'success') return r.data.data.total
  if (r.data.type === 'loading' && r.data.stale) return r.data.stale.total
  return 0
}

function currentPage(r: Route): number {
  return r.page === 'search' ? r.p : 1
}

export function searchView(route: Signal<Route>, send: Send<Msg>): Renderable {
  return [
    div({ class: 'container' }, [
      // Error
      branch(
        route.map((r) => (r.page === 'search' && r.data.type === 'failure' ? 'error' : 'ok')),
        {
          error: () => [
            div({ class: 'error' }, [
              text(
                route.map((r) => {
                  if (r.page !== 'search' || r.data.type !== 'failure') return ''
                  const err = r.data.error
                  if (err.kind === 'ratelimit')
                    return `GitHub API rate limit exceeded. ${err.retryAfter ? `Try again in ${err.retryAfter}s.` : 'Try again later.'}`
                  if (err.kind === 'network') return `Network error: ${err.message}`
                  return `Error: ${err.kind}`
                }),
              ),
            ]),
          ],
          ok: () => [],
        },
      ),
      // Content
      branch(
        route.map((r) => {
          if (r.page !== 'search') return 'welcome'
          if (r.data.type === 'idle') return 'welcome'
          if (r.data.type === 'loading' && !r.data.stale) return 'loading'
          const repos = searchRepos(r)
          if (repos.length === 0) return r.q ? 'empty' : 'welcome'
          return 'results'
        }),
        {
          welcome: () => [
            div({ class: 'loading' }, [text('Search for GitHub repositories to get started.')]),
          ],
          loading: () => [div({ class: 'loading' }, [text('Searching...')])],
          empty: () => [div({ class: 'loading' }, [text('No repositories found.')])],
          results: () => [
            ul({ class: 'repo-list', 'data-agent': 'search-results' }, [
              each(
                route.map((r) => searchRepos(r)),
                {
                  key: (r) => r.id,
                  render: (item) => [repoItem(item, send)],
                },
              ),
            ]),
            div({ class: 'pagination' }, [
              button(
                {
                  'data-agent': 'prev-page',
                  disabled: route.map((r) => currentPage(r) <= 1),
                  onClick: () => send({ type: 'prevPage' }),
                },
                [text('← Previous')],
              ),
              text(
                route.map((r) => {
                  const total = searchTotal(r)
                  if (total <= 10) return ''
                  return ` Page ${currentPage(r)} of ${Math.ceil(total / 10)} `
                }),
              ),
              button(
                {
                  'data-agent': 'next-page',
                  disabled: route.map((r) => currentPage(r) * 10 >= searchTotal(r)),
                  onClick: () => send({ type: 'nextPage' }),
                },
                [text('Next →')],
              ),
            ]),
          ],
        },
      ),
    ]),
  ]
}

function repoItem(item: Signal<Repo>, send: Send<Msg>): Mountable {
  const owner = item.peek().owner.login
  const name = item.peek().name
  return li({ class: 'repo-item' }, [
    h3([
      routing.link(
        send,
        { page: 'repo', owner, name, tab: 'code', data: { type: 'loading' } },
        {},
        [text(item.at('full_name'))],
      ),
    ]),
    p([text(item.map((r) => r.description ?? ''))]),
    div({ class: 'repo-meta' }, [
      show(
        item.map((r) => Boolean(r.language)),
        () => {
          const lang = item.peek().language ?? ''
          return [
            span([
              span({
                class: 'lang-dot',
                style: `background-color: ${LANG_COLORS[lang] ?? '#ccc'}`,
              }),
              text(lang),
            ]),
          ]
        },
      ),
      span([text(item.map((r) => `★ ${r.stargazers_count.toLocaleString()}`))]),
      span([text(item.map((r) => `🍴 ${r.forks_count.toLocaleString()}`))]),
      span([text(item.map((r) => `Updated ${new Date(r.updated_at).toLocaleDateString()}`))]),
    ]),
  ])
}
