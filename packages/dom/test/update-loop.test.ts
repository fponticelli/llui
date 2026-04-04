import { describe, it, expect, vi } from 'vitest'
import { createComponentInstance, flushInstance } from '../src/update-loop'
import type { ComponentDef } from '../src/types'

function counterDef(): ComponentDef<{ count: number }, { type: 'inc' } | { type: 'dec' }, never> {
  return {
    name: 'Counter',
    init: () => [{ count: 0 }, []],
    update: (state, msg) => {
      switch (msg.type) {
        case 'inc':
          return [{ ...state, count: state.count + 1 }, []]
        case 'dec':
          return [{ ...state, count: Math.max(0, state.count - 1) }, []]
      }
    },
    view: () => [],
    __dirty: (o, n) => (Object.is(o.count, n.count) ? 0 : 1),
  }
}

describe('createComponentInstance', () => {
  it('initializes state from init()', () => {
    const inst = createComponentInstance(counterDef())
    expect(inst.state).toEqual({ count: 0 })
  })

  it('collects initial effects', () => {
    const def: ComponentDef<{ x: number }, never, { type: 'boot' }> = {
      name: 'WithEffect',
      init: () => [{ x: 1 }, [{ type: 'boot' }]],
      update: (s) => [s, []],
      view: () => [],
    }
    const inst = createComponentInstance(def)
    expect(inst.initialEffects).toEqual([{ type: 'boot' }])
  })
})

describe('send and flush', () => {
  it('processes a single message and updates state', () => {
    const inst = createComponentInstance(counterDef())
    inst.send({ type: 'inc' })
    flushInstance(inst)
    expect(inst.state).toEqual({ count: 1 })
  })

  it('batches multiple sends into one update cycle', () => {
    const def = counterDef()
    const updateSpy = vi.fn(def.update)
    def.update = updateSpy
    const inst = createComponentInstance(def)

    inst.send({ type: 'inc' })
    inst.send({ type: 'inc' })
    inst.send({ type: 'inc' })

    // Not yet processed
    expect(inst.state).toEqual({ count: 0 })

    flushInstance(inst)

    // All three processed, state reflects all
    expect(inst.state).toEqual({ count: 3 })
    // update was called 3 times (once per message)
    expect(updateSpy).toHaveBeenCalledTimes(3)
  })

  it('OR-merges dirty masks across batched messages', () => {
    type State = { a: number; b: string }
    type Msg = { type: 'setA'; value: number } | { type: 'setB'; value: string }

    const def: ComponentDef<State, Msg, never> = {
      name: 'TwoField',
      init: () => [{ a: 0, b: '' }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'setA':
            return [{ ...state, a: msg.value }, []]
          case 'setB':
            return [{ ...state, b: msg.value }, []]
        }
      },
      view: () => [],
      __dirty: (o, n) => (Object.is(o.a, n.a) ? 0 : 0b01) | (Object.is(o.b, n.b) ? 0 : 0b10),
    }

    const inst = createComponentInstance(def)
    inst.send({ type: 'setA', value: 42 })
    inst.send({ type: 'setB', value: 'hi' })
    flushInstance(inst)

    expect(inst.state).toEqual({ a: 42, b: 'hi' })
    // The combined dirty mask should have both bits set
    expect(inst.lastDirtyMask).toBe(0b11)
  })

  it('collects effects from all messages in order', () => {
    type Msg = { type: 'a' } | { type: 'b' }
    type Eff = { type: 'effectA' } | { type: 'effectB' }

    const def: ComponentDef<object, Msg, Eff> = {
      name: 'Effects',
      init: () => [{}, []],
      update: (_state, msg) => {
        switch (msg.type) {
          case 'a':
            return [{}, [{ type: 'effectA' }]]
          case 'b':
            return [{}, [{ type: 'effectB' }]]
        }
      },
      view: () => [],
    }

    const inst = createComponentInstance(def)
    inst.send({ type: 'a' })
    inst.send({ type: 'b' })
    flushInstance(inst)

    expect(inst.lastEffects).toEqual([{ type: 'effectA' }, { type: 'effectB' }])
  })

  it('skips update cycle when no messages are pending', () => {
    const inst = createComponentInstance(counterDef())
    flushInstance(inst) // no-op
    expect(inst.state).toEqual({ count: 0 })
  })

  it('uses 0xFFFFFFFF dirty mask when __dirty is absent', () => {
    const def = counterDef()
    delete def.__dirty
    const inst = createComponentInstance(def)
    inst.send({ type: 'inc' })
    flushInstance(inst)
    // 0xFFFFFFFF is -1 in signed 32-bit JS bitwise ops — both represent all bits set
    expect(inst.lastDirtyMask).toBe(0xffffffff | 0)
  })

  it('returns dirty 0 when state reference is unchanged', () => {
    const def: ComponentDef<{ count: number }, { type: 'noop' }, never> = {
      name: 'Noop',
      init: () => [{ count: 0 }, []],
      update: (state) => [state, []],
      view: () => [],
      __dirty: (o, n) => (Object.is(o.count, n.count) ? 0 : 1),
    }
    const inst = createComponentInstance(def)
    inst.send({ type: 'noop' })
    flushInstance(inst)
    expect(inst.lastDirtyMask).toBe(0)
  })
})

describe('microtask auto-flush', () => {
  it('auto-flushes via microtask when send is called', async () => {
    const inst = createComponentInstance(counterDef())
    inst.send({ type: 'inc' })

    // Not yet processed synchronously
    expect(inst.state).toEqual({ count: 0 })

    // Wait for microtask
    await Promise.resolve()

    expect(inst.state).toEqual({ count: 1 })
  })

  it('coalesces sends within the same microtask', async () => {
    const inst = createComponentInstance(counterDef())
    inst.send({ type: 'inc' })
    inst.send({ type: 'inc' })
    inst.send({ type: 'inc' })

    await Promise.resolve()

    expect(inst.state).toEqual({ count: 3 })
  })
})
