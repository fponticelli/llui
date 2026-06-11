import { div, nav, a, span, button, text, details, summary, onMount } from '@llui/dom'
import type { Signal, Send } from '@llui/dom'
import { EXAMPLES } from '../examples-data'
import { PACKAGES, PACKAGE_CATEGORIES } from '../../pages/api/@pkg/packages'
import type { PackageMeta } from '../../pages/api/@pkg/packages'

export type LayoutMsg = { type: 'toggleMenu' }

// Page slugs under the Guide section — used to decide whether the section is
// auto-expanded for the current page (Examples/Packages derive theirs from
// EXAMPLES/PACKAGES; this static set has no other source of truth).
const GUIDE_SLUGS = [
  'index',
  'getting-started',
  'cookbook',
  'composition-patterns',
  'publishing-a-precompiled-library',
  'architecture',
  'benchmarks',
  'changelog',
]

/**
 * Site chrome wrapper — header, sidebar nav, content slot, footer.
 *
 * `slug` is static per page (drives the active nav link), so it stays a plain
 * string. `menuOpen` is reactive (the burger toggles it), so it arrives as a
 * `Signal<boolean>`. `content` is the already-built page node array.
 */
export function siteLayout({
  slug,
  menuOpen,
  send,
  content,
}: {
  slug: Signal<string>
  menuOpen: Signal<boolean>
  send: Send<LayoutMsg>
  content: Node[]
}): Node {
  // Wire theme toggle button after mount (self-contained — no component state)
  onMount(() => {
    setupThemeToggle()
  })

  return div({ class: 'site-layout' }, [
    // Header
    div({ class: 'site-header' }, [
      a({ href: '/', class: 'site-logo' }, [text('LLui')]),
      div({ class: 'site-header-actions' }, [
        button(
          {
            class: 'theme-toggle',
            id: 'theme-toggle',
            type: 'button',
            'aria-label': 'Toggle theme',
            title: 'Toggle theme',
          },
          [span({ class: 'theme-icon' }, [text('☽')])],
        ),
        button(
          {
            type: 'button',
            class: 'menu-toggle',
            'aria-label': 'Toggle navigation menu',
            onClick: () => send({ type: 'toggleMenu' }),
          },
          [text('☰')],
        ),
      ]),
    ]),

    div({ class: 'site-body' }, [
      // Sidebar nav
      nav(
        {
          class: menuOpen.map((open) => `site-nav${open ? ' open' : ''}`),
          'aria-label': 'Main navigation',
        },
        [
          // Every top-level section is a collapsible <details> (zero JS). All are
          // collapsed by default; the section (and, for Packages, the family)
          // containing the current page is auto-expanded via a reactive `open`
          // binding so the active link is always visible.
          navSection('Guide', slug, GUIDE_SLUGS, [
            navLink('/', 'index', 'Home', slug),
            navLink('/getting-started', 'getting-started', 'Getting Started', slug),
            navLink('/cookbook', 'cookbook', 'Cookbook', slug),
            navLink('/composition-patterns', 'composition-patterns', 'Composition Patterns', slug),
            navLink(
              '/publishing-a-precompiled-library',
              'publishing-a-precompiled-library',
              'Publishing a Library',
              slug,
            ),
            navLink('/architecture', 'architecture', 'Architecture', slug),
            navLink('/benchmarks', 'benchmarks', 'Benchmarks', slug),
            navLink('/changelog', 'changelog', 'Changelog', slug),
          ]),
          navSection(
            'AI Integration',
            slug,
            ['debugging', 'agents'],
            [
              navLink('/debugging', 'debugging', 'Debugging', slug),
              navLink('/agents', 'agents', 'Agents', slug),
            ],
          ),
          // Generated from EXAMPLES (single source of truth) so adding an example
          // to examples-data.ts adds its sidebar link automatically.
          navSection(
            'Examples',
            slug,
            ['examples', ...EXAMPLES.map((ex) => `examples/${ex.slug}`)],
            [
              navLink('/examples', 'examples', 'Overview', slug),
              ...EXAMPLES.map((ex) =>
                navLink(`/examples/${ex.slug}`, `examples/${ex.slug}`, ex.title, slug),
              ),
            ],
          ),
          // Generated from PACKAGES (the same single source of truth that drives
          // the `/api/<pkg>` routes) so a new package page gets its sidebar link
          // automatically and the two can never drift apart. Chunked into the
          // families declared by PACKAGE_CATEGORIES, each a nested collapsible
          // <details> so the 20-package list reads as a handful of scannable
          // groups.
          navSection(
            'Packages',
            slug,
            PACKAGES.map((p) => `api/${p.slug}`),
            PACKAGE_CATEGORIES.flatMap((cat) => {
              const pkgs = PACKAGES.filter((p) => p.category === cat.id)
              if (pkgs.length === 0) return []
              const memberSlugs = pkgs.map((p) => `api/${p.slug}`)
              return [
                details(
                  {
                    class: 'nav-group',
                    open: slug.map((current) => memberSlugs.includes(current)),
                  },
                  [
                    summary({ class: 'nav-subsection' }, [text(cat.label)]),
                    ...pkgs.map((pkg) => pkgNavLink(pkg, slug)),
                  ],
                ),
              ]
            }),
          ),
        ],
      ),

      // Main content
      div({ class: 'site-content-area' }, content),
    ]),

    // Footer
    div({ class: 'site-footer' }, [
      text('LLui — MIT License · '),
      a({ href: 'https://github.com/fponticelli/llui', class: 'footer-link' }, [text('GitHub')]),
      text(' · '),
      a({ href: '/llms.txt', class: 'footer-link' }, [text('llms.txt')]),
      text(' · '),
      a({ href: '/llms-full.txt', class: 'footer-link' }, [text('llms-full.txt')]),
    ]),
  ])
}

type ThemePref = 'light' | 'dark' | 'system'

function readStoredTheme(): ThemePref {
  try {
    const v = localStorage.getItem('llui-theme')
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // ignore
  }
  return 'system'
}

function resolvedTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'dark') return 'dark'
  if (pref === 'light') return 'light'
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

function setupThemeToggle(): void {
  const btn = document.getElementById('theme-toggle')
  if (!btn) return

  // Avoid double-binding on client navigation
  if (btn.dataset.wired === 'true') {
    updateIcon(btn, readStoredTheme())
    return
  }
  btn.dataset.wired = 'true'

  updateIcon(btn, readStoredTheme())

  btn.addEventListener('click', () => {
    const current = readStoredTheme()
    // Cycle: system → dark → light → system
    const next: ThemePref = current === 'system' ? 'dark' : current === 'dark' ? 'light' : 'system'
    try {
      localStorage.setItem('llui-theme', next)
    } catch {
      // ignore
    }
    if (next === 'system') {
      document.documentElement.removeAttribute('data-theme')
    } else {
      document.documentElement.dataset.theme = next
    }
    updateIcon(btn, next)
  })
}

function updateIcon(btn: HTMLElement, pref: ThemePref): void {
  const icon = btn.querySelector('.theme-icon')
  if (!icon) return
  // ☽ = dark, ☀ = light, ◐ = system
  const resolved = resolvedTheme(pref)
  icon.textContent = pref === 'system' ? '◐' : resolved === 'dark' ? '☽' : '☀'
  btn.title = `Theme: ${pref}`
  btn.setAttribute('aria-label', `Theme: ${pref}. Click to switch.`)
}

function navLink(href: string, slug: string, label: string, currentSlug: Signal<string>): Node {
  return a(
    {
      href,
      class: currentSlug.map((current) => (current === slug ? 'nav-link active' : 'nav-link')),
      'aria-current': currentSlug.map((current) => (current === slug ? 'page' : undefined)),
    },
    [text(label)],
  )
}

/**
 * Package link in the sidebar — richer than a plain nav link: the name is
 * rendered as a code identifier with a dimmed `@llui/` scope, a per-family
 * colour accent (via `data-cat`, styled in styles.css), and a one-line blurb
 * underneath so the long package list is scannable at a glance.
 */
function pkgNavLink(pkg: PackageMeta, currentSlug: Signal<string>): Node {
  const slug = `api/${pkg.slug}`
  return a(
    {
      href: `/api/${pkg.slug}`,
      class: currentSlug.map((current) => (current === slug ? 'nav-pkg active' : 'nav-pkg')),
      'aria-current': currentSlug.map((current) => (current === slug ? 'page' : undefined)),
      'data-cat': pkg.category,
    },
    [
      span({ class: 'nav-pkg-name' }, [
        span({ class: 'nav-pkg-scope' }, [text('@llui/')]),
        text(pkg.slug),
      ]),
      span({ class: 'nav-pkg-blurb' }, [text(pkg.blurb)]),
    ],
  )
}

/**
 * A collapsible top-level sidebar section — a native <details> whose <summary>
 * is the section header. Collapsed by default; auto-expanded (via a reactive
 * `open` binding) when the current page's slug is one of `memberSlugs`, so the
 * active link is always visible.
 */
function navSection(
  label: string,
  currentSlug: Signal<string>,
  memberSlugs: readonly string[],
  children: Node[],
): Node {
  return details(
    {
      class: 'nav-group nav-group-section',
      open: currentSlug.map((current) => memberSlugs.includes(current)),
    },
    [summary({ class: 'nav-section' }, [text(label)]), ...children],
  )
}
