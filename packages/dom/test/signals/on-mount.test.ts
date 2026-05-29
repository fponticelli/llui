import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { signalText, el, signalShow, onMount } from '../../src/signals/dom'

describe('onMount (signal)', () => {
  interface S {
    open: boolean
  }
  type M = { type: 'toggle' }

  it('runs the callback with the mounted root and cleans up on dispose', () => {
    const calls: string[] = []
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init: () => ({ open: false }),
      update: (s) => ({ open: !s.open }),
      view: () => [
        el('p', {}, [signalText(() => 'hi', [])]),
        onMount((root) => {
          calls.push(`mount:${root.tagName}`)
          return () => calls.push('cleanup')
        }),
      ],
    })
    expect(calls).toEqual(['mount:DIV']) // ran with the component container
    h.dispose()
    expect(calls).toEqual(['mount:DIV', 'cleanup'])
  })

  it('runs / cleans up onMount inside a show arm as it mounts/unmounts', () => {
    const calls: string[] = []
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init: () => ({ open: false }),
      update: (s) => ({ open: !s.open }),
      view: () => [
        signalShow({ produce: (s) => (s as S).open, deps: ['open'] }, () => [
          el('span', {}, [signalText(() => 'shown', [])]),
          onMount(() => {
            calls.push('arm-mount')
            return () => calls.push('arm-cleanup')
          }),
        ]),
      ],
    })
    expect(calls).toEqual([]) // arm not shown yet
    h.send({ type: 'toggle' }) // show
    expect(calls).toEqual(['arm-mount'])
    h.send({ type: 'toggle' }) // hide -> cleanup
    expect(calls).toEqual(['arm-mount', 'arm-cleanup'])
  })
})
