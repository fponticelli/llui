import { div, h1, h3, a, p, span, text, show, branch, each } from '@llui/dom'
import type { State, Msg, Page, Repo, TreeEntry, Issue } from '../types'
import type { Send, Signal, Renderable, Mountable } from '@llui/dom'
import { routing } from '../router'
import { readmeView } from './foreign-readme'
import { codeView } from './foreign-code'

function repoFromPage(page: Page): Repo | null {
  if (page.page === 'repo' && page.data.type === 'success') return page.data.data.repo
  if (page.page === 'tree' && page.data.type === 'success') return page.data.data.repo
  return null
}

/** Extract owner/name from the page — always available (from URL, not API). */
function pageOwnerName(page: Page): { owner: string; name: string } | null {
  if (page.page === 'repo') return { owner: page.owner, name: page.name }
  if (page.page === 'tree') return { owner: page.owner, name: page.name }
  return null
}

// routing.link needs literal owner/name for href. The Page is read from
// location.pathname at branch-render time — the URL is current because
// routing.handleEffect pushes state before the navigate message resolves.
export function repoPage(pageSignal: Signal<Page>, page: Page, send: Send<Msg>): Renderable {
  // owner/name from the current page (literal values for routing.link hrefs)
  const owner = 'owner' in page ? page.owner : ''
  const name = 'name' in page ? page.name : ''

  return [
    div({ class: 'repo-header' }, [
      div({ class: 'container' }, [
        h1([
          text(pageSignal.map((page) => pageOwnerName(page)?.owner ?? '')),
          text(' / '),
          routing.link(send, 'repoCode', { owner, repo: name }, {}, [
            text(pageSignal.map((page) => pageOwnerName(page)?.name ?? '')),
          ]),
        ]),
        div({ class: 'stats' }, [
          span([
            text(
              pageSignal.map(
                (page) => `★ ${repoFromPage(page)?.stargazers_count?.toLocaleString() ?? '—'}`,
              ),
            ),
          ]),
          span([
            text(
              pageSignal.map(
                (page) => `🍴 ${repoFromPage(page)?.forks_count?.toLocaleString() ?? '—'}`,
              ),
            ),
          ]),
          span([
            text(
              pageSignal.map((page) => `Issues: ${repoFromPage(page)?.open_issues_count ?? '—'}`),
            ),
          ]),
        ]),
        show(
          pageSignal.map((page) => !!repoFromPage(page)?.description),
          () => [p([text(pageSignal.map((page) => repoFromPage(page)?.description ?? ''))])],
        ),
      ]),
    ]),
    // Tab nav
    div({ class: 'tab-nav' }, [
      div({ class: 'container' }, [
        routing.link(
          send,
          'repoCode',
          { owner, repo: name },
          {
            class: pageSignal.map((page) =>
              page.page !== 'repo' || page.tab === 'code' ? 'active' : '',
            ),
          },
          [text('Code')],
        ),
        routing.link(
          send,
          'repoIssues',
          { owner, repo: name },
          {
            class: pageSignal.map((page) =>
              page.page === 'repo' && page.tab === 'issues' ? 'active' : '',
            ),
          },
          [text('Issues')],
        ),
      ]),
    ]),
    // Content
    div({ class: 'container' }, [
      branch(
        pageSignal.map((page) => {
          if (page.data.type === 'loading') return 'loading'
          if (page.data.type === 'failure') return 'error'
          if (page.page === 'repo' && page.tab === 'issues') return 'issues'
          if (page.page === 'tree' && page.data.type === 'success' && 'file' in page.data.data)
            return 'file'
          return 'code'
        }),
        {
          loading: () => [div({ class: 'loading' }, [text('Loading...')])],
          error: () => [
            div({ class: 'error' }, [
              text(
                pageSignal.map((page) => {
                  if (page.data.type !== 'failure') return ''
                  const err = page.data.error
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
            ...breadcrumb(page, send),
            ...fileTree(pageSignal, send),
            ...readmeView(pageSignal),
          ],
          file: () => [...breadcrumb(page, send), ...codeView(pageSignal)],
          issues: () => issuesList(pageSignal),
        },
      ),
    ]),
  ]
}

function breadcrumb(page: Page, send: Send<Msg>): Renderable {
  if (page.page !== 'tree') return []
  const { owner, name, path } = page
  if (!path) return []

  const parts = path.split('/')
  const crumbs: Mountable[] = [
    routing.link(send, 'repoCode', { owner, repo: name }, {}, [text(name)]),
  ]

  for (let i = 0; i < parts.length; i++) {
    const partial = parts.slice(0, i + 1).join('/')
    const isLast = i === parts.length - 1
    crumbs.push(span([text(' / ')]))
    if (isLast) {
      crumbs.push(span([text(parts[i]!)]))
    } else {
      crumbs.push(
        routing.link(send, 'tree', { owner, repo: name, path: partial.split('/') }, {}, [
          text(parts[i]!),
        ]),
      )
    }
  }

  return [div({ class: 'breadcrumb' }, crumbs)]
}

function fileTree(pageSignal: Signal<Page>, send: Send<Msg>): Renderable {
  return [
    div({ class: 'file-tree' }, [
      each(
        pageSignal.map((r) => {
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

function issuesList(pageSignal: Signal<Page>): Renderable {
  return [
    show(
      pageSignal.map(
        (r) =>
          r.page === 'repo' &&
          r.tab === 'issues' &&
          r.data.type === 'success' &&
          r.data.data.issues.length === 0,
      ),
      () => [div({ class: 'loading' }, [text('No open issues.')])],
    ),
    each(
      pageSignal.map((r) => {
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
              each(item.at('labels'), {
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
              }),
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
