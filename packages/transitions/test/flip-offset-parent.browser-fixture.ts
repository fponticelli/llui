import { flip } from '../src/flip.js'

export interface RecordedGlide {
  id: string
  from: string
}

export interface FlipBrowserHarnessOptions {
  fractionalDepth?: number
  hiddenFirst?: boolean
  marginTop?: number
}

export interface FlipBrowserHarness {
  fractionalAncestors: HTMLElement[]
  glides: RecordedGlide[]
  list: HTMLElement
  rows: HTMLElement[]
  scroller: HTMLElement
  transition: ReturnType<typeof flip>
  wrapper: HTMLElement
}

declare global {
  interface Window {
    __createFlipHarness: (options?: FlipBrowserHarnessOptions) => Promise<FlipBrowserHarness>
  }
}

function requiredElement(selector: string): HTMLElement {
  const element = document.querySelector(selector)
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing fixture element: ${selector}`)
  }
  return element
}

export async function createFlipBrowserHarness(
  options: FlipBrowserHarnessOptions = {},
): Promise<FlipBrowserHarness> {
  document.body.innerHTML = `
    <style>
      body { margin: 0; min-height: 1400px; }
      #wrapper { top: 0; }
      #scroller { overflow: visible; }
      #list { width: 200px; }
      .row { box-sizing: border-box; height: 60px; }
      .fractional { margin-left: 0.49px; }
    </style>
    <div id="wrapper"><div id="scroller"><div id="list"></div></div></div>
  `

  const wrapper = requiredElement('#wrapper')
  const scroller = requiredElement('#scroller')
  const list = requiredElement('#list')
  wrapper.style.marginTop = `${options.marginTop ?? 250}px`

  const ids = options.hiddenFirst ? ['hidden', 'a', 'b'] : ['a', 'b', 'c', 'd']
  for (const id of ids) {
    const row = document.createElement('div')
    row.className = 'row'
    row.id = id
    row.textContent = id
    if (id === 'hidden') row.style.display = 'none'
    list.append(row)
  }
  const rows = Array.from(list.children).filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  )

  const fractionalAncestors: HTMLElement[] = []
  for (let i = 0; i < (options.fractionalDepth ?? 0); i++) {
    const ancestor = document.createElement('div')
    ancestor.className = 'fractional'
    scroller.parentNode?.insertBefore(ancestor, scroller)
    ancestor.append(scroller)
    fractionalAncestors.push(ancestor)
  }

  const glides: RecordedGlide[] = []
  const nativeAnimate = Element.prototype.animate
  Element.prototype.animate = function (keyframes, animationOptions) {
    const animation = nativeAnimate.call(this, keyframes, animationOptions)
    const firstKeyframe =
      animation.effect instanceof KeyframeEffect ? animation.effect.getKeyframes()[0] : undefined
    glides.push({ id: this.id, from: String(firstKeyframe?.transform ?? '') })
    return animation
  }

  const transition = flip({ duration: 500, easing: 'linear' })
  transition.enter!(rows)
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  return { fractionalAncestors, glides, list, rows, scroller, transition, wrapper }
}

window.__createFlipHarness = createFlipBrowserHarness
