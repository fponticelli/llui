import { div, h3, p, span, ul, li, text, button, each, branch, show } from '@llui/dom'
import type { Msg, Repo, Page } from '../types'
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

function searchRepos(page: Page): Repo[] {
  if (page.page !== 'search') return []
  if (page.data.type === 'success') return page.data.data.repos
  if (page.data.type === 'loading' && page.data.stale) return page.data.stale.repos
  return []
}

function searchTotal(page: Page): number {
  if (page.page !== 'search') return 0
  if (page.data.type === 'success') return page.data.data.total
  if (page.data.type === 'loading' && page.data.stale) return page.data.stale.total
  return 0
}

function currentPage(page: Page): number {
  return page.page === 'search' ? page.p : 1
}

export function searchView(pageSignal: Signal<Page>, send: Send<Msg>): Renderable {
  return [
    div({ class: 'container' }, [
      // Error
      branch(
        pageSignal.map((page) =>
          page.page === 'search' && page.data.type === 'failure' ? 'error' : 'ok',
        ),
        {
          error: () => [
            div({ class: 'error' }, [
              text(
                pageSignal.map((page) => {
                  if (page.page !== 'search' || page.data.type !== 'failure') return ''
                  const err = page.data.error
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
        pageSignal.map((page) => {
          if (page.page !== 'search') return 'welcome'
          if (page.data.type === 'idle') return 'welcome'
          if (page.data.type === 'loading' && !page.data.stale) return 'loading'
          const repos = searchRepos(page)
          if (repos.length === 0) return page.q ? 'empty' : 'welcome'
          return 'results'
        }),
        {
          welcome: () => [
            div({ class: 'loading' }, [text('Search for GitHub repositories to get started.')]),
          ],
          loading: () => [div({ class: 'loading' }, [text('Searching...')])],
          empty: () => [div({ class: 'loading' }, [text('No repositories found.')])],
          results: () => [
            ul({ class: 'repo-list' }, [
              each(
                pageSignal.map((page) => searchRepos(page)),
                {
                  key: (r) => r.id,
                  render: (item) => [repoItem(item, send)],
                },
              ),
            ]),
            div({ class: 'pagination' }, [
              button(
                {
                  disabled: pageSignal.map((page) => currentPage(page) <= 1),
                  onClick: () => send({ type: 'prevPage' }),
                },
                [text('← Previous')],
              ),
              text(
                pageSignal.map((page) => {
                  const total = searchTotal(page)
                  if (total <= 10) return ''
                  return ` Page ${currentPage(page)} of ${Math.ceil(total / 10)} `
                }),
              ),
              button(
                {
                  disabled: pageSignal.map((page) => currentPage(page) * 10 >= searchTotal(page)),
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
    h3([routing.link(send, 'repoCode', { owner, repo: name }, {}, [text(item.at('full_name'))])]),
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
