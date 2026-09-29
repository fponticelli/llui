import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { component, mountApp, path as svgPath, svg, text, type Mountable } from '@llui/dom'
import type { Browser } from 'playwright'
import * as avatarMachine from '@llui/components/avatar'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileCandidates } from '../../scripts/lib/tailwind-compile.mjs'
import { extractClassCandidates } from '../../scripts/lib/registry-classes.mjs'
import { Avatar, AvatarBadge, AvatarFallback } from '../llui/ui/avatar'
import { useHermeticBrowser } from '../../scripts/lib/hermetic-browser.mjs'

const hermetic = useHermeticBrowser()

/**
 * #264 review BLOCK 1: `AvatarBadge`'s default rung used to be a
 * `group-data-[size=default]/avatar:` variant, tied at EQUAL specificity
 * against `group-data-[density=compact]/avatar:` the moment a machine-wired
 * instance carries BOTH attributes at once (`data-size` is always defaulted
 * by `classPartWithDefaults`, `data-density` is published by the machine) —
 * measured, the compiled stylesheet resolved that tie back to the DEFAULT
 * look (badge 10px) rather than the COMPACT one (8px), silently un-mapping
 * density for exactly the sub-part shape this file's own #264 F5 fix claimed
 * to cover.
 *
 * A follow-up review LOW found the same class of bug one rung over:
 * `size=lg` + `density=compact` resolved NON-DETERMINISTICALLY — root/badge
 * WIDTH happened to follow `lg`, but the badge's icon visibility and the
 * fallback's font size did not, resolving to `compact`'s instead, a tie
 * broken by Tailwind's internal declaration order rather than anything
 * this file states. Every density-driven declaration is now a genuine
 * compound selector gated on `data-size=default`, so an explicit `sm`/`lg`
 * deterministically wins by construction. This sweeps EVERY avatar sub-part
 * (root, badge, badge's icon visibility, fallback text) across the FULL
 * size x density matrix a real `avatar.connect()` + the registry skin can
 * produce, against a REAL Chromium layout — never a hand-typed class string.
 */

const ROOT = resolve(import.meta.dirname, '../..')

interface Case {
  readonly name: string
  readonly dataSize?: 'sm' | 'default' | 'lg'
  readonly density?: avatarMachine.AvatarDensity
  readonly expect: {
    readonly root: number
    readonly badge: number
    readonly svgHidden: boolean
    readonly fallbackFontPx: number
  }
}

// The FULL 3 (data-size: defaulted/sm/lg) x 3 (density: none/comfortable/
// compact) matrix — #264 review LOW: `size=lg` + `density=compact` used to
// resolve NON-DETERMINISTICALLY (root/badge WIDTH happened to follow `lg`,
// but the badge's icon visibility and the fallback's font size did NOT,
// resolving to `compact`'s instead — a tie broken by Tailwind's internal
// declaration order, invisible from the source). Every density-driven
// declaration is now gated on `data-size=default` as a genuine compound
// selector, so an EXPLICIT `sm`/`lg` deterministically wins over density —
// by construction, not by stylesheet-order luck — which this full matrix
// exists to pin for every combination, not only the two the original
// regression happened to hit.
const CASES: readonly Case[] = [
  {
    name: 'default size, no density (bare, static render)',
    expect: { root: 32, badge: 10, svgHidden: false, fallbackFontPx: 14 },
  },
  {
    name: 'default size, density=comfortable',
    density: 'comfortable',
    expect: { root: 32, badge: 10, svgHidden: false, fallbackFontPx: 14 },
  },
  {
    name: 'default size, density=compact (the original regression case)',
    density: 'compact',
    expect: { root: 24, badge: 8, svgHidden: true, fallbackFontPx: 12 },
  },
  {
    name: 'data-size=sm, no density',
    dataSize: 'sm',
    expect: { root: 24, badge: 8, svgHidden: true, fallbackFontPx: 12 },
  },
  {
    name: 'data-size=sm, density=comfortable (explicit size wins)',
    dataSize: 'sm',
    density: 'comfortable',
    expect: { root: 24, badge: 8, svgHidden: true, fallbackFontPx: 12 },
  },
  {
    name: 'data-size=sm, density=compact (both agree)',
    dataSize: 'sm',
    density: 'compact',
    expect: { root: 24, badge: 8, svgHidden: true, fallbackFontPx: 12 },
  },
  {
    name: 'data-size=lg, no density',
    dataSize: 'lg',
    expect: { root: 40, badge: 12, svgHidden: false, fallbackFontPx: 14 },
  },
  {
    name: 'data-size=lg, density=comfortable (explicit size wins)',
    dataSize: 'lg',
    density: 'comfortable',
    expect: { root: 40, badge: 12, svgHidden: false, fallbackFontPx: 14 },
  },
  {
    name: 'data-size=lg, density=compact (deterministic tie-break: explicit lg must win)',
    dataSize: 'lg',
    density: 'compact',
    expect: { root: 40, badge: 12, svgHidden: false, fallbackFontPx: 14 },
  },
]

interface HostState {
  avatar: avatarMachine.AvatarState
}
type HostMsg = { type: 'avatar'; msg: avatarMachine.AvatarMsg }

function avatarHtml(caseId: string, dataSize: Case['dataSize'], density: Case['density']): string {
  const host = document.createElement('div')
  document.body.append(host)
  const app = mountApp(
    host,
    component<HostState, HostMsg>({
      name: `AvatarGeometryFixture:${caseId}`,
      init: () => [{ avatar: avatarMachine.init() }, []],
      update: (state, msg) => [
        { ...state, avatar: avatarMachine.update(state.avatar, msg.msg)[0] },
        [],
      ],
      view: ({ state, send }): readonly Mountable[] => {
        const parts = avatarMachine.connect(
          state.at('avatar'),
          (msg) => send({ type: 'avatar', msg }),
          { alt: 'Jane Doe', density },
        )
        const rootProps: Record<string, unknown> = { ...parts.root, id: caseId }
        if (dataSize !== undefined) rootProps['data-size'] = dataSize
        return [
          Avatar(rootProps as never, [
            AvatarFallback({ ...parts.fallback }, [text('JD')]),
            AvatarBadge({}, [svg({ viewBox: '0 0 10 10' }, [svgPath({ d: 'M0 0 L10 10' })])]),
          ]),
        ]
      },
    }),
  )
  const out = host.innerHTML
  app.dispose()
  host.remove()
  return out
}

describe('avatar geometry across data-size x data-density (#264 review BLOCK 1)', () => {
  let browser: Browser
  let tailwind: string
  let html: string

  beforeAll(async () => {
    const avatarSource = readFileSync(resolve(ROOT, 'registry/llui/ui/avatar.ts'), 'utf8')
    const candidates = extractClassCandidates(
      resolve(ROOT, 'registry/llui/ui/avatar.ts'),
      avatarSource,
    )
    const compiled = await compileCandidates(candidates)
    expect(compiled.dead).toEqual([])
    tailwind = compiled.css
    html = CASES.map((c) =>
      avatarHtml(c.name.replace(/[^a-z0-9]/gi, '-'), c.dataSize, c.density),
    ).join('\n')
    browser = await hermetic.launch({ headless: true })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
  })

  afterEach(() => {
    document.body.replaceChildren()
  })

  it.each(CASES)('$name', async (c) => {
    const page = await browser.newPage()
    try {
      await page.setContent(`<!doctype html><style>${tailwind}</style>${html}`)
      const caseId = c.name.replace(/[^a-z0-9]/gi, '-')
      const measured = await page.evaluate((id) => {
        const root = document.getElementById(id)!
        // Render order in this fixture is fallback first, badge second (see
        // `avatarHtml`'s view above) — addressed structurally, never by a
        // hand-typed class/attribute guess.
        const fallbackEl = root.children[0] as HTMLElement
        const badgeEl = root.children[1] as HTMLElement
        const svgEl = badgeEl.querySelector('svg') as SVGElement
        return {
          root: root.getBoundingClientRect().width,
          badge: badgeEl.getBoundingClientRect().width,
          svgDisplay: getComputedStyle(svgEl).display,
          fallbackFontPx: Number.parseFloat(getComputedStyle(fallbackEl).fontSize),
        }
      }, caseId)
      expect(measured.root, `${c.name}: root width`).toBe(c.expect.root)
      expect(measured.badge, `${c.name}: badge width`).toBe(c.expect.badge)
      expect(measured.svgDisplay === 'none', `${c.name}: badge svg hidden`).toBe(c.expect.svgHidden)
      expect(measured.fallbackFontPx, `${c.name}: fallback font size`).toBe(c.expect.fallbackFontPx)
    } finally {
      await page.close()
    }
  })
})
