/**
 * The Iconify glyphs the repo's browser pages request, answered locally by the
 * hermetic network policy (`scripts/lib/network-policy.mjs`) instead of by
 * `api.iconify.design` — for `pnpm smoke:examples` AND for every browser test
 * suite (`scripts/lib/hermetic-browser.mjs`). One fixture, one decision
 * function: the smoke and the tests cannot drift into two copies.
 *
 * The bodies are STAND-INS, not the real artwork: what the smoke and the tests
 * check is that the runtime path works — `@llui/components/icon`'s batching
 * (one request per prefix), the response parse, the allowlist sanitizer and the
 * paint into the `<svg>` host — and nothing looks at glyph pixels. Each body is
 * derived from its NAME alone, so the fixture is deterministic and needs no
 * network to regenerate, and it follows each set's paint convention (Lucide
 * strokes, the others fill) because that is what the sanitizer and a recipe's
 * `fill-*` hooks see.
 *
 * The set is EXACT in both directions. A glyph a page asks for that is not
 * here is an `unexpected` request, which fails the smoke or the test that made
 * it. An entry nobody asks for is stale, and that direction is checked in two
 * halves, because no single run sees every request:
 *
 *  - the smoke boots every example's FIRST PAINT, so it fails on any entry no
 *    first paint requested — except the entries in `AFTER_FIRST_PAINT`, which
 *    a page requests only after an interaction the smoke never performs (a
 *    toast of each type, raised by a browser suite). The smoke also fails if
 *    one of those IS requested at first paint: the split is exact too.
 *  - each `AFTER_FIRST_PAINT` entry must be NAMED in the source that renders
 *    it (`scripts/test/network-policy.test.ts`), so deleting the glyph from
 *    the demo makes its fixture entry fail as stale without a browser.
 *
 * `notFound` lists names the demos request ON PURPOSE to exercise the
 * missing-glyph path (an empty box plus one console warning); the fixture
 * reports them under `not_found`, the way the real API does.
 */

/**
 * @typedef {object} IconifyFixtureSet
 * @property {number} width
 * @property {number} height
 * @property {Readonly<Record<string, string>>} icons
 * @property {readonly string[]} notFound
 */

/**
 * A small deterministic integer in [0, mod) from a glyph name.
 * @param {string} name
 * @param {number} mod
 * @returns {number}
 */
function seed(name, mod) {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 9973
  return hash % mod
}

/**
 * A stroked stand-in in Lucide's normalized form (paint on the body).
 * @param {string} name
 * @returns {string}
 */
function stroked(name) {
  const inset = 3 + seed(name, 4)
  const span = 24 - inset * 2
  return `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="${span}" height="${span}" x="${inset}" y="${inset}" rx="2"/><path d="M${inset} ${inset}l${span} ${span}"/></g>`
}

/**
 * A filled stand-in, as the filled sets (simple-icons, mdi, …) normalize.
 * @param {string} name
 * @returns {string}
 */
function filled(name) {
  const r = 6 + seed(name, 5)
  return `<path fill="currentColor" d="M12 ${12 - r}a${r} ${r} 0 1 0 0 ${r * 2}a${r} ${r} 0 1 0 0-${r * 2}z"/>`
}

/**
 * @param {readonly string[]} names
 * @param {(name: string) => string} body
 * @param {readonly string[]} [notFound]
 * @returns {IconifyFixtureSet}
 */
function set(names, body, notFound = []) {
  return {
    width: 24,
    height: 24,
    icons: Object.fromEntries(names.map((name) => [name, body(name)])),
    notFound,
  }
}

/** @type {Readonly<Record<string, IconifyFixtureSet>>} */
export const ICONIFY_FIXTURE = {
  // `examples/registry-demo`: the glyphs its shadcn-shaped components bake in,
  // plus its Icons page's "any glyph, by name" row.
  lucide: set(
    [
      'bell',
      'calendar',
      'check',
      'chevron-down',
      'chevron-left',
      'chevron-right',
      'chevron-up',
      'circle',
      'circle-alert',
      'circle-check',
      'flame',
      'folder',
      'grip-vertical',
      'heart',
      'info',
      'layout-dashboard',
      'loader-circle',
      'minus',
      'palette',
      'rocket',
      'search',
      'settings-2',
      'sparkles',
      'star',
      'triangle-alert',
      'x',
      'zap',
    ],
    stroked,
    // The Icons page's "A name that does not exist" row.
    ['not-a-real-icon'],
  ),
  'simple-icons': set(['cloudflare', 'github', 'typescript'], filled),
  mdi: set(['language-typescript'], filled),
  'material-symbols': set(['rocket-launch'], filled),
}

/**
 * Entries a page requests only AFTER an interaction the smoke does not perform
 * — see the header. Each is reached by a browser suite, and each must be named
 * (`prefix:name`) in the source that renders it.
 *
 * @type {ReadonlySet<string>}
 */
export const AFTER_FIRST_PAINT = new Set([
  // Sonner's per-type glyphs (`registry/llui/ui/icons.ts`), shown only once a
  // toast of that type is raised — `registry/test/toast-live-demos.browser.test.ts`.
  'lucide:circle-alert',
  'lucide:circle-check',
  'lucide:info',
  'lucide:triangle-alert',
])
