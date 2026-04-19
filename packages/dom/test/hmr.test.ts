import { describe, it, expect } from 'vitest'
import { component, div, text, mountApp } from '../src/index'
import { replaceComponent, registerForHmr, enableHmr } from '../src/hmr'
import { createComponentInstance, flushInstance } from '../src/update-loop'
import { setFlatBindings } from '../src/binding'
import { setRenderContext, clearRenderContext } from '../src/render-context'
import { browserEnv } from '../src/dom-env'
import { createView } from '../src/view-helpers'

describe('HMR state preservation', () => {
  it('replaceComponent preserves state and rebuilds DOM with new view', () => {
    type State = { count: number }
    type Msg = { type: 'inc' }

    const v1Def = component<State, Msg, never>({
      name: 'HmrComp',
      init: () => [{ count: 0 }, []],
      update: (s, msg) => {
        if (msg.type === 'inc') return [{ count: s.count + 1 }, []]
        return [s, []]
      },
      view: () => [div({ class: 'v1' }, [text((s: State) => `v1:${s.count}`)])],
      __dirty: (o, n) => (Object.is(o.count, n.count) ? 0 : 1),
    })

    const container = document.createElement('div')
    const inst = createComponentInstance(v1Def)

    // Register for HMR
    registerForHmr('HmrComp', inst, container)

    // Mount manually
    setFlatBindings(inst.allBindings)
    setRenderContext({
      rootLifetime: inst.rootLifetime,
      state: inst.state,
      allBindings: inst.allBindings,
      structuralBlocks: inst.structuralBlocks,
      dom: inst.dom,
      container,
      send: inst.send as (msg: unknown) => void,
    })
    const nodes = v1Def.view(createView(inst.send))
    clearRenderContext()
    setFlatBindings(null)
    for (const node of nodes) container.appendChild(node)

    expect(container.textContent).toBe('v1:0')

    // Mutate state
    inst.send({ type: 'inc' })
    flushInstance(inst)
    inst.send({ type: 'inc' })
    flushInstance(inst)
    expect(container.textContent).toBe('v1:2')

    // Hot-swap: new view, same name
    const v2Def = component<State, Msg, never>({
      name: 'HmrComp',
      init: () => [{ count: 0 }, []],
      update: (s, msg) => {
        if (msg.type === 'inc') return [{ count: s.count + 1 }, []]
        return [s, []]
      },
      view: () => [div({ class: 'v2' }, [text((s: State) => `v2:${s.count}`)])],
      __dirty: (o, n) => (Object.is(o.count, n.count) ? 0 : 1),
    })

    replaceComponent('HmrComp', v2Def)

    // State preserved (count=2), view changed (v2)
    expect(container.querySelector('.v1')).toBeNull()
    expect(container.querySelector('.v2')).not.toBeNull()
    expect(container.textContent).toBe('v2:2')

    // Further updates work with new view + __dirty
    inst.send({ type: 'inc' })
    flushInstance(inst)
    expect(container.textContent).toBe('v2:3')
  })
})
