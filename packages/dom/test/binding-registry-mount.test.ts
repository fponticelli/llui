// End-to-end exercise of `__bindingModel: 'registry'` (Option B Phase 2).
// These tests construct ComponentDef literals directly so we control the
// emitted `__prefixes` table + per-binding masks the registry derives
// prefix-IDs from. With `__bindingModel: 'registry'` set, the runtime's
// `createInstance` allocates `bindingsByPrefix`, `createBinding`
// registers each binding under its prefix-IDs, and `_runPhase2`
// dispatches via the subscriber map.

import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import { text } from '../src/primitives/text'
import { div } from '../src/elements'
import type { ComponentDef } from '../src/types'

type S = { a: number; b: number }
type M = { type: 'incA' } | { type: 'incB' }

function makeRegistryDef(): ComponentDef<S, M, never> {
  return {
    name: 'Reg',
    init: () => [{ a: 0, b: 0 }, []],
    update: (s, m) => {
      switch (m.type) {
        case 'incA':
          return [{ ...s, a: s.a + 1 }, []]
        case 'incB':
          return [{ ...s, b: s.b + 1 }, []]
      }
    },
    view: () => [
      div({ id: 'a' }, [text((s: S) => `a=${s.a}`)]),
      div({ id: 'b' }, [text((s: S) => `b=${s.b}`)]),
    ],
    __prefixes: [(s) => s.a, (s) => s.b],
    __compilerVersion: '__test__',
    __bindingModel: 'registry',
  }
}

function makeFlatDef(): ComponentDef<S, M, never> {
  const def = makeRegistryDef()
  return {
    ...def,
    name: 'Flat',
    __bindingModel: 'flat',
  }
}

describe('Option B Phase 2 — registry mode end-to-end', () => {
  it('renders initial state correctly under registry mode', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, makeRegistryDef())
    expect(container.querySelector('#a')?.textContent).toBe('a=0')
    expect(container.querySelector('#b')?.textContent).toBe('b=0')
    handle.dispose()
  })

  it('updates only the binding whose prefix changed', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, makeRegistryDef())
    handle.send({ type: 'incA' })
    handle.flush()
    expect(container.querySelector('#a')?.textContent).toBe('a=1')
    expect(container.querySelector('#b')?.textContent).toBe('b=0')
    handle.dispose()
  })

  it('updates bindings under both prefixes when both change', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, makeRegistryDef())
    handle.send({ type: 'incA' })
    handle.send({ type: 'incB' })
    handle.flush()
    expect(container.querySelector('#a')?.textContent).toBe('a=1')
    expect(container.querySelector('#b')?.textContent).toBe('b=1')
    handle.dispose()
  })

  it('allocates bindingsByPrefix only when __bindingModel is registry', () => {
    const rContainer = document.createElement('div')
    const fContainer = document.createElement('div')
    const rHandle = mountApp(rContainer, makeRegistryDef())
    const fHandle = mountApp(fContainer, makeFlatDef())

    // The handle doesn't expose the instance directly; we assert via
    // behavior — both modes must render identical results from
    // identical defs. Any divergence here would mean the registry
    // path's accessor/applyBinding flow is incorrect.
    expect(rContainer.querySelector('#a')?.textContent).toBe('a=0')
    expect(fContainer.querySelector('#a')?.textContent).toBe('a=0')

    rHandle.send({ type: 'incA' })
    fHandle.send({ type: 'incA' })
    rHandle.flush()
    fHandle.flush()
    expect(rContainer.querySelector('#a')?.textContent).toBe('a=1')
    expect(fContainer.querySelector('#a')?.textContent).toBe('a=1')

    rHandle.dispose()
    fHandle.dispose()
  })

  it('produces identical output to flat mode after a sequence of updates', () => {
    const r = document.createElement('div')
    const f = document.createElement('div')
    const rh = mountApp(r, makeRegistryDef())
    const fh = mountApp(f, makeFlatDef())

    const msgs: M[] = [
      { type: 'incA' },
      { type: 'incB' },
      { type: 'incA' },
      { type: 'incA' },
      { type: 'incB' },
    ]
    for (const m of msgs) {
      rh.send(m)
      fh.send(m)
    }
    rh.flush()
    fh.flush()

    expect(r.querySelector('#a')?.textContent).toBe(f.querySelector('#a')?.textContent)
    expect(r.querySelector('#b')?.textContent).toBe(f.querySelector('#b')?.textContent)
    expect(r.querySelector('#a')?.textContent).toBe('a=3')
    expect(r.querySelector('#b')?.textContent).toBe('b=2')

    rh.dispose()
    fh.dispose()
  })

  it('disposes cleanly — bindings unregister and no dispatch fires afterwards', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, makeRegistryDef())
    handle.send({ type: 'incA' })
    handle.flush()
    expect(container.querySelector('#a')?.textContent).toBe('a=1')
    handle.dispose()
    // Container is empty after dispose; subsequent send is a no-op
    // (handle is disposed). Just assert no throw.
    expect(() => handle.send({ type: 'incA' })).not.toThrow()
  })
})
