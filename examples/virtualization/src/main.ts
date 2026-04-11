import { component, mountApp, div, h1, p, input, label, span, virtualEach } from '@llui/dom'

// ── Data ────────────────────────────────────────────────────────

type LogLevel = 'info' | 'warn' | 'error' | 'debug'

interface LogEntry {
  id: number
  timestamp: string
  level: LogLevel
  source: string
  message: string
}

const LEVELS: LogLevel[] = ['info', 'info', 'info', 'warn', 'debug', 'error']
const SOURCES = ['api', 'worker', 'db', 'cache', 'auth', 'queue', 'http', 'scheduler']
const MESSAGES = [
  'Request completed in {n}ms',
  'Connection pool exhausted ({n}/{max})',
  'Cache miss for key {k}',
  'Rate limit reached for user {u}',
  'Background job started',
  'Migration applied: {m}',
  'Index rebuild finished',
  'Session expired for {u}',
  'Webhook delivered to {endpoint}',
  'Memory usage {n}MB',
]

function generateLogs(count: number): LogEntry[] {
  const start = Date.now() - count * 1000
  return Array.from({ length: count }, (_, i) => {
    const level = LEVELS[i % LEVELS.length]!
    const source = SOURCES[i % SOURCES.length]!
    const template = MESSAGES[i % MESSAGES.length]!
    const msg = template
      .replace('{n}', String((i * 37) % 2048))
      .replace('{max}', '2048')
      .replace('{k}', `user_${i % 1000}`)
      .replace('{u}', `user_${i % 1000}`)
      .replace('{m}', `v${(i % 42) + 1}`)
      .replace('{endpoint}', `/hook/${i % 50}`)
    const ts = new Date(start + i * 1000).toISOString().slice(11, 23)
    return { id: i, timestamp: ts, level, source, message: msg }
  })
}

// ── Types ───────────────────────────────────────────────────────

type State = {
  count: number
  logs: LogEntry[]
}

type Msg = { type: 'setCount'; count: number }

// ── Component ───────────────────────────────────────────────────

const App = component<State, Msg, never>({
  name: 'VirtualLogViewer',
  init: () => [{ count: 50000, logs: generateLogs(50000) }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'setCount':
        return [{ count: msg.count, logs: generateLogs(msg.count) }, []]
    }
  },
  view: ({ send, text }) => [
    h1([text('Virtual log viewer')]),
    p({ class: 'subtitle' }, [
      text(
        '50,000 log entries rendered with virtualEach — only the ~15 visible rows are in the DOM',
      ),
    ]),

    div({ class: 'controls' }, [
      label({ for: 'count' }, [text('Rows:')]),
      input({
        id: 'count',
        type: 'range',
        min: '100',
        max: '100000',
        step: '100',
        value: (s: State) => String(s.count),
        onInput: (e: Event) => {
          const target = e.currentTarget as HTMLInputElement
          send({ type: 'setCount', count: Number(target.value) })
        },
      }),
      span({ class: 'count' }, [text((s: State) => s.count.toLocaleString())]),
    ]),

    ...virtualEach<State, LogEntry, Msg>({
      items: (s) => s.logs,
      key: (log) => log.id,
      itemHeight: 32,
      containerHeight: 560,
      class: 'log-table',
      render: ({ item }) => [
        div(
          {
            class: 'log-row',
            'data-level': item((l) => l.level),
          },
          [
            span({ class: 'timestamp' }, [text(item((l) => l.timestamp))]),
            span({ class: 'level' }, [text(item((l) => l.level))]),
            span({ class: 'source' }, [text(item((l) => l.source))]),
            span({ class: 'message' }, [text(item((l) => l.message))]),
          ],
        ),
      ],
    }),

    div({ class: 'stats' }, [
      span([
        text('Visible DOM nodes: '),
        span([text(() => String(document.querySelectorAll('.log-row').length))]),
      ]),
      span([text('Total entries: '), span([text((s: State) => String(s.logs.length))])]),
    ]),
  ],
})

// ── Mount ───────────────────────────────────────────────────────

mountApp(document.getElementById('app')!, App)
