import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp, component } from '../src/index'
import {
  math,
  mi,
  mn,
  mo,
  ms,
  mtext,
  mrow,
  mfrac,
  msqrt,
  mroot,
  msup,
  msub,
  msubsup,
  munder,
  mover,
  munderover,
  mtable,
  mtr,
  mtd,
  mspace,
  mpadded,
  mphantom,
  menclose,
  merror,
  maction,
} from '../src/mathml-elements'
import type { AppHandle } from '../src/types'

describe('MathML elements', () => {
  let root: HTMLElement
  let app: AppHandle | null = null

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
  })

  afterEach(() => {
    app?.dispose()
    root.remove()
  })

  it('creates elements in MathML namespace', () => {
    type S = {}
    app = mountApp(
      root,
      component<S, never, never>({
        name: 'MathTest',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: () => [
          math([
            mrow([
              mn([]),
              mo([]),
              mn([]),
            ]),
          ]),
        ],
      }),
    )

    const mathEl = root.querySelector('math')!
    expect(mathEl).toBeTruthy()
    expect(mathEl.namespaceURI).toBe('http://www.w3.org/1998/Math/MathML')

    const mnEl = root.querySelector('mn')!
    expect(mnEl.namespaceURI).toBe('http://www.w3.org/1998/Math/MathML')
  })

  it('creates fraction layout', () => {
    type S = {}
    app = mountApp(
      root,
      component<S, never, never>({
        name: 'MathFrac',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: () => [
          math([
            mfrac([
              mn([]),
              mn([]),
            ]),
          ]),
        ],
      }),
    )

    expect(root.querySelector('mfrac')).toBeTruthy()
  })

  it('creates superscript/subscript layouts', () => {
    type S = {}
    app = mountApp(
      root,
      component<S, never, never>({
        name: 'MathScript',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: () => [
          math([
            msup([mi([]), mn([])]),
            msub([mi([]), mn([])]),
            msubsup([mi([]), mn([]), mn([])]),
          ]),
        ],
      }),
    )

    expect(root.querySelector('msup')).toBeTruthy()
    expect(root.querySelector('msub')).toBeTruthy()
    expect(root.querySelector('msubsup')).toBeTruthy()
  })

  it('creates root/sqrt elements', () => {
    type S = {}
    app = mountApp(
      root,
      component<S, never, never>({
        name: 'MathRoot',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: () => [
          math([
            msqrt([mn([])]),
            mroot([mn([]), mn([])]),
          ]),
        ],
      }),
    )

    expect(root.querySelector('msqrt')).toBeTruthy()
    expect(root.querySelector('mroot')).toBeTruthy()
  })

  it('creates table layout', () => {
    type S = {}
    app = mountApp(
      root,
      component<S, never, never>({
        name: 'MathTable',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: () => [
          math([
            mtable([
              mtr([mtd([mn([])]), mtd([mn([])])]),
              mtr([mtd([mn([])]), mtd([mn([])])]),
            ]),
          ]),
        ],
      }),
    )

    expect(root.querySelector('mtable')).toBeTruthy()
    expect(root.querySelectorAll('mtr')).toHaveLength(2)
    expect(root.querySelectorAll('mtd')).toHaveLength(4)
  })

  it('creates under/over elements', () => {
    type S = {}
    app = mountApp(
      root,
      component<S, never, never>({
        name: 'MathUnderOver',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: () => [
          math([
            munder([mi([]), mo([])]),
            mover([mi([]), mo([])]),
            munderover([mi([]), mo([]), mo([])]),
          ]),
        ],
      }),
    )

    expect(root.querySelector('munder')).toBeTruthy()
    expect(root.querySelector('mover')).toBeTruthy()
    expect(root.querySelector('munderover')).toBeTruthy()
  })

  it('creates spacing/phantom/enclosure elements', () => {
    type S = {}
    app = mountApp(
      root,
      component<S, never, never>({
        name: 'MathMisc',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: () => [
          math([
            mspace({ width: '1em' }),
            mpadded({ width: '+0.5em' }, [mn([])]),
            mphantom([mn([])]),
            menclose({ notation: 'box' }, [mn([])]),
            merror([mtext([])]),
            maction([mn([]), mn([])]),
            ms([]),
          ]),
        ],
      }),
    )

    expect(root.querySelector('mspace')).toBeTruthy()
    expect(root.querySelector('mpadded')).toBeTruthy()
    expect(root.querySelector('mphantom')).toBeTruthy()
    expect(root.querySelector('menclose')).toBeTruthy()
    expect(root.querySelector('merror')).toBeTruthy()
    expect(root.querySelector('maction')).toBeTruthy()
    expect(root.querySelector('ms')).toBeTruthy()
  })

  it('supports reactive attributes', () => {
    type S = { color: string }
    app = mountApp(
      root,
      component<S, never, never>({
        name: 'MathReactive',
        init: () => [{ color: 'red' }, []],
        update: (s) => [s, []],
        view: () => [
          math([
            mi({ mathcolor: (s: S) => s.color }, []),
          ]),
        ],
      }),
    )

    const miEl = root.querySelector('mi')!
    expect(miEl.getAttribute('mathcolor')).toBe('red')
  })
})
