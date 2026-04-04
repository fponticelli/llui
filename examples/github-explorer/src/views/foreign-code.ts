import { foreign } from '@llui/dom'
import type { State, Msg } from '../types'

/**
 * Code viewer via foreign() — renders file content with line numbers
 * and manages its own DOM lifecycle.
 *
 * Demonstrates foreign() for imperative DOM manipulation that would
 * be awkward with declarative bindings (building a table of numbered
 * lines from a string that changes when navigating between files).
 */
export function codeView(): Node[] {
  return foreign<State, { content: string; filename: string }, { container: HTMLElement }>({
    mount: (container) => {
      container.className = 'code-viewer'
      return { container }
    },
    props: (s) => {
      const r = s.route
      if (r.page === 'tree' && r.data.type === 'success' && 'file' in r.data.data) {
        const file = r.data.data.file
        let content: string
        try {
          content = atob(file.content)
        } catch {
          content = file.content
        }
        return { content, filename: file.name }
      }
      return { content: '', filename: '' }
    },
    sync: (instance, { content, filename }) => {
      const el = instance.container
      el.innerHTML = ''

      if (!content) return

      // Header
      const header = document.createElement('div')
      header.className = 'code-header'
      header.textContent = filename
      el.appendChild(header)

      // Line-numbered code table
      const table = document.createElement('table')
      table.className = 'code-table'
      const lines = content.split('\n')

      for (let i = 0; i < lines.length; i++) {
        const tr = document.createElement('tr')

        const lineNum = document.createElement('td')
        lineNum.className = 'line-num'
        lineNum.textContent = String(i + 1)
        lineNum.setAttribute('data-line', String(i + 1))
        tr.appendChild(lineNum)

        const lineContent = document.createElement('td')
        lineContent.className = 'line-content'
        const code = document.createElement('code')
        code.textContent = lines[i]!
        lineContent.appendChild(code)
        tr.appendChild(lineContent)

        table.appendChild(tr)
      }

      el.appendChild(table)
    },
    destroy: () => {},
    container: { tag: 'div', attrs: { class: 'file-view' } },
  })
}
