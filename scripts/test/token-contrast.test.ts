import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Browser } from 'playwright'
import { appEntry, compileCandidates, resolveCssId } from '../lib/tailwind-compile.mjs'
import { contrast, srgb8ToLinear } from '../lib/oklch.mjs'

/**
 * ─── Nothing in this repo measured token CONTRAST (#250) ─────────────────────
 *
 * Two AA regressions escaped every gate in one session, neither of them
 * involving a component:
 *
 *   1. `--destructive-foreground` was the only foreground token that did not
 *      invert in dark mode, so `bg-destructive text-destructive-foreground`
 *      measured 2.767:1 — near-white on a light red.
 *   2. Lowering the dark-media guard's specificity (#241) let a consumer's
 *      `:root`-only `--destructive` override win in dark mode, pinning the LIGHT
 *      red under the library's dark near-black foreground: 6.207:1 -> 3.750:1.
 *
 * `tailwind-classes.test.ts` asks whether a class produces a rule.
 * `registry-attrs.test.ts` asks whether a selector names an attribute a machine
 * publishes. Both are green on a pair nobody can read. This file is the third
 * question: does the pair the token contract DEFINES clear WCAG AA (4.5:1)?
 *
 * ─── Why a browser, when `chip-contrast.test.ts` deliberately avoids one ─────
 *
 * That test evaluates ONE recipe's arithmetic across 360 hues, and its inputs are
 * numbers in a stylesheet. This one asks a CASCADE question — which declaration
 * wins in which (preference x OS) cell — and a cascade has no arithmetic to
 * evaluate. Regression 2 above was purely a specificity outcome: every number
 * involved was unchanged and correct. Only a browser resolves that.
 *
 * ─── And why it is not `token-cascade.browser.test.ts` ───────────────────────
 *
 * `packages/components/test/styles/token-cascade.browser.test.ts` already sweeps
 * the same six cells in Chromium, and the two are complementary rather than
 * redundant: it asks WHICH DECLARATION WINS for a synthetic override, comparing
 * raw token STRINGS, and it is scoped to the library's own stylesheets. This one
 * asks whether the winner is LEGIBLE, and its inputs are the APP entry
 * stylesheets under `examples/` — outside that package, and reachable only
 * through the real Tailwind compile in `scripts/lib/tailwind-compile.mjs`. A
 * cascade can be entirely correct and still resolve to 2.767:1, which is
 * regression 1 exactly.
 *
 * ─── ALL SIX CELLS, not one ──────────────────────────────────────────────────
 *
 * Regression 2 failed in exactly one of them (`os=dark x pref=system`), because
 * that is the cell where no attribute and no class is present for a consumer's
 * `.dark` / `[data-theme='dark']` block to match — so only a twin block under
 * `prefers-color-scheme` can reach it. A single-cell probe would have measured
 * 6.199:1 and reported clean.
 *
 * ─── THE MEASUREMENT TECHNIQUE IS THE HARD PART ──────────────────────────────
 *
 * A uniformly ~1.00:1 table is the signature of a BROKEN INSTRUMENT, and two
 * independent lanes produced one before it was diagnosed. Four traps, all
 * measured in this repo, all defended against below:
 *
 *   - NEVER parse the computed string. CSS Color 4 syntaxes round-trip VERBATIM
 *     through `getComputedStyle()`: `oklch(0.58 0.22 27)` comes back unchanged,
 *     and `match(/[\d.]+/g)` reads it as sRGB — near-black for every token, so
 *     every ratio collapses toward 1. Legacy sRGB syntaxes DO normalize to
 *     `rgb(...)`, which is exactly what makes this easy to miss.
 *   - NEVER trust `canvas.fillStyle`'s round trip either: it returns `oklch()` /
 *     `oklab()` unchanged too. `fillStyle` is used below only to PAINT, never
 *     read back as a colour.
 *   - This fires where nobody wrote oklch: the derived tokens are `color-mix()`,
 *     which Chromium resolves TO `oklab()`.
 *   - So: paint the resolved value and read the PIXEL back (`fillRect` +
 *     `getImageData`). That byte is the only honest crossing from "what the
 *     browser resolved" to "a number".
 *
 * And two more about motion:
 *
 *   - A hidden tab freezes transitions and `getComputedStyle` reports the value
 *     a property is STUCK at; `requestAnimationFrame` never fires there at all.
 *   - The dangerous variant is PARTIAL: a rule transitioning `color` but not
 *     `background-color` froze the ink at its light value while the fill jumped
 *     to dark, the two coincided, and the probe reported a clean 1.000:1 for
 *     every element — which, unlike a frozen-value artifact, does not look
 *     broken. So transitions are KILLED outright rather than reasoned about,
 *     and a literal-colour canary proves the kill landed.
 *
 * Every one of those is asserted as an INSTRUMENT CHECK before any verdict is
 * read, because a guard that silently mismeasures is worse than no guard.
 *
 * ─── Source, not `dist/` ─────────────────────────────────────────────────────
 *
 * The demos render `@llui/components`'s BUILT `dist/styles/`, so a `src/` edit is
 * invisible to them until the package is rebuilt. This guard compiles through
 * `scripts/lib/tailwind-compile.mjs`, whose loader redirects `@llui/*` specifiers
 * to the workspace SOURCE for exactly that reason: the check describes the tree
 * as COMMITTED, not as last built.
 *
 * ─── Cost, and why it is safe in CI ──────────────────────────────────────────
 *
 * ~1.5-2.5 s of test time for the whole file, 4-5 s wall (one browser, six
 * contexts, two Tailwind compiles, twelve `setContent` + `evaluate` round
 * trips). Most of that is `getImageData`: every colour is resolved by painting
 * it, and the IACVT probes below triple the number of paints. CI's `verify` job
 * already runs inside `mcr.microsoft.com/playwright:v1.59.1-noble`, so Chromium
 * is present with no download, and `pnpm test:scripts` — the step that runs this
 * file — runs there too; no workflow change is needed.
 *
 * There is no timing, no `requestAnimationFrame`, no network and no layout read
 * anywhere in it, so there is nothing here to flake. That is not just an
 * argument: the whole 11 x 6 x 2 matrix was re-measured inside that exact
 * container image and came back BYTE-IDENTICAL to the macOS numbers at three
 * decimals, with all 48 instrument readings identical at six.
 *
 * Two honest limits on that evidence. The container run was **aarch64**, so it
 * evidences linux-vs-macOS and NOT x64-vs-arm; CI's runner is x64 and remains
 * UNVERIFIED (an amd64 run of the same image under emulation could not launch
 * Chromium — playwright's 180 s launch deadline expired). And the tightest
 * margin in the matrix, `destructive` at 4.570:1 in light mode, is **two** 8-bit
 * levels from the floor, not "several": measured, surface +2 gives 4.4917 and
 * ink -2 gives 4.4914, both already failing. What keeps that narrow margin
 * defensible is not the headroom but the rasteriser — playwright launches
 * Chromium with `--force-color-profile=srgb`, so the colour pipeline is pinned
 * rather than display-dependent.
 */

const ROOT = path.resolve(__dirname, '../..')
const TOKENS_DIR = path.join(ROOT, 'packages/components/src/styles')

/** WCAG 2.2 AA, normal text. */
const AA_NORMAL_TEXT = 4.5

/**
 * The surface/foreground pairs the token contract defines. Every one is a
 * `--x` / `--x-foreground` couple declared in `tokens.css` and overridden in
 * `tokens-dark.css`; `background` is the one whose ink is not named after it.
 *
 * SCOPE: this measures the CONTRACT, not what any component paints. A recipe is
 * free to ignore a foreground token — `registry/llui/ui/button.ts`'s destructive
 * variant is `bg-destructive text-white … dark:bg-destructive/60` and never
 * reads `--destructive-foreground` at all, so the tightest row here describes a
 * pair `registry-demo` does not actually render (what it does render measures
 * 4.77 light / 6.04 / 5.71 dark, clear). The contract is still the right thing
 * to gate: it is what a consumer's own `bg-x text-x-foreground` gets, and both
 * regressions #250 names were contract regressions with no component involved.
 */
const PAIRS = [
  'background',
  'card',
  'popover',
  'primary',
  'secondary',
  'muted',
  'accent',
  'destructive',
  'sidebar',
  'sidebar-primary',
  'sidebar-accent',
] as const

type Pair = (typeof PAIRS)[number]

const surfaceVar = (pair: Pair): string => `--${pair}`
const inkVar = (pair: Pair): string =>
  pair === 'background' ? '--foreground' : `--${pair}-foreground`

/**
 * PREFERENCE x OS, all six. `colorScheme` is the OS/browser preference the
 * `prefers-color-scheme` media query reads; `data-theme` is what `applyTheme()`
 * publishes for the user's own choice — absent for `'system'`, which is the cell
 * regression 2 lived in.
 *
 * `.dark` is deliberately NOT a cell: nothing in `@llui/components` ever writes
 * it (#242). It is supported for consumers whose own tooling writes it, and a
 * consumer that does has the same three preference states as these.
 */
const CELLS = [
  { name: 'os=light x pref=light', colorScheme: 'light', dataTheme: 'light' },
  { name: 'os=light x pref=dark', colorScheme: 'light', dataTheme: 'dark' },
  { name: 'os=light x pref=system', colorScheme: 'light', dataTheme: null },
  { name: 'os=dark x pref=light', colorScheme: 'dark', dataTheme: 'light' },
  { name: 'os=dark x pref=dark', colorScheme: 'dark', dataTheme: 'dark' },
  { name: 'os=dark x pref=system', colorScheme: 'dark', dataTheme: null },
] as const satisfies readonly {
  name: string
  colorScheme: 'light' | 'dark'
  dataTheme: 'light' | 'dark' | null
}[]

/**
 * Known sub-AA pairs, keyed `file: pair: cell` — the full triple, never a bare
 * pair name. `registry-attrs.test.ts` documents why: a bare-name key switches the
 * check off EVERYWHERE, and there it was measured to silence a real bug the test
 * existed to catch. A pair that is a deliberate upstream value in light mode says
 * nothing about the same pair in dark mode or in another app's palette.
 *
 * Every entry is CLOSED AT BOTH ENDS, and the lower end is not decoration. An
 * exemption stating only "below 4.5 is known here" approves every value below
 * 4.5, including ones nobody has ever seen: measured, with these six entries in
 * place but no floor, degrading `--muted-foreground` from `oklch(0.556 0 0)` to
 * `oklch(0.93 0 0)` took light-mode `muted` from 4.349:1 to 1.443:1 and the file
 * still reported 7 passed. That is exactly "an exemption sitting there ready to
 * approve a regression that has not happened yet" — the thing this allowlist
 * claims to prevent — so each entry carries the ratio it was MEASURED at, and a
 * reading below that floor fails like any other. The upper end is closed by the
 * obsolete-entry test below.
 */
type Exemption = { reason: string; atLeast: number }

const ALLOWED_BELOW_AA: Record<string, Exemption> = Object.fromEntries(
  ['examples/components-demo/src/main.css', 'examples/registry-demo/src/main.css'].flatMap((file) =>
    ['os=light x pref=light', 'os=light x pref=system', 'os=dark x pref=light'].map((cell) => [
      `${file}: muted: ${cell}`,
      {
        // shadcn/ui's own light values, ported verbatim (`--muted` oklch(0.97 0 0),
        // `--muted-foreground` oklch(0.556 0 0)). `--muted-foreground` is the
        // SECONDARY-text token — captions, placeholders, help text — and upstream
        // sizes it at that contrast deliberately. Raising it would fork the palette
        // from every shadcn theme, screenshot and generator, which is the parity
        // the registry is built on. Dark mode clears AA (5.857:1); this is a
        // light-mode-only shortfall of 0.15.
        reason:
          'shadcn/ui upstream value for secondary text; changing it forks the palette from every shadcn theme',
        // Measured 4.349:1 in all three light cells, on both demos.
        atLeast: 4.34,
      },
    ]),
  ),
)

/** One measured cell of the matrix. */
type Reading = {
  file: string
  pair: Pair
  cell: string
  ratio: number
  surface: readonly [number, number, number]
  ink: readonly [number, number, number]
}

type Probe = {
  visibility: string
  dataTheme: string | null
  transitionCanary: string
  rejected: string[]
  undeclared: string[]
  unresolved: string[]
  instrument: { label: string; ink: [number, number, number]; surface: [number, number, number] }[]
  pairs: { pair: string; ink: [number, number, number]; surface: [number, number, number] }[]
}

/**
 * Everything below runs INSIDE the page. Kept as one string-serialised function
 * so the whole colour-resolution path — cascade, `var()` substitution,
 * `color-mix()` resolution, gamut mapping, rasterisation — happens where the
 * browser does it, and only 8-bit sRGB bytes cross back.
 */
function probeInPage(input: {
  pairs: { pair: string; surfaceVar: string; inkVar: string }[]
  instrument: { label: string; surface: string; ink: string }[]
}): Probe {
  // Kill EVERY transition and animation. Not "the ones that look relevant": a
  // rule that transitions `color` but not `background-color` is the variant that
  // reports a clean 1.000:1 instead of looking broken.
  const kill = document.createElement('style')
  kill.textContent =
    '*,*::before,*::after{transition:none !important;animation:none !important;-webkit-transition:none !important}'
  document.head.appendChild(kill)

  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (ctx === null) throw new Error('no 2d context')

  const rejected: string[] = []

  /**
   * Paint `value` over an opaque `base` and read the composited pixel back.
   *
   * Compositing on the canvas rather than in arithmetic afterwards means a
   * translucent token (`--border` is `oklch(1 0 0 / 10%)`) resolves the way the
   * screen shows it, with no second implementation of source-over to get wrong.
   *
   * Validity is detected with TWO sentinels: an invalid `fillStyle` assignment
   * is a silent no-op that leaves the previous value in place, so painting from
   * two different starting colours and comparing the results separates "the
   * browser resolved this" from "the browser ignored this". Comparing
   * `ctx.fillStyle` against the input string cannot do that job — it returns
   * `oklch()` / `oklab()` verbatim.
   */
  function paintOver(base: [number, number, number], value: string): [number, number, number] {
    const read = (sentinel: string): [number, number, number] => {
      ctx!.clearRect(0, 0, 1, 1)
      ctx!.fillStyle = sentinel
      ctx!.fillRect(0, 0, 1, 1)
      ctx!.fillStyle = `rgb(${base[0]} ${base[1]} ${base[2]})`
      ctx!.fillRect(0, 0, 1, 1)
      ctx!.fillStyle = sentinel
      ctx!.fillStyle = value
      ctx!.fillRect(0, 0, 1, 1)
      const d = ctx!.getImageData(0, 0, 1, 1).data
      return [d[0]!, d[1]!, d[2]!]
    }
    const a = read('#ff00ff')
    const b = read('#00ff00')
    if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) {
      rejected.push(value)
      return a
    }
    return a
  }

  const WHITE: [number, number, number] = [255, 255, 255]

  /** Resolve a pair as the page actually paints it: surface over the document's
   * own background, ink over that surface. */
  function measure(surfaceValue: string, inkValue: string) {
    const surface = paintOver(rootBackground, surfaceValue)
    const ink = paintOver(surface, inkValue)
    return { surface, ink }
  }

  const rootBackground = paintOver(WHITE, getComputedStyle(document.body).backgroundColor)

  // The literal-colour canary: no `var()`, no token, no Tailwind. If the kill
  // above did not land — or the tab is hidden and freezing transitions — this
  // element reports something other than the value just assigned.
  const canary = document.createElement('div')
  canary.style.transition = 'background-color 5s linear'
  canary.style.backgroundColor = 'red'
  document.body.appendChild(canary)
  void canary.offsetWidth
  canary.style.backgroundColor = 'blue'
  const transitionCanary = getComputedStyle(canary).backgroundColor

  // The probe sits inside a WRAPPER so the ink check below can vary what
  // `color` inherits — see `unresolved`.
  const wrapper = document.createElement('div')
  document.body.appendChild(wrapper)
  const probe = document.createElement('div')
  wrapper.appendChild(probe)
  const resolve = (property: string, expression: string): string => {
    probe.style.setProperty(property, expression)
    const out = getComputedStyle(probe).getPropertyValue(property)
    probe.style.removeProperty(property)
    return out
  }
  /** Resolve every `color: <expression>` under ONE chosen inherited ink.
   *
   * Batched rather than per-pair on purpose: writing `wrapper.style.color`
   * invalidates inherited colour for the subtree, so a set/read/restore per pair
   * forces a full style recalc against the app's whole compiled stylesheet each
   * time. Measured: interleaving the two sentinels took the file from ~0.5 s to
   * ~10 s; two writes per page puts it back. */
  const resolveInksUnder = (inherited: string): string[] => {
    wrapper.style.color = inherited
    const out = input.pairs.map(({ inkVar }) => resolve('color', `var(${inkVar})`))
    wrapper.style.removeProperty('color')
    return out
  }

  // A `var()` naming a token nobody declares is INVALID AT COMPUTED-VALUE TIME,
  // not an error: `background-color` falls back to its initial `transparent` and
  // `color` to the inherited ink, so a renamed or deleted token would be measured
  // as something plausible rather than reported. Read the custom properties off
  // the root and require each to be declared.
  const rootStyle = getComputedStyle(document.documentElement)
  const undeclared = input.pairs
    .flatMap(({ surfaceVar, inkVar }) => [surfaceVar, inkVar])
    .filter((name) => rootStyle.getPropertyValue(name).trim() === '')

  // …and the check above covers only HALF its own stated mechanism, because a
  // custom property holds an arbitrary token stream: a token DECLARED with a
  // non-colour value (`--card: oklch(1 0 0)px`) is declared, so it passes, and
  // still goes invalid at computed-value time. Measured: that one typo in
  // `tokens.css` left all seven tests green while the probe silently measured
  // `--background` in place of `--card`.
  //
  // Both halves of the fallback are observable if you vary what the fallback
  // would BE — the same two-sentinel idea `paintOver` uses one level up:
  //
  //   SURFACE — the fallback is `transparent`, which paints nothing, so the
  //     reading is whatever sits behind it. Paint the resolved value over two
  //     different bases and require the same pixel. That doubles as a real
  //     constraint rather than a trick: a translucent SURFACE would make the
  //     measured ratio a fiction about whatever happens to be underneath, so all
  //     eleven are required to be opaque. (`--border` is legitimately
  //     translucent and is deliberately not one of them.)
  //   INK — `color` is INHERITED, so the fallback is the surrounding ink, which
  //     on these pages is `--foreground`: entirely plausible, and wrong. Resolve
  //     it under two different inherited inks and require the same answer.
  const BLACK: [number, number, number] = [0, 0, 0]
  const unresolved: string[] = []

  const inksUnderMagenta = resolveInksUnder('rgb(255, 0, 255)')
  const inksUnderGreen = resolveInksUnder('rgb(0, 255, 0)')

  const pairs = input.pairs.map(({ pair, surfaceVar, inkVar }, i) => {
    const surfaceValue = resolve('background-color', `var(${surfaceVar})`)
    const overWhite = paintOver(WHITE, surfaceValue)
    const overBlack = paintOver(BLACK, surfaceValue)
    if (overWhite.join() !== overBlack.join())
      unresolved.push(
        `${surfaceVar} does not resolve to an opaque colour (computed "${surfaceValue}") — ` +
          `a declared-but-invalid value falls back to transparent`,
      )

    const inkA = inksUnderMagenta[i]!
    const inkB = inksUnderGreen[i]!
    if (inkA !== inkB)
      unresolved.push(
        `${inkVar} resolves to the INHERITED ink rather than a colour of its own ` +
          `("${inkA}" / "${inkB}") — a declared-but-invalid value falls back to inherit`,
      )

    return { pair, ...measure(surfaceValue, inkA) }
  })

  return {
    visibility: document.visibilityState,
    dataTheme: document.documentElement.getAttribute('data-theme'),
    transitionCanary,
    rejected,
    undeclared,
    unresolved,
    instrument: input.instrument.map(({ label, surface, ink }) => ({
      label,
      ...measure(surface, ink),
    })),
    pairs,
  }
}

/**
 * Instrument checks. Each one crosses the SAME path a real reading does — page
 * cascade, paint, pixel readback, `contrast()` — so a break anywhere in it
 * reddens here before any token verdict is believed.
 */
const INSTRUMENT = [
  // The canonical 21:1 pair. Legacy sRGB normalizes through `getComputedStyle`,
  // so this is the one a naive string parser gets right — and it is deliberately
  // NOT the only check, because black and white are FIXED POINTS of the sRGB
  // transfer function (0 and 1 map to themselves). Measured: replacing the
  // gamma decode with a bare `n / 255` leaves all three 21:1 rows EXACTLY 21:1
  // and is caught only by the mid-tone row at the bottom of this list.
  { label: 'literal #000 on #fff', surface: '#ffffff', ink: '#000000', expect: 21 },
  // CSS Color 4. A naive `match(/[\d.]+/g)` reads `oklch(1 0 0)` as rgb(1,0,0)
  // and `oklch(0 0 0)` as rgb(0,0,0) — two near-blacks, ~1.0:1. This is the
  // check that separates a real table from the uniformly-wrong one.
  { label: 'oklch white on oklch black', surface: 'oklch(0 0 0)', ink: 'oklch(1 0 0)', expect: 21 },
  // `color-mix()` resolves TO `oklab()` in Chromium, which is how the trap above
  // reaches stylesheets that contain no oklch at all — every derived token here
  // is one of these.
  {
    label: 'color-mix white on color-mix black',
    surface: 'color-mix(in oklab, black 100%, white)',
    ink: 'color-mix(in oklab, white 100%, black)',
    expect: 21,
  },
  // Alpha, composited by the PAINT rather than by arithmetic afterwards — a
  // token can carry it (`--border` is `oklch(1 0 0 / 10%)`), and a probe that
  // dropped the alpha channel would read every translucent value as opaque.
  //
  // 25%, not 50%: 0.75 x 255 = 191.25 rounds to 191 unambiguously, where 127.5
  // is implementation-defined and would make this canary flip on a Chromium
  // rounding change rather than on a real one. rgb(191,191,191) on white is
  // 1.838893:1.
  {
    label: '25% black over white',
    surface: '#ffffff',
    ink: 'rgb(0 0 0 / 25%)',
    expect: 1.838893,
  },
] as const

/** Both readings are 8-bit sRGB TRIPLES — the arity is the part that matters,
 * because a `number[]` here is a length nobody checked and the conversion is a
 * fixed 3x3. `Reading` and `Probe` above both already say so. */
const ratioOf = (reading: {
  surface: readonly [number, number, number]
  ink: readonly [number, number, number]
}): number => contrast(srgb8ToLinear(reading.surface), srgb8ToLinear(reading.ink))

/** Every `@import` in a stylesheet, comments stripped first — `theme.css`
 * DOCUMENTS four imports in its header comment that it does not perform, and a
 * naive scan follows all of them.
 *
 * Today that stripping is DEFENSIVE ONLY, and saying so is the honest version:
 * every commented `@import` currently in the tree names a file the walk reaches
 * anyway, so removing the strip changes no verdict. Keep it — a documented
 * import of something the file does NOT import is exactly the shape a header
 * comment grows — but do not cite it as load-bearing. */
function importsOf(css: string): string[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...withoutComments.matchAll(/@import\s+(?:url\()?['"]([^'"]+)['"]/g)].map((m) => m[1]!)
}

/** Does this entry stylesheet transitively reach the library's token files? */
async function reachesTokens(entry: string): Promise<boolean> {
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    if (path.dirname(file) === TOKENS_DIR && /^tokens.*\.css$/.test(path.basename(file)))
      return true
    let css: string
    try {
      css = await readFile(file, 'utf8')
    } catch {
      continue
    }
    for (const id of importsOf(css)) {
      try {
        queue.push(resolveCssId(id, path.dirname(file)))
      } catch {
        // A specifier this repo's loader cannot resolve cannot reach the tokens
        // either; the compile below fails loudly on it if it matters.
      }
    }
  }
  return false
}

async function cssFilesUnder(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await cssFilesUnder(full)))
    else if (entry.name.endsWith('.css')) out.push(full)
  }
  return out
}

/** Every app stylesheet in the repo that transitively imports the tokens.
 * DISCOVERED, not listed: an example that starts importing the theme is covered
 * the day it does, which is the failure mode `registry-demo` had under
 * `tailwind-classes.test.ts` before it was added there by hand. */
async function tokenConsumingEntries(): Promise<string[]> {
  const roots = (await readdir(path.join(ROOT, 'examples'), { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => path.join(ROOT, 'examples', e.name, 'src'))
  const files: string[] = []
  for (const root of roots) {
    try {
      files.push(...(await cssFilesUnder(root)))
    } catch {
      // an example with no `src/` — nothing to measure
    }
  }
  const entries: string[] = []
  for (const file of files.sort()) if (await reachesTokens(file)) entries.push(file)
  return entries
}

describe('design-token contrast (#250)', () => {
  let browser: Browser
  const readings: Reading[] = []
  const instrumentReadings: { cell: string; file: string; label: string; ratio: number }[] = []
  const pageFacts: { cell: string; file: string; probe: Probe }[] = []
  let entries: string[] = []

  beforeAll(async () => {
    entries = await tokenConsumingEntries()

    const compiled = new Map<string, string>()
    for (const entry of entries) {
      const { css } = await compileCandidates([], appEntry(entry))
      compiled.set(entry, css)
    }

    browser = await chromium.launch({ headless: true })
    try {
      for (const cell of CELLS) {
        const context = await browser.newContext({ colorScheme: cell.colorScheme })
        const page = await context.newPage()
        for (const entry of entries) {
          const rel = path.relative(ROOT, entry)
          const attr = cell.dataTheme === null ? '' : ` data-theme="${cell.dataTheme}"`
          await page.setContent(
            `<!doctype html><html${attr}><head><meta charset="utf-8"><style>${compiled.get(entry)}</style></head><body></body></html>`,
          )
          const probe = (await page.evaluate(probeInPage, {
            pairs: PAIRS.map((pair) => ({
              pair,
              surfaceVar: surfaceVar(pair),
              inkVar: inkVar(pair),
            })),
            instrument: INSTRUMENT.map(({ label, surface, ink }) => ({ label, surface, ink })),
          })) as Probe
          pageFacts.push({ cell: cell.name, file: rel, probe })
          for (const [i, entryReading] of probe.instrument.entries())
            instrumentReadings.push({
              cell: cell.name,
              file: rel,
              label: INSTRUMENT[i]!.label,
              ratio: ratioOf(entryReading),
            })
          for (const measured of probe.pairs)
            readings.push({
              file: rel,
              pair: measured.pair as Pair,
              cell: cell.name,
              ratio: ratioOf(measured),
              surface: measured.surface,
              ink: measured.ink,
            })
        }
        await context.close()
      }
    } finally {
      await browser.close()
    }

    // The full matrix, on demand — how the #250 baseline is RECORDED rather than
    // assumed, and the first thing to look at when a verdict surprises you:
    //
    //   LLUI_CONTRAST_REPORT=1 pnpm test:scripts --disable-console-intercept
    //
    // The flag is not optional. vitest buffers a hook's console output and prints
    // it only for a FAILING file, so on a green run the table silently never
    // appears.
    if (process.env['LLUI_CONTRAST_REPORT']) {
      for (const file of entries.map((e) => path.relative(ROOT, e))) {
        console.log(`\n${file}`)
        console.log(['pair'.padEnd(16), ...CELLS.map((c) => c.name.padStart(23))].join(''))
        for (const pair of PAIRS) {
          const row = CELLS.map((c) => {
            const r = readings.find((x) => x.file === file && x.pair === pair && x.cell === c.name)
            return (r === undefined ? '—' : r.ratio.toFixed(3)).padStart(23)
          })
          console.log([pair.padEnd(16), ...row].join(''))
        }
      }
    }
    // 3 minutes: 6 Chromium contexts x N entry stylesheets, plus a real Tailwind
    // compile per entry. `vitest.scripts.config.ts` does not merge
    // `vitest.shared.ts` (#249), so this file gets the 5 s DEFAULT rather than
    // the workspace's 30 s — the budget is stated here so it does not depend on
    // that being fixed.
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
  })

  it('discovers every app stylesheet that imports the tokens', () => {
    // Vacuity guard: an `@import` walk that silently stopped resolving would make
    // every assertion below pass over an empty matrix.
    expect(entries.length).toBeGreaterThanOrEqual(2)
    expect(readings.length).toBe(entries.length * PAIRS.length * CELLS.length)
  })

  it('measures its own instrument before trusting any reading', () => {
    // A uniformly ~1.00:1 table is the signature of a broken instrument, not a
    // finding. These four readings are taken through the identical path, so a
    // colour that never reached the rasteriser, a string parsed instead of
    // painted, or broken ratio arithmetic reddens HERE.
    expect(instrumentReadings.length).toBe(CELLS.length * entries.length * INSTRUMENT.length)
    const wrong = instrumentReadings.filter((r) => {
      const expected = INSTRUMENT.find((i) => i.label === r.label)!.expect
      return Math.abs(r.ratio - expected) > 0.001
    })
    expect(
      wrong.map((r) => `${r.file} [${r.cell}] ${r.label}: ${r.ratio.toFixed(4)}`),
      'the contrast instrument is not measuring what it claims to',
    ).toEqual([])
  })

  it('measures a visible page with no transition in flight', () => {
    // A hidden tab freezes transitions and reports the value a property is STUCK
    // at, and `requestAnimationFrame` never fires there at all. The canary is a
    // literal red -> blue with no `var()` and no Tailwind: if it does not read
    // blue, the transition kill did not land and every reading below is suspect.
    const bad = pageFacts.filter(
      (f) => f.probe.visibility !== 'visible' || f.probe.transitionCanary !== 'rgb(0, 0, 255)',
    )
    expect(
      bad.map(
        (f) => `${f.file} [${f.cell}]: ${f.probe.visibility}, canary ${f.probe.transitionCanary}`,
      ),
      'the page was hidden or a transition was still in flight',
    ).toEqual([])
  })

  it('resolves every token expression it paints', () => {
    // `fillStyle` ignores an invalid assignment silently, so a token that
    // resolved to nothing would otherwise be measured as whatever was on the
    // canvas before it.
    const bad = pageFacts.filter((f) => f.probe.rejected.length > 0)
    expect(
      bad.map((f) => `${f.file} [${f.cell}]: ${f.probe.rejected.join(', ')}`),
      'the browser rejected a colour this guard tried to paint',
    ).toEqual([])

    // A `var()` naming a token that does not exist resolves to transparent (or
    // to the inherited ink) rather than failing, so a renamed token would be
    // measured as something plausible instead of reported.
    const missing = pageFacts.filter((f) => f.probe.undeclared.length > 0)
    expect(
      missing.map((f) => `${f.file} [${f.cell}]: ${f.probe.undeclared.join(', ')}`),
      'a pair names a custom property the stylesheet never declares',
    ).toEqual([])

    // The other half of the same mechanism: a token that IS declared but holds a
    // non-colour value is equally invalid at computed-value time, and falls back
    // to transparent (surface) or to the inherited ink (foreground) — both of
    // which measure as something plausible. See the note in `probeInPage`.
    const iacvt = pageFacts.filter((f) => f.probe.unresolved.length > 0)
    expect(
      iacvt.map((f) => `${f.file} [${f.cell}]: ${f.probe.unresolved.join('; ')}`),
      'a pair token is declared but does not resolve to a colour of its own',
    ).toEqual([])
  })

  it('applies the preference each cell claims to test', () => {
    // Cheap, and it is the difference between six cells and one measured six
    // times: `setContent` writing the attribute is an assumption until asserted.
    const bad = pageFacts.filter((f) => {
      const cell = CELLS.find((c) => c.name === f.cell)!
      return f.probe.dataTheme !== cell.dataTheme
    })
    expect(bad.map((f) => `${f.file} [${f.cell}]: data-theme=${f.probe.dataTheme}`)).toEqual([])
  })

  it('every surface/foreground pair clears AA in all six preference x OS cells', () => {
    const failures = readings
      .filter((r) => r.ratio < AA_NORMAL_TEXT)
      .flatMap((r) => {
        const key = `${r.file}: ${r.pair}: ${r.cell}`
        const where = `${key} — ${r.ratio.toFixed(3)}:1 (ink rgb(${r.ink}) on rgb(${r.surface}))`
        const exemption = ALLOWED_BELOW_AA[key]
        if (exemption === undefined) return [where]
        // An exemption names the ratio it was MEASURED at, not merely "under
        // 4.5". Without this arm the entry approves every value below the floor,
        // 1.443:1 included — measured.
        if (r.ratio < exemption.atLeast)
          return [`${where} — BELOW its exemption floor of ${exemption.atLeast}:1`]
        return []
      })
    expect(
      failures,
      `These token pairs are below ${AA_NORMAL_TEXT}:1:\n${failures.join('\n')}`,
    ).toEqual([])
  })

  it('has no obsolete allowlist entry', () => {
    // An exemption that no longer describes a real shortfall is an exemption
    // sitting there ready to approve a regression that has not happened yet.
    const below = new Set(
      readings
        .filter((r) => r.ratio < AA_NORMAL_TEXT)
        .map((r) => `${r.file}: ${r.pair}: ${r.cell}`),
    )
    const stale = Object.keys(ALLOWED_BELOW_AA).filter((key) => !below.has(key))
    expect(
      stale,
      `These allowlist entries no longer describe a sub-AA pair:\n${stale.join('\n')}`,
    ).toEqual([])
  })
})
