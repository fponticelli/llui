import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { signalText, el, signalShow, onMount } from '../../src/signals/dom'

// Repro for the dice.run issue report: a send() issued from an onMount callback
// mutates state but the view's reactive readers don't re-render until a later,
// unrelated dispatch. Root cause hypothesis: onMount runs synchronously inside
// `mount = mountSignal(...)`, so a commit triggered during onMount calls
// `mount?.update()` while `mount` is still null — the reconcile is dropped.
describe('onMount → send commit (repro)', () => {
  interface S {
    stats: string | null
  }
  type M = { type: 'compute' } | { type: 'rendered'; stats: string }

  it('a send() from onMount re-renders show arms immediately (no later event)', () => {
    const container = document.createElement('div')
    mountSignalComponent<S, M>(container, {
      init: () => ({ stats: null }),
      update: (_s, m) => {
        switch (m.type) {
          case 'compute':
            return { stats: 'COMPUTED' }
          case 'rendered':
            return { stats: m.stats }
        }
      },
      view: ({ send }) => [
        signalShow({ produce: (s) => (s as S).stats === null, deps: ['stats'] }, () => [
          el('p', {}, [signalText(() => 'Computing…', [])]),
        ]),
        signalShow({ produce: (s) => (s as S).stats !== null, deps: ['stats'] }, () => [
          el('div', { class: 'chart' }, [signalText((s) => (s as S).stats ?? '', ['stats'])]),
        ]),
        onMount(() => {
          // post-mount compute kickoff, like dice.run's stats pane
          send({ type: 'compute' })
        }),
      ],
    })
    // After mount, stats should be 'COMPUTED' and the chart visible — no user event.
    expect(container.querySelector('.chart')?.textContent).toBe('COMPUTED')
    expect(container.textContent).not.toContain('Computing…')
  })

  // The report's exact chain: onMount → send(compute) → reducer emits a render
  // effect → the effect's (synchronous) async IIFE sends `rendered`, which sets
  // state. All of it runs synchronously inside the initial mount.
  it('renders when the state change arrives via an effect kicked off from onMount', () => {
    type E = { type: 'render' }
    const container = document.createElement('div')
    mountSignalComponent<S, M, E>(container, {
      init: () => ({ stats: null }),
      update: (_s, m) => {
        switch (m.type) {
          case 'compute':
            return [{ stats: null }, [{ type: 'render' }]]
          case 'rendered':
            return { stats: m.stats }
        }
      },
      onEffect: (e, { send }) => {
        if (e.type === 'render') {
          // synchronous "analyze" + dispatch, like the report's async IIFE with no await
          send({ type: 'rendered', stats: 'ANALYZED' })
        }
      },
      view: ({ send }) => [
        signalShow({ produce: (s) => (s as S).stats === null, deps: ['stats'] }, () => [
          el('p', {}, [signalText(() => 'Computing…', [])]),
        ]),
        signalShow({ produce: (s) => (s as S).stats !== null, deps: ['stats'] }, () => [
          el('div', { class: 'chart' }, [signalText((s) => (s as S).stats ?? '', ['stats'])]),
        ]),
        onMount(() => {
          send({ type: 'compute' })
        }),
      ],
    })
    expect(container.querySelector('.chart')?.textContent).toBe('ANALYZED')
    expect(container.textContent).not.toContain('Computing…')
  })
})
