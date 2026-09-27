import type { Page } from 'playwright'
import { paintedSpatialSignature } from './pixel-probe'
import type { ForcedColorCue } from './navigation-data-scenarios'

export async function probeEffectiveMotion(
  page: Page,
  productIds: readonly string[],
): Promise<Record<string, number>> {
  return page.evaluate((ids) => {
    const seconds = (raw: string): number => {
      const value = Number.parseFloat(raw)
      return raw.trim().endsWith('ms') ? value / 1000 : value
    }
    return Object.fromEntries(
      ids.map((productId) => {
        const root = document.querySelector<HTMLElement>(`[data-product="${productId}"]`)
        if (root === null) throw new Error(`Missing reduced-motion fixture for ${productId}`)
        if (
          !root.hasAttribute('data-motion-state') &&
          root.querySelector('[data-motion-state]') === null
        ) {
          throw new Error(`Reduced-motion fixture for ${productId} lacks a motion state`)
        }
        const elements = [
          ...(root.hasAttribute('data-motion-state') ? [root] : []),
          ...root.querySelectorAll<HTMLElement>('[data-motion-state]'),
        ]
        const maxDuration = Math.max(
          0,
          ...elements.flatMap((element): number[] => {
            const style = getComputedStyle(element)
            const animation = style.animationName.split(',').every((name) => name.trim() === 'none')
              ? []
              : style.animationDuration.split(',').map(seconds)
            const transition = style.transitionProperty
              .split(',')
              .every((property) => property.trim() === 'none')
              ? []
              : style.transitionDuration.split(',').map(seconds)
            return [...animation, ...transition].filter(Number.isFinite)
          }),
        )
        return [productId, maxDuration]
      }),
    )
  }, productIds)
}

export interface NarrowProbe {
  readonly pageContained: boolean
  readonly contained: boolean
  readonly unusableOverflow: readonly { readonly element: string; readonly overflowX: string }[]
  readonly affordances: readonly {
    readonly element: string
    readonly containedByRoot: boolean
    readonly containedByViewport: boolean
    readonly logicalPlacement: boolean
    readonly minimumTarget: boolean
    readonly usable: boolean
  }[]
}

export async function probeNarrowProduct(page: Page, productId: string): Promise<NarrowProbe> {
  return page.evaluate((id) => {
    const root = document.querySelector<HTMLElement>(`[data-product="${id}"]`)
    if (root === null) throw new Error(`Missing narrow fixture for ${id}`)
    if (
      !root.hasAttribute('data-narrow-probe') &&
      root.querySelector('[data-narrow-probe]') === null
    ) {
      throw new Error(`Narrow fixture for ${id} lacks its relevant content probe`)
    }
    document.body.replaceChildren(root)
    const rect = root.getBoundingClientRect()
    const affordances = [...root.querySelectorAll<HTMLElement>('[data-narrow-affordance]')].map(
      (element) => {
        const affordanceRect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        const rootCenter = rect.left + rect.width / 2
        const affordanceCenter = affordanceRect.left + affordanceRect.width / 2
        const logicalSide = element.dataset['logicalSide']
        const direction = getComputedStyle(root).direction
        return {
          element: element.id || element.dataset['part'] || element.tagName.toLowerCase(),
          containedByRoot:
            affordanceRect.left >= rect.left - 0.5 &&
            affordanceRect.right <= rect.right + 0.5 &&
            affordanceRect.top >= rect.top - 0.5 &&
            affordanceRect.bottom <= rect.bottom + 0.5,
          containedByViewport:
            affordanceRect.left >= -0.5 &&
            affordanceRect.right <= innerWidth + 0.5 &&
            affordanceRect.top >= -0.5 &&
            affordanceRect.bottom <= innerHeight + 0.5,
          logicalPlacement:
            logicalSide === 'start'
              ? direction === 'rtl'
                ? affordanceCenter > rootCenter
                : affordanceCenter < rootCenter
              : logicalSide === 'end'
                ? direction === 'rtl'
                  ? affordanceCenter < rootCenter
                  : affordanceCenter > rootCenter
                : logicalSide === 'flow'
                  ? affordanceCenter >= rect.left && affordanceCenter <= rect.right
                  : false,
          minimumTarget: affordanceRect.width >= 24 && affordanceRect.height >= 24,
          usable:
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            Number.parseFloat(style.opacity) > 0 &&
            style.pointerEvents !== 'none',
        }
      },
    )
    const overflowing = [root, ...root.querySelectorAll<HTMLElement>('*')]
      .filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1)
      .map((element) => ({
        element: element.id || element.tagName.toLowerCase(),
        overflowX: getComputedStyle(element).overflowX,
      }))
    return {
      pageContained: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      contained:
        rect.left >= -0.5 &&
        rect.right <= innerWidth + 0.5 &&
        rect.top >= -0.5 &&
        rect.bottom <= innerHeight + 0.5,
      affordances,
      // `overflow-x: visible` (the default) is NOT flagged (#264 review item
      // 9's carousel fix surfaced this): unlike `hidden`/`clip`, `visible`
      // never clips its overflowing content — an absolutely-positioned child
      // escaping its relatively-positioned parent's own box (shadcn's
      // carousel arrows, deliberately placed OUTSIDE the frame) stays fully
      // painted and reachable with no scroll mechanism needed at all, so
      // `scrollWidth > clientWidth` here describes normal, intentional
      // layout rather than inaccessible content. Only a NON-auto/scroll
      // overflow mode that actually CLIPS (`hidden`, `clip`) still flags.
      unusableOverflow: overflowing.filter(
        ({ overflowX }) =>
          overflowX !== 'auto' && overflowX !== 'scroll' && overflowX !== 'visible',
      ),
    }
  }, productId)
}

export interface DarkStateProbe {
  readonly backgroundToken: string
  readonly signatures: readonly string[]
}

export async function probeDarkStateHierarchy(
  page: Page,
  productIds: readonly string[],
): Promise<Record<string, DarkStateProbe>> {
  return page.evaluate(
    (ids) =>
      Object.fromEntries(
        ids.map((productId) => {
          const root = document.querySelector<HTMLElement>(`[data-product="${productId}"]`)
          if (root === null) throw new Error(`Missing dark-mode fixture for ${productId}`)
          const markers = [...root.querySelectorAll<HTMLElement>('[data-forced-state]')]
          if (markers.length < 2) {
            throw new Error(`Dark-mode fixture for ${productId} needs two semantic states`)
          }
          return [
            productId,
            {
              backgroundToken: getComputedStyle(root).getPropertyValue('--background').trim(),
              signatures: markers.map((element) => {
                const style = getComputedStyle(element)
                return [
                  style.color,
                  style.backgroundColor,
                  style.borderTopColor,
                  style.borderTopWidth,
                  style.boxShadow,
                  style.textDecorationLine,
                  style.fill,
                  style.stroke,
                ].join('|')
              }),
            },
          ]
        }),
      ),
    productIds,
  )
}

interface ForcedColorStyleProbe {
  readonly probeId: string
  readonly state: string | undefined
  readonly mode: string
  readonly color: string
  readonly background: string
  readonly backgroundImage: string
  readonly borderColor: string
  readonly borderStyle: string
  readonly borderWidth: string
  readonly outlineColor: string
  readonly outlineStyle: string
  readonly outlineWidth: string
  readonly decoration: string
  readonly fill: string
  readonly stroke: string
  readonly strokeDasharray: string
  readonly strokeWidth: string
  readonly width: string
  readonly height: string
  readonly contrast: number
  readonly labelled: boolean
}

export interface ForcedColorProbe {
  readonly cue: ForcedColorCue
  readonly passes: boolean
  readonly styles: readonly ForcedColorStyleProbe[]
}

export async function probeForcedColorCues(
  page: Page,
  cases: readonly { readonly productId: string; readonly cue: ForcedColorCue }[],
): Promise<Record<string, ForcedColorProbe>> {
  // Tag every candidate marker with a unique, stable selector BEFORE the
  // in-page evaluation below runs, so the Node side can come back afterwards
  // and take a REAL screenshot of each one (#264 review item 5): a marker's
  // resolved `fill`/`backgroundImage`/`stroke-dasharray` computed-style TEXT
  // is a proxy for "this looks different", and a mutation that collapses
  // every series to a flat `CanvasText` fill can still leave those other
  // CSS-property strings looking different from each other (a dot's radius,
  // an unrelated border) without the marker's actual PAINTED PIXELS having
  // changed at all. `redundantCue` below is therefore the element's own
  // screenshot signature — the set of distinct painted colours it actually
  // shows — which collapsing every fill to one flat colour makes IDENTICAL
  // across same-mode markers, correctly failing the check.
  await page.evaluate((scenarioCases: readonly { readonly productId: string }[]) => {
    let counter = 0
    for (const { productId } of scenarioCases) {
      const roots = document.querySelectorAll<HTMLElement>(`[data-product="${productId}"]`)
      for (const root of roots) {
        for (const marker of root.querySelectorAll<HTMLElement>('[data-forced-state]')) {
          marker.setAttribute('data-fc-probe-id', String(counter++))
        }
      }
    }
  }, cases)

  const evaluated = await page.evaluate((scenarioCases) => {
    const rgb = (value: string): [number, number, number] | null => {
      const match = value.match(
        /rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/,
      )
      if (match === null || Number(match[4] ?? 1) === 0) return null
      return [Number(match[1]), Number(match[2]), Number(match[3])]
    }
    const colors = (value: string): [number, number, number][] =>
      [...value.matchAll(/rgba?\([^)]*\)/g)]
        .map(([match]) => rgb(match))
        .filter((value): value is [number, number, number] => value !== null)
    const luminance = ([red, green, blue]: [number, number, number]): number => {
      const channel = (value: number): number => {
        const normalized = value / 255
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
    }
    const contrast = (
      first: [number, number, number],
      second: [number, number, number],
    ): number => {
      const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a)
      return (lighter! + 0.05) / (darker! + 0.05)
    }
    const backdrop = (element: Element): [number, number, number] | null => {
      let current: Element | null = element.parentElement
      while (current !== null) {
        const color = rgb(getComputedStyle(current).backgroundColor)
        if (color !== null) return color
        current = current.parentElement
      }
      return rgb(getComputedStyle(document.documentElement).backgroundColor)
    }

    return Object.fromEntries(
      scenarioCases.map(({ productId, cue }) => {
        const roots = [...document.querySelectorAll<HTMLElement>(`[data-product="${productId}"]`)]
        if (roots.length === 0) throw new Error(`Missing forced-colors fixture for ${productId}`)
        const markers = roots.flatMap((root) => [
          ...root.querySelectorAll<HTMLElement>('[data-forced-state]'),
        ])
        if (markers.length < 2) {
          throw new Error(`Forced-colors fixture for ${productId} needs two semantic states`)
        }
        const styles = markers.map((element) => {
          const style = getComputedStyle(element)
          const root = element.closest<HTMLElement>(`[data-product="${productId}"]`)
          if (root === null) throw new Error(`Detached forced-colors marker for ${productId}`)
          const state = element.dataset['forcedState']
          const mode =
            element.dataset['forcedMode'] ??
            element.closest<HTMLElement>('[data-forced-mode]')?.dataset['forcedMode'] ??
            root.dataset['coord'] ??
            'default'
          const labelKey = element.dataset['series'] ?? state
          const labelled =
            (element.getAttribute('aria-label')?.trim().length ?? 0) > 0 ||
            (labelKey !== undefined &&
              [...root.querySelectorAll<HTMLElement>('[data-forced-label]')].some(
                (label) =>
                  label.dataset['forcedLabel'] === labelKey &&
                  (label.textContent?.trim().length ?? 0) > 0,
              ))
          const paint =
            element instanceof SVGElement
              ? [...colors(style.fill), ...colors(style.stroke)]
              : [
                  ...colors(style.backgroundColor),
                  ...colors(style.backgroundImage),
                  ...colors(style.borderTopColor),
                ]
          const background = backdrop(element)
          const paintContrast =
            background === null || paint.length === 0
              ? 1
              : Math.max(...paint.map((color) => contrast(color, background)))
          return {
            probeId: element.getAttribute('data-fc-probe-id') ?? '',
            // Two markers of a DIFFERENT structural kind (a filled bar vs a
            // thin stroked line) are already visibly distinct from their
            // shape alone — grouping them together for the real pixel
            // signature check below would fail on geometry the check was
            // never meant to police. Grouping additionally by tag + mark
            // scopes the real-pixel comparison to markers that share a base
            // shape, which is exactly where a collapsed fill/pattern would
            // otherwise go unnoticed.
            kind: `${element.tagName}:${element.dataset['mark'] ?? ''}`,
            // A supplementary, STRUCTURAL half of the redundancy check,
            // alongside the real screenshot signature computed in Node: a
            // genuinely small element (a sparkline dot a few pixels across)
            // can carry a real, legitimate visual difference — a dashed vs
            // solid stroke ring — too fine for a downsampled screenshot to
            // resolve. Two markers pass the group check if EITHER their real
            // pixels differ OR these structural properties do; collapsing a
            // fill/pattern to one flat colour changes NEITHER on its own, so
            // the flagged regression (#264 review item 5) still fails.
            structuralSignature: [
              style.borderTopStyle,
              style.borderTopWidth,
              style.strokeDasharray,
              style.strokeWidth,
              style.backgroundImage,
              style.width,
              style.height,
            ].join('|'),
            state,
            mode,
            color: style.color,
            background: style.backgroundColor,
            backgroundImage: style.backgroundImage,
            borderColor: style.borderTopColor,
            borderStyle: style.borderTopStyle,
            borderWidth: style.borderTopWidth,
            outlineColor: style.outlineColor,
            outlineStyle: style.outlineStyle,
            outlineWidth: style.outlineWidth,
            decoration: style.textDecorationLine,
            fill: style.fill,
            stroke: style.stroke,
            strokeDasharray: style.strokeDasharray,
            strokeWidth: style.strokeWidth,
            width: style.width,
            height: style.height,
            contrast: paintContrast,
            labelled,
          }
        })
        const regular = styles.find(({ state }) => state === 'regular')
        const selected = styles.find(({ state }) => state === 'selected' || state === 'current')
        const error = styles.find(({ state }) => state === 'error')
        const comparison = styles.find(({ state }) => state !== 'error')
        const surfaces = roots.flatMap((root) => [
          ...root.querySelectorAll<HTMLElement>('svg,[data-part="track"],[data-forced-surface]'),
        ])
        const requiredModes = new Set(
          roots
            .flatMap((root) => (root.dataset['forcedRequiredModes'] ?? '').split(/\s+/))
            .filter(Boolean),
        )
        const actualModes = new Set(styles.map(({ mode }) => mode))
        const groups = new Map<string, typeof styles>()
        for (const style of styles) {
          const groupKey = `${style.mode}:${style.kind}`
          const group = groups.get(groupKey) ?? []
          group.push(style)
          groups.set(groupKey, group)
        }
        const passes =
          cue === 'outline-selection'
            ? regular !== undefined &&
              selected !== undefined &&
              selected.outlineStyle !== 'none' &&
              selected.outlineWidth !== '0px' &&
              `${selected.outlineColor}|${selected.outlineStyle}|${selected.outlineWidth}` !==
                `${regular.outlineColor}|${regular.outlineStyle}|${regular.outlineWidth}`
            : cue === 'underline-current'
              ? regular !== undefined &&
                selected !== undefined &&
                selected.decoration.includes('underline') &&
                !regular.decoration.includes('underline')
              : cue === 'status-error'
                ? error !== undefined &&
                  comparison !== undefined &&
                  error.borderStyle !== 'none' &&
                  (error.color !== comparison.color ||
                    error.borderColor !== comparison.borderColor ||
                    error.borderWidth !== comparison.borderWidth ||
                    error.decoration !== comparison.decoration)
                : cue === 'series-distinction'
                  ? // The GROUP redundancy check (do same-mode markers actually
                    // look pairwise different?) is proven from a real screenshot
                    // signature in Node, after this evaluation returns — see
                    // `probeForcedColorCues` below. A CSS-property string is a
                    // proxy that a mutation collapsing every fill to one flat
                    // colour can still satisfy via an unrelated property.
                    surfaces.length > 0 &&
                    surfaces.every(
                      (surface) => getComputedStyle(surface).forcedColorAdjust === 'none',
                    ) &&
                    [...requiredModes].every((mode) => actualModes.has(mode)) &&
                    styles.every(({ contrast, labelled }) => contrast >= 3 && labelled)
                  : new Set(styles.map(({ width, height }) => `${width}|${height}`)).size ===
                    styles.length
        const groupIds = [...groups.values()].map((group) =>
          group.map((s) => ({ probeId: s.probeId, structuralSignature: s.structuralSignature })),
        )
        const entry: {
          cue: typeof cue
          passes: boolean
          styles: typeof styles
          groupIds: { probeId: string; structuralSignature: string }[][]
        } = { cue, passes, styles, groupIds }
        return [productId, entry] as const
      }),
    )
  }, cases)

  const result: Record<string, ForcedColorProbe> = {}
  for (const [productId, entry] of Object.entries(evaluated)) {
    let passes = entry.passes
    if (entry.cue === 'series-distinction' && passes) {
      // Real screenshot signature per marker (#264 review item 5): a
      // mutation that collapses every series' fill/pattern to a flat
      // `CanvasText` makes same-mode markers' ACTUAL PAINTED PIXELS
      // identical, which this catches even when unrelated CSS properties
      // (a dot radius, an incidental border) still differ as text.
      for (const group of entry.groupIds) {
        if (group.length <= 1) continue
        const signatures = await Promise.all(
          group.map(async ({ probeId, structuralSignature }) => {
            const spatial = await paintedSpatialSignature(
              page.locator(`[data-fc-probe-id="${probeId}"]`),
            )
            return `${spatial}::${structuralSignature}`
          }),
        )
        if (new Set(signatures).size !== signatures.length) {
          passes = false
          break
        }
      }
    }
    result[productId] = { cue: entry.cue, passes, styles: entry.styles }
  }
  return result
}
