/**
 * Accessibility exemptions for the per-case gate, CLOSED AT BOTH ENDS (the
 * `token-contrast` / `registry-attrs` discipline, docs/agents/styling.md):
 *
 *   - keyed by case (`caseKey()`: `<path>/<entry>/<case>/<overrides>`), never
 *     by rule alone — a bare-rule key would switch the rule off for every
 *     component;
 *   - each entry names the rule AND a substring of the offending selector, so
 *     a NEW node failing the same rule on the same case is still reported;
 *   - a `color-contrast` entry names the ratio it was MEASURED at
 *     (`atLeast`): a regression below it is reported, not excused;
 *   - each carries a reason;
 *   - an entry whose finding no longer occurs on its case is reported as
 *     OBSOLETE, so an exemption cannot outlive the thing it describes.
 *
 * A real violation is a bug to fix in the component, skin or renderer. The
 * two families below are the only findings the #268 audit did not fix, and
 * each is a decision this repository had already made and measured.
 */
import type { AxeFinding } from './axe'
import { caseKey, type GalleryCase } from './matrix'

export interface A11yExemption {
  /** The axe rule id. */
  readonly rule: string
  /** A substring of the finding's target selector. */
  readonly target: string
  /** `color-contrast` only: the lowest ratio this entry excuses. */
  readonly atLeast?: number
  readonly reason: string
}

/**
 * shadcn/ui's own light `--muted-foreground` on `--muted` (4.349:1): the ONE
 * sub-AA token pair, already allowlisted in `scripts/test/token-contrast.test.ts`
 * (key `…: muted: <light cell>`, `atLeast: 4.34`) for exactly these two
 * documents. Avatar fallback initials and `Kbd` are upstream's verbatim
 * recipes on that pair; raising the token forks the palette from every
 * shadcn theme. Dark mode clears AA and is not exempted.
 */
const MUTED_PAIR: A11yExemption = {
  rule: 'color-contrast',
  target: '',
  atLeast: 4.34,
  reason:
    "shadcn's light muted pair (4.349:1), the allowlisted token-contrast exception — see scripts/test/token-contrast.test.ts",
}

/**
 * A `role="menu"` is an `aria-activedescendant` composite: its content takes
 * programmatic focus on open (`tabindex="-1"`) and arrow keys move the
 * highlight, scrolling it into view — the keyboard route axe's
 * `scrollable-region-focusable` heuristic cannot see (it wants a tab stop or
 * a focusable descendant, and APG menus deliberately have neither). The
 * route is proved instead of assumed: `interaction.browser.test.ts`
 * (`menu › … › overflow`) arrows to the last item and asserts it scrolled
 * into view, on both paths.
 */
const ACTIVEDESCENDANT_SCROLL = (target: string): A11yExemption => ({
  rule: 'scrollable-region-focusable',
  target,
  reason:
    'aria-activedescendant menu: focused on open, scrolled by arrow keys (proved by the interaction gate)',
})

const muted = (target: string): A11yExemption => ({ ...MUTED_PAIR, target })

/** Keyed by `caseKey()`. */
export const A11Y_EXEMPTIONS: Readonly<Record<string, readonly A11yExemption[]>> = {
  'baseline/avatar/loading/default': [muted('span')],
  'baseline/avatar/loaded/default': [muted('span')],
  'baseline/avatar/fallback/default': [muted('span')],
  'baseline/avatar/compact/default': [muted('span')],
  'registry/avatar/loading/default': [muted('span')],
  'registry/avatar/loaded/default': [muted('span')],
  'registry/avatar/fallback/default': [muted('span')],
  'registry/avatar/compact/default': [muted('span')],
  'registry/kbd/chord/default': [muted('.h-5.w-fit')],
  'baseline/menu/overflow/default': [ACTIVEDESCENDANT_SCROLL('#m\\:content')],
  'registry/menu/overflow/default': [ACTIVEDESCENDANT_SCROLL('#rm\\:content')],
}

/** The contrast ratio axe measured, from its failure summary. */
export function measuredContrast(finding: AxeFinding): number | undefined {
  const match = /insufficient color contrast of ([\d.]+)/.exec(finding.summary)
  return match === null ? undefined : Number(match[1])
}

export function applyExemptions(
  galleryCase: GalleryCase,
  findings: readonly AxeFinding[],
  exemptions: Readonly<Record<string, readonly A11yExemption[]>> = A11Y_EXEMPTIONS,
): { remaining: AxeFinding[]; obsolete: string[] } {
  const key = caseKey(galleryCase)
  const own = exemptions[key] ?? []
  const used = new Set<A11yExemption>()
  const remaining = findings.filter((finding) => {
    const match = own.find((exemption) => {
      if (exemption.rule !== finding.rule || !finding.target.includes(exemption.target)) {
        return false
      }
      if (exemption.atLeast === undefined) return true
      const ratio = measuredContrast(finding)
      return ratio !== undefined && ratio >= exemption.atLeast
    })
    if (match === undefined) return true
    used.add(match)
    return false
  })
  const obsolete = own
    .filter((exemption) => !used.has(exemption))
    .map((exemption) => `${exemption.rule} @ ${key} (${exemption.target})`)
  return { remaining, obsolete }
}
