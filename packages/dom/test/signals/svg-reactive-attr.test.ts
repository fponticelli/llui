import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { svg, path } from '../../src/signals/authoring'

// The signature-pad overlay draws strokes as a real SVG `path` whose `d` is a
// reactive signal (NOT an innerHTML string prop — that would be set as an inert
// attribute and never render). This covers reactive attributes on namespaced SVG
// elements built via the authoring helpers.

interface S {
  d: string
}
type M = { type: 'draw'; d: string }

describe('reactive attribute on a signal SVG element', () => {
  it('binds and updates an SVG path `d` from state', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init: () => ({ d: '' }),
      update: (_s, m) => ({ d: m.d }),
      view: ({ state }) => [
        svg({ width: '400', height: '150' }, [
          path({ d: state.map((s) => s.d), stroke: '#0f172a', fill: 'none' }),
        ]),
      ],
    })

    const p = container.querySelector('path')!
    expect(p.namespaceURI).toBe('http://www.w3.org/2000/svg') // real SVG node
    expect(p.getAttribute('stroke')).toBe('#0f172a') // static attr applied
    expect(p.getAttribute('d')).toBe('') // initial reactive value

    h.send({ type: 'draw', d: 'M0,0 L10,10' })
    expect(container.querySelector('path')!.getAttribute('d')).toBe('M0,0 L10,10')
    h.dispose()
  })
})
