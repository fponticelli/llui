/**
 * Task 09 — Debounced Search (Tier 3)
 * Idiomatic score: 6/6
 */
import { component, div, input, text, each, show } from '@llui/dom'
import { handleEffects, http, cancel, debounce } from '@llui/effects'

type SearchResult = { id: number; title: string }

type State = {
  query: string
  results: SearchResult[]
  searching: boolean
}

type Msg =
  | { type: 'setQuery'; value: string }
  | { type: 'searchResults'; payload: SearchResult[] }
  | { type: 'searchError'; error: unknown }

type Effect =
  | { type: 'http'; url: string; onSuccess: string; onError: string }
  | { type: 'cancel'; token: string; inner?: Effect }
  | { type: 'debounce'; key: string; ms: number; inner: Effect }

export const DebouncedSearch = component<State, Msg, Effect>({
  name: 'DebouncedSearch',
  init: () => [{ query: '', results: [], searching: false }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'setQuery': {
        const query = msg.value
        if (query === '') {
          return [{ ...state, query, results: [], searching: false }, [cancel('search')]]
        }
        return [
          { ...state, query, searching: true },
          [
            cancel(
              'search',
              debounce(
                'search',
                300,
                http({
                  url: `/api/search?q=${encodeURIComponent(query)}`,
                  onSuccess: 'searchResults',
                  onError: 'searchError',
                }),
              ),
            ),
          ],
        ]
      }
      case 'searchResults':
        return [{ ...state, results: msg.payload, searching: false }, []]
      case 'searchError':
        return [{ ...state, searching: false }, []]
    }
  },
  view: ({ send, show, each }) => [
    div({ class: 'search' }, [
      input({
        type: 'text',
        placeholder: 'Search...',
        value: (s: State) => s.query,
        onInput: (e: Event) =>
          send({ type: 'setQuery', value: (e.target as HTMLInputElement).value }),
      }),
      ...show({
        when: (s) => s.searching,
        render: () => [text('Searching...')],
      }),
      ...each({
        items: (s) => s.results,
        key: (r) => r.id,
        render: ({ item }) => [div({ class: 'result' }, [text(item((r) => r.title))])],
      }),
    ]),
  ],
  onEffect: handleEffects<Effect>().else(() => {
    // No custom effects
  }),
})
