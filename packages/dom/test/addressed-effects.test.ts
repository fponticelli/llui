import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { child } from '../src/primitives/child'
import { text } from '../src/primitives/text'
import { div } from '../src/elements'
import { component } from '../src/component'
import { addressOf, isAddressedEffect } from '../src/addressed'
import type { ComponentDef } from '../src/types'

type ChildState = { value: string }
type ChildMsg =
  | { type: 'propsChanged'; props: Record<string, unknown> }
  | { type: 'reset' }
  | { type: 'setValue'; value: string }

const ChildComp = component<ChildState, ChildMsg, never>({
  name: 'Child',
  init: () => [{ value: 'initial' }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'propsChanged':
        return [state, []]
      case 'reset':
        return [{ value: 'reset' }, []]
      case 'setValue':
        return [{ value: msg.value }, []]
    }
  },
  propsMsg: () => ({ type: 'propsChanged' as const, props: {} }),
  receives: {
    reset: () => ({ type: 'reset' as const }),
    setValue: (params: { value: string }) => ({ type: 'setValue' as const, value: params.value }),
  },
  view: () => [text((s: ChildState) => s.value)],
  __dirty: (o, n) => (Object.is(o.value, n.value) ? 0 : 1),
})

describe('addressed effects', () => {
  it('addressOf builds typed effect objects from receives', () => {
    const addr = addressOf(ChildComp, 'child-1')
    const eff = addr.reset()
    expect(eff).toEqual({
      __addressed: true,
      __targetKey: 'child-1',
      __msg: { type: 'reset' },
    })
  })

  it('addressOf passes params to the receives handler', () => {
    const addr = addressOf(ChildComp, 'child-1')
    const eff = addr.setValue({ value: 'hello' })
    expect(eff).toEqual({
      __addressed: true,
      __targetKey: 'child-1',
      __msg: { type: 'setValue', value: 'hello' },
    })
  })

  it('addressOf returns empty object when def has no receives', () => {
    const noReceives = component<{ x: number }, { type: 'noop' }, never>({
      name: 'NoReceives',
      init: () => [{ x: 0 }, []],
      update: (s) => [s, []],
      view: () => [text('hi')],
      __dirty: () => 0,
    })
    const addr = addressOf(noReceives, 'key')
    expect(addr).toEqual({})
  })

  it('isAddressedEffect correctly identifies addressed effects', () => {
    expect(isAddressedEffect({ __addressed: true, __targetKey: 'x', __msg: {} })).toBe(true)
    expect(isAddressedEffect({ __addressed: false })).toBe(false)
    expect(isAddressedEffect(null)).toBe(false)
    expect(isAddressedEffect(undefined)).toBe(false)
    expect(isAddressedEffect('string')).toBe(false)
    expect(isAddressedEffect(42)).toBe(false)
    expect(isAddressedEffect({ type: 'http' })).toBe(false)
  })


  it('dispatches addressed effect to the target child component', async () => {
    type ParentState = { x: number }
    type ParentMsg = { type: 'sendToChild' }
    type ParentEff = { __addressed: true; __targetKey: string; __msg: unknown }

    const addr = addressOf(ChildComp, 'myChild')

    const def: ComponentDef<ParentState, ParentMsg, ParentEff> = {
      name: 'Parent',
      init: () => [{ x: 0 }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'sendToChild':
            return [state, [addr.setValue({ value: 'from parent' })]]
        }
      },
      view: (_state, send) => [
        div({}, [
          ...child<ParentState, ChildMsg>({
            def: ChildComp,
            key: 'myChild',
            props: () => ({}),
          }),
        ]),
      ],
    }

    let parentSend: (msg: ParentMsg) => void
    const defWithSend = { ...def }
    const origView = def.view
    defWithSend.view = (state, send) => {
      parentSend = send
      return origView(state, send)
    }

    const container = document.createElement('div')
    const handle = mountApp(container, defWithSend)

    expect(container.textContent).toContain('initial')

    parentSend!({ type: 'sendToChild' })
    handle.flush()

    // Wait for addressed effect dispatch + child microtask
    await Promise.resolve()
    await Promise.resolve()
    handle.flush()

    expect(container.textContent).toContain('from parent')
  })
})
