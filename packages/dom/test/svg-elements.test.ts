import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp, component } from '../src/index'
import {
  svg,
  circle,
  rect,
  line,
  path,
  g,
  text as svgText,
  defs,
  use,
  clipPath,
  linearGradient,
  stop,
  ellipse,
  polygon,
  polyline,
  image,
  foreignObject,
  mask,
  pattern,
  radialGradient,
  symbol,
  marker,
  filter,
  feGaussianBlur,
  feColorMatrix,
  feBlend,
  feFlood,
  feComposite,
  feOffset,
  feMerge,
  feMergeNode,
  animate,
  animateTransform,
  tspan,
} from '../src/svg-elements'
import type { AppHandle } from '../src/types'

describe('SVG elements', () => {
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

  it('creates elements in SVG namespace', () => {
    type S = { r: number }
    type M = never
    app = mountApp(
      root,
      component<S, M, never>({
        name: 'SvgTest',
        init: () => [{ r: 50 }, []],
        update: (s) => [s, []],
        view: () => [
          svg({ viewBox: '0 0 100 100', width: '100', height: '100' }, [
            circle({ cx: '50', cy: '50', r: '25', fill: 'red' }),
          ]),
        ],
      }),
    )

    const svgEl = root.querySelector('svg')!
    expect(svgEl).toBeTruthy()
    expect(svgEl.namespaceURI).toBe('http://www.w3.org/2000/svg')

    const circleEl = svgEl.querySelector('circle')!
    expect(circleEl).toBeTruthy()
    expect(circleEl.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(circleEl.getAttribute('cx')).toBe('50')
    expect(circleEl.getAttribute('fill')).toBe('red')
  })

  it('supports reactive attributes', () => {
    type S = { radius: number }
    type M = { type: 'set'; r: number }
    const def = component<S, M, never>({
      name: 'SvgReactive',
      init: () => [{ radius: 10 }, []],
      update: (s, m) => [{ ...s, radius: m.r }, []],
      view: () => [
        svg({ viewBox: '0 0 100 100' }, [
          circle({ r: (s: S) => String(s.radius), cx: '50', cy: '50' }),
        ]),
      ],
    })
    app = mountApp(root, def)

    const circleEl = root.querySelector('circle')!
    expect(circleEl.getAttribute('r')).toBe('10')

    app.flush()
  })

  it('creates structural elements (g, defs, clipPath)', () => {
    type S = {}
    app = mountApp(
      root,
      component<S, never, never>({
        name: 'SvgStructural',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: () => [
          svg({}, [
            defs([clipPath({ id: 'clip1' }, [rect({ width: '50', height: '50' })])]),
            g({ 'clip-path': 'url(#clip1)' }, [
              rect({ width: '100', height: '100', fill: 'blue' }),
            ]),
          ]),
        ],
      }),
    )

    expect(root.querySelector('defs')).toBeTruthy()
    expect(root.querySelector('clipPath')).toBeTruthy()
    expect(root.querySelector('g')).toBeTruthy()
  })

  it('creates gradient elements', () => {
    type S = {}
    app = mountApp(
      root,
      component<S, never, never>({
        name: 'SvgGradient',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: () => [
          svg({}, [
            defs([
              linearGradient({ id: 'lg1' }, [
                stop({ offset: '0%', 'stop-color': 'red' }),
                stop({ offset: '100%', 'stop-color': 'blue' }),
              ]),
              radialGradient({ id: 'rg1' }, [stop({ offset: '0%', 'stop-color': 'white' })]),
            ]),
          ]),
        ],
      }),
    )

    expect(root.querySelector('linearGradient')).toBeTruthy()
    expect(root.querySelector('radialGradient')).toBeTruthy()
    expect(root.querySelectorAll('stop')).toHaveLength(3)
  })

  it('creates shape elements', () => {
    type S = {}
    app = mountApp(
      root,
      component<S, never, never>({
        name: 'SvgShapes',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: () => [
          svg({}, [
            ellipse({ cx: '50', cy: '50', rx: '30', ry: '20' }),
            line({ x1: '0', y1: '0', x2: '100', y2: '100' }),
            polygon({ points: '50,5 20,99 95,39 5,39 80,99' }),
            polyline({ points: '0,0 50,50 100,0' }),
            path({ d: 'M10 80 C 40 10, 65 10, 95 80' }),
          ]),
        ],
      }),
    )

    expect(root.querySelector('ellipse')).toBeTruthy()
    expect(root.querySelector('line')).toBeTruthy()
    expect(root.querySelector('polygon')).toBeTruthy()
    expect(root.querySelector('polyline')).toBeTruthy()
    expect(root.querySelector('path')).toBeTruthy()
  })

  it('creates text elements with tspan', () => {
    type S = {}
    app = mountApp(
      root,
      component<S, never, never>({
        name: 'SvgText',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: () => [svg({}, [svgText({ x: '10', y: '20' }, [tspan({ fill: 'red' }, [])])])],
      }),
    )

    const textEl = root.querySelector('text')!
    expect(textEl).toBeTruthy()
    expect(textEl.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(root.querySelector('tspan')).toBeTruthy()
  })

  it('creates filter elements', () => {
    type S = {}
    app = mountApp(
      root,
      component<S, never, never>({
        name: 'SvgFilter',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: () => [
          svg({}, [
            defs([
              filter({ id: 'f1' }, [
                feGaussianBlur({ stdDeviation: '5' }),
                feColorMatrix({ type: 'saturate', values: '0.5' }),
                feBlend({ mode: 'multiply' }),
                feFlood({ 'flood-color': 'red' }),
                feComposite({ operator: 'in' }),
                feOffset({ dx: '5', dy: '5' }),
                feMerge([feMergeNode({}), feMergeNode({})]),
              ]),
            ]),
          ]),
        ],
      }),
    )

    expect(root.querySelector('filter')).toBeTruthy()
    expect(root.querySelector('feGaussianBlur')).toBeTruthy()
    expect(root.querySelector('feColorMatrix')).toBeTruthy()
  })

  it('supports use, symbol, marker, image, mask, pattern, foreignObject', () => {
    type S = {}
    app = mountApp(
      root,
      component<S, never, never>({
        name: 'SvgMisc',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: () => [
          svg({}, [
            defs([
              symbol({ id: 's1' }, [circle({ r: '10' })]),
              marker({ id: 'm1' }, []),
              mask({ id: 'mask1' }, [rect({})]),
              pattern({ id: 'p1' }, []),
            ]),
            use({ href: '#s1' }),
            image({ href: 'test.png' }),
            foreignObject({ width: '100', height: '100' }, []),
          ]),
        ],
      }),
    )

    expect(root.querySelector('symbol')).toBeTruthy()
    expect(root.querySelector('use')).toBeTruthy()
    expect(root.querySelector('marker')).toBeTruthy()
    expect(root.querySelector('image')).toBeTruthy()
    expect(root.querySelector('mask')).toBeTruthy()
    expect(root.querySelector('pattern')).toBeTruthy()
    expect(root.querySelector('foreignObject')).toBeTruthy()
  })

  it('creates animate elements', () => {
    type S = {}
    app = mountApp(
      root,
      component<S, never, never>({
        name: 'SvgAnimate',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: () => [
          svg({}, [
            circle({ cx: '50', cy: '50', r: '25' }, [
              animate({ attributeName: 'r', from: '10', to: '25', dur: '1s' }),
              animateTransform({
                attributeName: 'transform',
                type: 'rotate',
                from: '0 50 50',
                to: '360 50 50',
              }),
            ]),
          ]),
        ],
      }),
    )

    expect(root.querySelector('animate')).toBeTruthy()
    expect(root.querySelector('animateTransform')).toBeTruthy()
  })

  it('handles event listeners on SVG elements', () => {
    let clicked = false
    type S = {}
    type M = { type: 'click' }
    app = mountApp(
      root,
      component<S, M, never>({
        name: 'SvgEvents',
        init: () => [{}, []],
        update: (s) => [s, []],
        view: ({ send }) => [
          svg({}, [
            circle({
              cx: '50',
              cy: '50',
              r: '25',
              onClick: () => {
                clicked = true
                send({ type: 'click' })
              },
            }),
          ]),
        ],
      }),
    )

    const circleEl = root.querySelector('circle')!
    circleEl.dispatchEvent(new MouseEvent('click'))
    expect(clicked).toBe(true)
  })
})
