import { onMount, svg, type ElProps, type Mountable } from '@llui/dom'
import { mergeClass } from '@/lib/utils'

/**
 * The icon set shadcn/ui's components render, loaded from Iconify by name.
 *
 * shadcn imports these from `lucide-react` and BAKES them into the components —
 * `SelectTrigger` renders its own chevron, `Checkbox` its own tick, `DialogClose`
 * its own ✕. A port that copies only the class recipes gets components with
 * `[&_svg]` sizing hooks and nothing to hook, which is exactly why our Select
 * once rendered as a bare box with a text arrow.
 *
 * The geometry used to be inlined here. It now comes from the Iconify HTTP API
 * by `prefix:name`, so any of its ~200k glyphs is one `icon('lucide:star')`
 * away instead of a hand-copied path. THIS IS A BREAKING CHANGE with real
 * consequences, and they are the reason for most of the code below:
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
 * A real `<svg>` element is still what ends up in the DOM — not an `<img>` and
 * not the `iconify-icon` web component. Both of those would break every
 * `[&_svg:not([class*='size-'])]:size-4` hook in the recipes, silently, in
 * exactly the way a `data-slot` left un-rewritten does.
 *
 * The glyphs deliberately carry NO size class. Every recipe already sizes its
 * icons with that hook, which applies only when the icon has not sized itself —
 * so leaving it off is what lets the recipe win, and passing `class: 'size-3'`
 * is what lets a caller override it.
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

interface IconData {
  body: string
  width: number
  height: number
}

const cache = new Map<string, Promise<IconData | null>>()
const pending = new Map<string, Map<string, (data: IconData | null) => void>>()

/**
 * One HTTP request per PREFIX per tick, not one per icon. A page rendering a
 * dozen chevrons should ask Iconify once; the batch is flushed on a macrotask
 * so every icon mounted during the same view build joins it.
 */
function load(prefix: string, name: string): Promise<IconData | null> {
  const key = `${prefix}:${name}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  const promise = new Promise<IconData | null>((resolve) => {
    let batch = pending.get(prefix)
    if (batch === undefined) {
      batch = new Map()
      pending.set(prefix, batch)
      setTimeout(() => void flush(prefix), 0)
    }
    batch.set(name, resolve)
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
          `[icons] "${prefix}:${name}" was not found. Check the name at https://icon-sets.iconify.design/${prefix}/`,
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
    console.warn(`[icons] could not load "${prefix}" from ${iconConfig.api}:`, error)
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
  host.appendChild(fragment)
}

/**
 * An icon helper for one Iconify glyph, named `prefix:name` — for example
 * `icon('lucide:star')` or `icon('simple-icons:github')`.
 *
 * `extra` is a class the glyph always carries. Keep it OFF the size axis: the
 * recipes size icons, and a size here beats every one of them.
 */
let seq = 0

export function icon(name: string, extra?: string): (props?: ElProps) => Mountable {
  const colon = name.indexOf(':')
  const prefix = colon === -1 ? 'lucide' : name.slice(0, colon)
  const glyph = colon === -1 ? name : name.slice(colon + 1)

  return (props) => {
    const { class: className, ...rest } = props ?? {}
    // `onMount` hands a callback the BUILD's root container, NOT the element the
    // call sits inside — mounts are collected per build (a view, an arm, an
    // `each` row) and every callback in one gets the same container. So this
    // cannot just take the argument and treat it as the `<svg>`: it is whatever
    // the enclosing component mounted into, and an `instanceof SVGElement`
    // guard on it fails silently, drawing nothing and fetching nothing.
    // A per-instance marker is how the element finds itself again.
    const marker = `i${++seq}`
    return svg(
      {
        'aria-hidden': 'true',
        // The box before the glyph arrives. Iconify's own set default is
        // 24×24 and `paint` corrects it per icon, so nothing reflows for the
        // common case and an odd-sized glyph settles on its first paint.
        viewBox: '0 0 24 24',
        // NO PAINT ON THE WRAPPER. Iconify normalizes it into the BODY —
        // lucide's elements carry `fill="none" stroke="currentColor"
        // stroke-width="2"`, and a filled set's carry `fill="currentColor"` and
        // no stroke at all. Putting lucide's defaults here looks harmless
        // because lucide overrides every one of them, and then silently ruins
        // every other set: a filled `mdi` or `simple-icons` path inherits the
        // 2px stroke it never asked for and renders as a blob with its
        // counters filled in. Measured on the demo page, not reasoned about.
        ...rest,
        'data-icon': marker,
        class: mergeClass(extra ?? '', className),
      },
      [
        // Placed in the child array, so it registers — a discarded `onMount`
        // Mountable registers nothing. Under SSR it is not registered at all,
        // which is what keeps `fetch` and `DOMParser` off the server.
        onMount((root) => {
          const selector = `svg[data-icon="${marker}"]`
          const host = root.matches(selector) ? root : root.querySelector(selector)
          if (!(host instanceof SVGElement)) return
          let live = true
          void load(prefix, glyph).then((data) => {
            if (live && data !== null) paint(host, data)
          })
          return () => {
            live = false
          }
        }),
      ],
    )
  }
}

export const CheckIcon = icon('lucide:check')
export const ChevronDownIcon = icon('lucide:chevron-down')
export const ChevronUpIcon = icon('lucide:chevron-up')
export const ChevronRightIcon = icon('lucide:chevron-right')
export const ChevronLeftIcon = icon('lucide:chevron-left')
export const XIcon = icon('lucide:x')
export const MinusIcon = icon('lucide:minus')
export const SearchIcon = icon('lucide:search')
/**
 * The radio dot. Lucide's `circle` is STROKED, and upstream fills it from the
 * class side (`fill-primary` on shadcn's `RadioGroupItem`) rather than swapping
 * the glyph.
 *
 * The variant selector is load-bearing and `fill-current` alone does NOT work.
 * With `lucide-react` the `<circle>` has no fill of its own, so a `fill-*` on
 * the `<svg>` inherits down and fills it. Iconify's body puts `fill="none"` on
 * the element itself, and a presentation attribute on an element beats a value
 * INHERITED from its parent — so the class has to match the child directly.
 * Measured: with `fill-current` the dot rendered `fill: none` and the radio
 * showed a ring instead of a dot.
 */
export const CircleIcon = icon('lucide:circle', '[&>*]:fill-current')
export const GripVerticalIcon = icon('lucide:grip-vertical')
/** The spinner arc. Pair with `animate-spin`. */
export const LoaderIcon = icon('lucide:loader-circle')

// Nav glyphs. Not baked into any shadcn component — these exist because the
// Sidebar's icon rail is only legible with them: collapsed to `--sidebar-width-icon`
// a text-only menu button shows a truncated label, which is what upstream's
// `[&>span:last-child]:truncate` is there to clip AROUND an icon, not instead of one.
export const LayoutDashboardIcon = icon('lucide:layout-dashboard')
export const FolderIcon = icon('lucide:folder')
export const CalendarIcon = icon('lucide:calendar')
export const SettingsIcon = icon('lucide:settings-2')
