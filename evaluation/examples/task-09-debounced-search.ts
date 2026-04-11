/**
 * Task 09 — Debounced Search (Tier 3)
 * Idiomatic score: 6/6
 */
import { component, div, input } from '@llui/dom'
import { handleEffects, http, cancel, debounce, type Effect } from '@llui/effects'

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

// Effect is the built-in union from @llui/effects (imported above).

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
                  onSuccess: (data) => ({
                    type: 'searchResults' as const,
                    payload: data as SearchResult[],
                  }),
                  onError: (err) => ({ type: 'searchError' as const, error: err }),
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
  view: ({ send, text, show, each }) => [
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
        render: (row) => [div({ class: 'result' }, [text(row.item((r) => r.title))])],
      }),
    ]),
  ],
  onEffect: handleEffects<Effect>().else((ctx) => {
    console.warn('Unhandled effect:', ctx.effect)
  }),
})
