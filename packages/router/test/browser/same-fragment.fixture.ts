import { component, mountApp, text } from '@llui/dom'
import { connectRouter } from '../../src/connect.js'
import { createRouter, route } from '../../src/index.js'

type Route = { page: 'home' } | { page: 'login' } | { page: 'other' }

interface TraversalResult {
  sameFragment: {
    events: string[]
    marker: unknown
    dispatches: string[]
  }
  blockedRestore: {
    events: string[]
    marker: unknown
    hash: string
    dispatches: string[]
  }
}

declare global {
  interface Window {
    __runSameFragmentTraversal(): Promise<TraversalResult>
    __sameFragmentReady: boolean
  }
}

const router = createRouter<Route>([
  route([], () => ({ page: 'home' })),
  route(['login'], () => ({ page: 'login' })),
  route(['other'], () => ({ page: 'other' })),
])

let blockHome = false
const routing = connectRouter(router, {
  beforeEnter: (to) => (blockHome && to.page === 'home' ? false : undefined),
})
const dispatches: string[] = []
const record = (message: unknown): void => {
  dispatches.push((message as { route: Route }).route.page)
}
const signal = new AbortController().signal

mountApp(
  document.querySelector('#app')!,
  component({
    name: 'SameFragmentTraversalFixture',
    init: (): [null, never[]] => [null, []],
    update: (state: null): [null, never[]] => [state, []],
    view: () => [...routing.listener(record), text('ready')],
  }),
)

function navigate(route: Route): void {
  routing.handleEffect({ effect: routing.navigate(route), send: record, signal })
}

function replace(route: Route): void {
  routing.handleEffect({ effect: routing.replace(route), send: record, signal })
}

function marker(): unknown {
  return (history.state as Record<string, unknown> | null)?.['marker']
}

function mark(value: string): void {
  history.replaceState({ ...(history.state as object), marker: value }, '')
}

function waitFor(label: string, predicate: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = performance.now()
    const check = () => {
      if (predicate()) {
        resolve()
      } else if (performance.now() - started > 5_000) {
        reject(
          new Error(
            `Timed out waiting for ${label}: hash=${location.hash}, marker=${String(marker())}`,
          ),
        )
      } else {
        requestAnimationFrame(check)
      }
    }
    check()
  })
}

window.__runSameFragmentTraversal = async () => {
  const events: string[] = []
  addEventListener('popstate', () => events.push('popstate'))
  addEventListener('hashchange', () => events.push('hashchange'))

  navigate({ page: 'login' })
  await waitFor('first hash navigation', () => events.includes('hashchange'))
  mark('entry-1')

  events.length = 0
  navigate({ page: 'other' })
  await waitFor('second hash navigation', () => events.includes('hashchange'))
  mark('entry-2')
  replace({ page: 'login' })

  events.length = 0
  dispatches.length = 0
  history.back()
  await waitFor('same-fragment back', () => marker() === 'entry-1')
  await new Promise(requestAnimationFrame)
  const sameFragment = {
    events: [...events],
    marker: marker(),
    dispatches: [...dispatches],
  }

  blockHome = true
  events.length = 0
  dispatches.length = 0
  history.back()
  await waitFor(
    'blocked traversal and restore',
    () => events.filter((event) => event === 'popstate').length === 2,
  )
  await new Promise(requestAnimationFrame)
  const blockedRestore = {
    events: [...events],
    marker: marker(),
    hash: location.hash,
    dispatches: [...dispatches],
  }

  return { sameFragment, blockedRestore }
}

window.__sameFragmentReady = true
