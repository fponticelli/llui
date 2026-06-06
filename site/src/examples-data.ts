/**
 * Single source of truth for the example mini-apps published on the site.
 *
 * Consumed by:
 *  - `src/generate-examples.ts` — turns each example's README into a doc page
 *  - `src/build-examples.ts`    — builds each app and copies it into the deploy
 *  - `pages/examples/@name/+route.ts` + `+onBeforePrerenderStart.ts` — routing
 *
 * `slug` is both the `examples/<slug>` source directory and the URL segment.
 * Live apps are served (static, pre-built) at `/apps/<slug>/`; the documentation
 * page that frames each app lives at `/examples/<slug>`.
 */
export interface ExampleMeta {
  /** Source directory under `examples/` and the URL segment. */
  slug: string
  /** pnpm package name (the `--filter` target) used to build the app. */
  pkg: string
  /** Human title shown in the nav, cards, and page heading. */
  title: string
  /** One-line blurb used on cards and as the page meta description. */
  blurb: string
  /**
   * Vike apps can't take Vite's `--base`/`--outDir` CLI flags (Vike's CLI
   * wrapper rejects unknown options), so build-examples passes those via the
   * `LLUI_BASE`/`LLUI_OUT` env vars, which their `vite.config.ts` reads. Plain
   * SPAs use the flags directly.
   */
  vike?: boolean
}

export const EXAMPLES: ExampleMeta[] = [
  {
    slug: 'counter',
    pkg: '@llui/example-counter',
    title: 'Counter',
    blurb: 'The smallest possible LLui app — increment, decrement, reset.',
  },
  {
    slug: 'todomvc',
    pkg: '@llui/example-todomvc',
    title: 'TodoMVC',
    blurb: 'The classic TodoMVC reference app: add, toggle, filter, clear.',
  },
  {
    slug: 'form-validation',
    pkg: '@llui/example-form-validation',
    title: 'Form Validation',
    blurb: 'A sign-up form with Zod schema validation and live field errors.',
  },
  {
    slug: 'components-demo',
    pkg: '@llui/example-components-demo',
    title: 'Components Demo',
    blurb: 'A gallery of the headless @llui/components primitives.',
  },
  {
    slug: 'dashboard',
    pkg: '@llui/example-dashboard',
    title: 'Dashboard',
    blurb: 'KPI cards, animated charts, a reorderable list, locale + theme switching.',
  },
  {
    slug: 'i18n-lazy',
    pkg: '@llui/example-i18n-lazy',
    title: 'i18n + Lazy',
    blurb: 'Four-locale switching (with RTL) and a lazily code-split module.',
  },
  {
    slug: 'virtualization',
    pkg: '@llui/example-virtualization',
    title: 'Virtualization',
    blurb: 'A 50,000-row log viewer that keeps only visible rows in the DOM.',
  },
  {
    slug: 'github-explorer',
    pkg: 'github-explorer',
    title: 'GitHub Explorer',
    blurb: 'Routed GitHub browser with search, file tree, and agent affordances.',
  },
  {
    slug: 'vike-layout',
    pkg: '@llui/example-vike-layout',
    title: 'Vike Layout (SSR)',
    blurb: 'Persistent nested layouts with @llui/vike, prerendered to static HTML.',
    vike: true,
  },
]

/** Just the URL segments — used by the dynamic route + prerender enumerator. */
export const EXAMPLE_SLUGS: string[] = EXAMPLES.map((e) => e.slug)
