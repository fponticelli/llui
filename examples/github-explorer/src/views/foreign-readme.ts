import { foreign } from '@llui/dom'
import type { State, Msg } from '../types'

/**
 * README rendered via foreign() — the GitHub API returns pre-rendered HTML.
 * foreign() manages the container lifecycle: mount creates the shadow root,
 * sync updates innerHTML when content changes, destroy cleans up.
 *
 * This demonstrates the foreign() pattern for rendering raw HTML safely
 * inside a managed container with style isolation.
 */
export function readmeView(): Node[] {
  return foreign<State, Msg, { html: string }, { root: ShadowRoot }>({
    mount: ({ container }) => {
      // Use shadow DOM for style isolation — GitHub's rendered HTML
      // includes class names that could conflict with the app's CSS
      const root = container.attachShadow({ mode: 'open' })
      const style = document.createElement('style')
      style.textContent = readmeStyles()
      root.appendChild(style)
      const content = document.createElement('div')
      content.className = 'readme-body'
      root.appendChild(content)
      return { root }
    },
    props: (s) => {
      const r = s.route
      if (r.page === 'repo' && r.tab === 'code' && r.data.type === 'success') {
        return { html: r.data.data.readme }
      }
      return { html: '' }
    },
    sync: ({ instance, props }) => {
      const content = instance.root.querySelector('.readme-body')
      if (content) content.innerHTML = props.html
    },
    destroy: () => {
      // Shadow root is cleaned up with the container
    },
    container: { tag: 'div', attrs: { class: 'readme' } },
  })
}

function readmeStyles(): string {
  return `
    .readme-body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #24292f; }
    .readme-body h1 { font-size: 2em; border-bottom: 1px solid #d0d7de; padding-bottom: 8px; margin: 24px 0 16px; }
    .readme-body h2 { font-size: 1.5em; border-bottom: 1px solid #d0d7de; padding-bottom: 6px; margin: 24px 0 16px; }
    .readme-body h3 { font-size: 1.25em; margin: 24px 0 16px; }
    .readme-body p { margin-bottom: 16px; }
    .readme-body a { color: #0969da; text-decoration: none; }
    .readme-body a:hover { text-decoration: underline; }
    .readme-body code { background: #f6f8fa; padding: 2px 6px; border-radius: 4px; font-size: 85%; font-family: 'SFMono-Regular', Consolas, monospace; }
    .readme-body pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow-x: auto; margin-bottom: 16px; }
    .readme-body pre code { background: none; padding: 0; }
    .readme-body ul, .readme-body ol { padding-left: 2em; margin-bottom: 16px; }
    .readme-body li { margin-bottom: 4px; }
    .readme-body img { max-width: 100%; }
    .readme-body blockquote { padding: 0 1em; border-left: 3px solid #d0d7de; color: #57606a; margin: 0 0 16px; }
    .readme-body table { border-collapse: collapse; margin-bottom: 16px; }
    .readme-body td, .readme-body th { border: 1px solid #d0d7de; padding: 6px 13px; }
    .readme-body th { background: #f6f8fa; font-weight: 600; }
  `
}
