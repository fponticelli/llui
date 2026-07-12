import { describe, it, expect } from 'vitest'
import { propertyTest } from '../src/property-test'
import { component, div, text } from '@llui/dom'

describe('propertyTest mount-mode console.error timing', () => {
  it('reports a console.error emitted at MOUNT time (before any message)', () => {
    // The binding accessor runs once during the initial view build (mount) and
    // console.errors there. The audit fix checks the capture immediately after
    // mount — before the init-invariant read — so this is caught even though the
    // error predates any dispatched message.
    let firstCall = true
    const Boom = component<{ n: number }, { type: 'tick' }, never>({
      name: 'Boom',
      init: () => [{ n: 0 }, []],
      update: (s) => [{ n: s.n + 1 }, []],
      view: ({ state }) => [
        div([
          text(
            state.map((s) => {
              if (firstCall) {
                firstCall = false
                console.error('mount-time binding boom')
              }
              return String(s.n)
            }),
          ),
        ]),
      ],
    })

    let message = ''
    try {
      propertyTest(Boom, {
        invariants: [() => true],
        messageGenerators: { tick: () => ({ type: 'tick' as const }) },
        runs: 1,
        maxSequenceLength: 3,
        seed: 1,
        // Mount mode is required to build the view (where the binding throws).
        mount: {},
      })
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain('console.error during commit')
    expect(message).toContain('mount-time binding boom')
  })
})
