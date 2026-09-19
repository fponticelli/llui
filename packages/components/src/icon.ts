import {
  currentDoc,
  isSignalHandle,
  mountable,
  onMount,
  registerBinding,
  svg,
  type ElProps,
  type Mountable,
  type Signal,
} from '@llui/dom'

/**
 * Any Iconify glyph as a real `<svg>`, fetched by `prefix:name`.
 *
 * `icon('lucide:star')` renders one of Iconify's ~200k glyphs — `lucide`,
 * `mdi`, `simple-icons`, `heroicons`, any set the API serves. The name may be a
 * `Signal<string>`, in which case the glyph follows it: a change clears the box
 * and paints the new body once it arrives.
 *
 * Three properties of this module are load-bearing, and each has a cost:
 *
 *  - **Icons are ASYNC.** An SSR render emits the empty `<svg>` box and the
 *    glyph arrives after hydration. The box is sized and `viewBox`-ed up front
 *    so nothing reflows when it does.
 *  - **They need the NETWORK.** A CSP that does not allow `api.iconify.design`,
 *    or an offline consumer, gets the empty box and no error. Point
 *    {@link iconConfig} at a self-hosted Iconify to remove the third-party
 *    dependency; the API is the same.
 *  - **The response is UNTRUSTED MARKUP.** An SVG body can carry `<script>`, an
 *    `href`, or an `onload` handler, so it is never assigned to `innerHTML`.
 *    Every node is REBUILT from an element and attribute allowlist, which fails
 *    closed: an element or attribute nobody thought about is dropped rather
 *    than passed through.
 *
 * A real `<svg>` element is what ends up in the DOM — not an `<img>` and not
 * the `iconify-icon` web component. Both of those would break every
 * `[&_svg:not([class*='size-'])]:size-4` hook in a shadcn-style recipe,
 * silently, so the registry's skins can size and colour the glyph the way
 * upstream does.
 *
 * The glyph carries NO size and NO paint of its own. Iconify normalizes paint
 * into the BODY — lucide's elements carry `fill="none" stroke="currentColor"`,
 * a filled set's carry `fill="currentColor"` — so a default on the wrapper
 * would silently ruin every other set (a filled `mdi` path inheriting a 2px
 * stroke renders as a blob). Size it from the caller's `class`.
 */

/** Where glyphs are fetched from. Point this at a self-hosted Iconify to drop
 *  the third-party CDN; the path shape is identical. */
export const iconConfig = { api: 'https://api.iconify.design' }

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Geometry-only. `use` is absent on purpose (it can reference an external
 * document), and so is every element that can load or run something.
 */
const ALLOWED_TAGS = new Set([
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
])

/**
 * Presentation and geometry only. No `href`/`xlink:href`, no `style` (it can
 * carry a `url()`), no `id`/`class` (they would leak into the consumer's
 * cascade), and nothing beginning with `on`.
 */
const ALLOWED_ATTRS = new Set([
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'width',
  'height',
  'points',
  'transform',
  'fill',
  'fill-rule',
  'fill-opacity',
  'clip-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
])

/** One resolved glyph: its body markup and the box it was drawn in. */
export interface IconData {
  body: string
  width: number
  height: number
}

const cache = new Map<string, Promise<IconData | null>>()
const pending = new Map<string, Map<string, (data: IconData | null) => void>>()

/** Split `prefix:name`; an unprefixed name is a Lucide glyph. */
function parseName(name: string): { prefix: string; glyph: string } {
  const colon = name.indexOf(':')
  return colon === -1
    ? { prefix: 'lucide', glyph: name }
    : { prefix: name.slice(0, colon), glyph: name.slice(colon + 1) }
}

/**
 * Resolve one glyph, batched: one HTTP request per PREFIX per tick, not one per
 * icon. A page rendering a dozen chevrons asks Iconify once; the batch is
 * flushed on a macrotask so every icon mounted during the same view build joins
 * it. Exposed so a consumer can warm the cache ahead of a mount.
 */
export function loadIcon(name: string): Promise<IconData | null> {
  const { prefix, glyph } = parseName(name)
  const key = `${prefix}:${glyph}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  const promise = new Promise<IconData | null>((resolve) => {
    let batch = pending.get(prefix)
    if (batch === undefined) {
      batch = new Map()
      pending.set(prefix, batch)
      setTimeout(() => void flush(prefix), 0)
    }
    batch.set(glyph, resolve)
  }).then((data) => {
    // A FAILURE IS NOT CACHED. Only a resolved glyph is kept, so a request lost
    // to a dropped connection or a cold proxy is retried by the next icon that
    // wants it, instead of turning one bad moment into a blank box for the
    // lifetime of the page. The cost is bounded and visible: a genuinely
    // missing name re-requests once per mount, which is a warning per mount
    // rather than a silent permanent hole.
    if (data === null) cache.delete(key)
    return data
  })
  cache.set(key, promise)
  return promise
}

async function flush(prefix: string): Promise<void> {
  const batch = pending.get(prefix)
  if (batch === undefined) return
  pending.delete(prefix)
  const names = [...batch.keys()]
  try {
    const url = `${iconConfig.api}/${encodeURIComponent(prefix)}.json?icons=${names
      .map(encodeURIComponent)
      .join(',')}`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const payload = (await response.json()) as {
      width?: number
      height?: number
      icons?: Record<string, { body?: string; width?: number; height?: number }>
    }
    const setWidth = typeof payload.width === 'number' ? payload.width : 24
    const setHeight = typeof payload.height === 'number' ? payload.height : 24
    for (const [name, resolve] of batch) {
      const entry = payload.icons?.[name]
      if (entry === undefined || typeof entry.body !== 'string') {
        // A typo resolves to an empty box, which is indistinguishable from a
        // network failure by looking at it — say so once, or a misspelled glyph
        // is a blank space nobody can explain.
        console.warn(
          `[icon] "${prefix}:${name}" was not found. Check the name at https://icon-sets.iconify.design/${prefix}/`,
        )
        resolve(null)
        continue
      }
      resolve({
        body: entry.body,
        width: typeof entry.width === 'number' ? entry.width : setWidth,
        height: typeof entry.height === 'number' ? entry.height : setHeight,
      })
    }
  } catch (error) {
    console.warn(`[icon] could not load "${prefix}" from ${iconConfig.api}:`, error)
    for (const resolve of batch.values()) resolve(null)
  }
}

/** Rebuild one node from the allowlists. Returns `null` for anything not on
 *  them, so an unknown element takes its whole subtree with it. */
function sanitize(node: Element): SVGElement | null {
  const tag = node.tagName.toLowerCase()
  if (!ALLOWED_TAGS.has(tag)) return null
  const out = document.createElementNS(SVG_NS, tag)
  for (const attr of Array.from(node.attributes)) {
    const attrName = attr.name.toLowerCase()
    if (ALLOWED_ATTRS.has(attrName)) out.setAttribute(attrName, attr.value)
  }
  for (const child of Array.from(node.children)) {
    const safe = sanitize(child)
    if (safe !== null) out.appendChild(safe)
  }
  return out
}

function paint(host: SVGElement, data: IconData): void {
  // `image/svg+xml` rather than `text/html`: it never runs anything, and a
  // malformed body yields a <parsererror> we can detect instead of a silently
  // reinterpreted tree.
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="${SVG_NS}">${data.body}</svg>`,
    'image/svg+xml',
  )
  if (doc.getElementsByTagName('parsererror').length > 0) return
  const fragment = document.createDocumentFragment()
  for (const child of Array.from(doc.documentElement.children)) {
    const safe = sanitize(child)
    if (safe !== null) fragment.appendChild(safe)
  }
  host.setAttribute('viewBox', `0 0 ${data.width} ${data.height}`)
  host.replaceChildren(fragment)
}

let seq = 0

/**
 * Render one Iconify glyph as a real `<svg>`.
 *
 * `name` is `prefix:name` (`'lucide:star'`, `'simple-icons:github'`; a bare
 * name is a Lucide glyph) or a `Signal<string>` of one, in which case the glyph
 * follows the signal. `props` spread onto the `<svg>`; `class` is passed through
 * as given, so a caller sizes and colours the glyph from there.
 */
export function icon(name: string | Signal<string>, props?: ElProps): Mountable {
  // `onMount` hands a callback the BUILD's root container, NOT the element the
  // call sits inside — mounts are collected per build (a view, an arm, an
  // `each` row) and every callback in one gets the same container. So this
  // cannot just take the argument and treat it as the `<svg>`: it is whatever
  // the enclosing component mounted into. A per-instance marker is how the
  // element finds itself again.
  const marker = `i${++seq}`

  // The two halves meet here. The name binding commits FIRST (binding commits
  // run before `runMounts`) and stores the current name; the mount callback
  // then finds the host and paints. On a later name change the binding has
  // the host already and repaints directly.
  let host: SVGElement | null = null
  let current: string | undefined
  let live = true
  // Monotonic request token: a slow response for the PREVIOUS name must not
  // land after the next one has already painted.
  let token = 0

  const request = (): void => {
    if (host === null || current === undefined) return
    const mine = ++token
    void loadIcon(current).then((data) => {
      if (!live || mine !== token || host === null || data === null) return
      paint(host, data)
    })
  }

  const nameBinding = mountable(() => {
    const spec = isSignalHandle(name)
      ? { deps: name.deps, produce: name.produce }
      : { deps: [], produce: () => name }
    registerBinding(spec.deps, spec.produce, (value) => {
      const next = String(value)
      if (next === current) return
      current = next
      // Clear the previous glyph so a slow fetch never shows the wrong icon
      // under the new name.
      host?.replaceChildren()
      request()
    })
    return currentDoc().createComment('icon')
  })

  return svg(
    {
      'aria-hidden': 'true',
      // The box before the glyph arrives. Iconify's own set default is 24×24
      // and `paint` corrects it per icon, so nothing reflows for the common
      // case and an odd-sized glyph settles on its first paint.
      viewBox: '0 0 24 24',
      ...props,
      'data-icon': marker,
    },
    [
      nameBinding,
      // Placed in the child array, so it registers — a discarded `onMount`
      // Mountable registers nothing. Under SSR it is not registered at all,
      // which is what keeps `fetch` and `DOMParser` off the server.
      onMount((root) => {
        const selector = `svg[data-icon="${marker}"]`
        const found = root.matches(selector) ? root : root.querySelector(selector)
        if (!(found instanceof SVGElement)) return
        host = found
        request()
        return () => {
          live = false
        }
      }),
    ],
  )
}
