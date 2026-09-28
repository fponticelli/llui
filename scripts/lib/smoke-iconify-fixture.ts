/**
 * The Iconify glyphs the built examples request, answered locally by the smoke
 * test (`scripts/lib/smoke-network.ts`) instead of by `api.iconify.design`.
 *
 * The bodies are STAND-INS, not the real artwork: the smoke test checks that
 * the runtime path works — `@llui/components/icon`'s batching (one request per
 * prefix), the response parse, the allowlist sanitizer and the paint into the
 * `<svg>` host — and never looks at pixels. Each body is derived from its NAME
 * alone, so the fixture is deterministic and needs no network to regenerate,
 * and it follows each set's paint convention (Lucide strokes, the others fill)
 * because that is what the sanitizer and a recipe's `fill-*` hooks see.
 *
 * The set is EXACT in both directions, checked by the smoke run itself against
 * what the examples actually request: a glyph a demo asks for that is not here
 * fails the smoke (`unexpected`), and an entry no demo asks for fails it as
 * stale. `notFound` lists names the demos request ON PURPOSE to exercise the
 * missing-glyph path (an empty box plus one console warning); the fixture
 * reports them under `not_found`, the way the real API does.
 */

export interface IconifyFixtureSet {
  readonly width: number
  readonly height: number
  readonly icons: Readonly<Record<string, string>>
  readonly notFound: readonly string[]
}

/** A small deterministic integer in [0, mod) from a glyph name. */
function seed(name: string, mod: number): number {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 9973
  return hash % mod
}

/** A stroked stand-in in Lucide's normalized form (paint on the body). */
function stroked(name: string): string {
  const inset = 3 + seed(name, 4)
  const span = 24 - inset * 2
  return `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="${span}" height="${span}" x="${inset}" y="${inset}" rx="2"/><path d="M${inset} ${inset}l${span} ${span}"/></g>`
}

/** A filled stand-in, as the filled sets (simple-icons, mdi, …) normalize. */
function filled(name: string): string {
  const r = 6 + seed(name, 5)
  return `<path fill="currentColor" d="M12 ${12 - r}a${r} ${r} 0 1 0 0 ${r * 2}a${r} ${r} 0 1 0 0-${r * 2}z"/>`
}

function set(
  names: readonly string[],
  body: (name: string) => string,
  notFound: readonly string[] = [],
): IconifyFixtureSet {
  return {
    width: 24,
    height: 24,
    icons: Object.fromEntries(names.map((name) => [name, body(name)])),
    notFound,
  }
}

export const ICONIFY_FIXTURE: Readonly<Record<string, IconifyFixtureSet>> = {
  // `examples/registry-demo`: the fifteen glyphs its shadcn-shaped components
  // bake in, plus its Icons page's "any glyph, by name" row.
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
      'flame',
      'folder',
      'grip-vertical',
      'heart',
      'layout-dashboard',
      'loader-circle',
      'minus',
      'palette',
      'rocket',
      'search',
      'settings-2',
      'sparkles',
      'star',
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
