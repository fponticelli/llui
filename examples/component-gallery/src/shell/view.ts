/**
 * The shell's view: header, a searchable contract-driven navigation, and the
 * main region (index, not-found, or one entry with its controls and framed
 * path documents). Built once; every changing part is a binding over the
 * resolved route in state.
 *
 * Native controls carry the keyboard model — links for navigation, radio
 * groups (arrow keys) for path / scenario / environment, a search field that
 * submits to its best match — so there is no bespoke focus management beyond
 * moving focus to the main region after a navigation.
 */
import {
  a,
  button,
  code,
  div,
  each,
  fieldset,
  foreign,
  form,
  h1,
  h2,
  h3,
  header,
  input,
  label,
  legend,
  li,
  main,
  nav,
  onMount,
  p,
  pre,
  section,
  show,
  span,
  strong,
  text,
  ul,
  type Mountable,
  type Renderable,
  type Send,
  type Signal,
} from '@llui/dom'
import {
  GALLERY_DOCUMENT_READY_ATTRIBUTE,
  GALLERY_PATH_LABELS,
  formatGalleryQuery,
  type GalleryLocation,
} from '@llui/cli/gallery'
import type {
  PresentationScenarioEnvironmentAxis,
  PresentationScenarioPath,
} from '@llui/cli/presentation-scenarios'
import { isGalleryDocumentMessage } from '../shared/document-protocol'
import {
  CATEGORY_LABELS,
  COVERAGE_LABELS,
  FAMILY_LABELS,
  GALLERY_CATEGORIES,
  GALLERY_ENTRIES,
  PATHS,
  findGalleryEntry,
  type GalleryEntry,
} from './entries'
import { AXES, AXIS_LABELS, AXIS_VALUE_LABELS, axisPatch } from './route'
import { frameKey, type Msg, type ShellTheme, type State } from './state'
import { PRESENTATION_SCENARIO_ENVIRONMENT_VALUES } from '@llui/cli/presentation-scenarios'

/** `?…` for a location, or `./` for the bare gallery (an empty href would not navigate). */
export function hrefFor(location: GalleryLocation): string {
  return formatGalleryQuery(location) || './'
}

function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

/** A same-document link: a real `href` (open in new tab, copy) that navigates in place. */
function galleryLink(
  location: GalleryLocation,
  send: Send<Msg>,
  props: Record<string, unknown>,
  children: readonly Mountable[],
): Mountable {
  return a(
    {
      ...props,
      href: hrefFor(location),
      onClick: (event: MouseEvent) => {
        if (!isPlainClick(event)) return
        event.preventDefault()
        send({ type: 'navigate', location })
      },
    },
    children,
  )
}

const ARTIFACT_KIND_LABELS: Readonly<Record<GalleryEntry['artifactKind'], string>> = {
  machine: 'State machine',
  skin: 'Skin',
  presentational: 'Presentational',
  pattern: 'Pattern',
}

function badge(label: string, tone: string): Mountable {
  return span({ class: 'badge', 'data-tone': tone }, [text(label)])
}

function pathAvailability(entry: GalleryEntry): Mountable {
  return span(
    { class: 'path-dots' },
    PATHS.map((path) =>
      span(
        {
          class: 'path-dot',
          'data-path': path,
          'data-rendered': entry.paths[path].rendered ? '' : undefined,
          title: `${GALLERY_PATH_LABELS[path]}: ${COVERAGE_LABELS[entry.paths[path].mode]}`,
        },
        [
          span({ class: 'sr-only' }, [
            text(`${GALLERY_PATH_LABELS[path]}: ${COVERAGE_LABELS[entry.paths[path].mode]}`),
          ]),
        ],
      ),
    ),
  )
}

// ── Header ────────────────────────────────────────────────────────────────

const SHELL_THEMES: readonly { id: ShellTheme; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

function shellHeader(state: Signal<State>, send: Send<Msg>): Mountable {
  return header({ class: 'gallery-header' }, [
    button(
      {
        class: 'nav-toggle',
        type: 'button',
        'aria-controls': 'gallery-nav',
        'aria-expanded': state.at('navOpen'),
        onClick: () => send({ type: 'toggleNav' }),
      },
      [text('Components')],
    ),
    galleryLink({}, send, { class: 'brand' }, [strong([text('LLui')]), text(' Component Gallery')]),
    p({ class: 'tagline' }, [
      text('Every component once, in two isolated presentations: '),
      strong([text(GALLERY_PATH_LABELS.baseline)]),
      text(' and '),
      strong([text(GALLERY_PATH_LABELS.registryTailwind)]),
      text('.'),
    ]),
    fieldset({ class: 'segmented shell-theme' }, [
      legend({ class: 'sr-only' }, [text('Gallery colour scheme')]),
      ...SHELL_THEMES.map(({ id, label: themeLabel }) =>
        label({ class: 'segment' }, [
          input({
            type: 'radio',
            name: 'shell-theme',
            value: id,
            checked: state.at('shellTheme').map((theme) => theme === id),
            onChange: () => send({ type: 'setShellTheme', theme: id }),
          }),
          span([text(themeLabel)]),
        ]),
      ),
    ]),
  ])
}

// ── Navigation ────────────────────────────────────────────────────────────

function sidebar(state: Signal<State>, send: Send<Msg>): Mountable {
  const query = state.at('location').at('query')
  const category = state.at('location').at('category')
  return nav(
    {
      id: 'gallery-nav',
      class: 'gallery-nav',
      'aria-label': 'Components',
      'data-open': state.at('navOpen').map((open) => (open ? '' : undefined)),
    },
    [
      form(
        {
          role: 'search',
          class: 'search',
          onSubmit: (event: Event) => {
            event.preventDefault()
            const [first] = state.peek().results
            if (first !== undefined) {
              send({ type: 'navigate', location: { ...state.peek().location, entry: first } })
            }
          },
        },
        [
          label({ for: 'gallery-search' }, [
            text('Search components '),
            span({ class: 'shortcut', 'aria-hidden': 'true' }, [text('/')]),
          ]),
          input({
            id: 'gallery-search',
            type: 'search',
            autocomplete: 'off',
            spellcheck: 'false',
            placeholder: 'Name, alias or import',
            'aria-describedby': 'gallery-result-count',
            value: query.map((value) => value ?? ''),
            onInput: (event: Event) =>
              send({ type: 'setQuery', query: (event.target as HTMLInputElement).value }),
          }),
        ],
      ),
      fieldset({ class: 'categories' }, [
        legend([text('Category')]),
        div({ class: 'chips' }, [
          button(
            {
              type: 'button',
              class: 'chip',
              'aria-pressed': category.map((value) => value === undefined),
              onClick: () => send({ type: 'setCategory', category: null }),
            },
            [text(`All ${GALLERY_ENTRIES.length}`)],
          ),
          ...GALLERY_CATEGORIES.map(({ id, label: categoryLabel, count }) =>
            button(
              {
                type: 'button',
                class: 'chip',
                'aria-pressed': category.map((value) => value === id),
                onClick: () => send({ type: 'setCategory', category: id }),
              },
              [text(`${categoryLabel} ${count}`)],
            ),
          ),
        ]),
      ]),
      p({ id: 'gallery-result-count', class: 'result-count', role: 'status' }, [
        text(
          state
            .at('results')
            .map((results) =>
              results.length === 1 ? '1 component' : `${results.length} components`,
            ),
        ),
      ]),
      ul({ class: 'entry-list' }, [
        each(state.at('results'), {
          key: (name) => name,
          render: (name) => {
            const entry = findGalleryEntry(name.peek())!
            return [
              li([
                galleryLink(
                  { ...state.peek().location, entry: entry.name },
                  send,
                  {
                    class: 'entry-link',
                    'aria-current': state
                      .at('location')
                      .at('entry')
                      .map((current) => (current === entry.name ? 'page' : undefined)),
                  },
                  [
                    span({ class: 'entry-name' }, [text(entry.displayName)]),
                    pathAvailability(entry),
                  ],
                ),
              ]),
            ]
          },
        }),
      ]),
      show(
        state.at('results').map((results) => results.length === 0),
        () => [
          p({ class: 'empty' }, [text('No component matches. Try an alias such as “sheet”.')]),
        ],
      ),
    ],
  )
}

// ── Index ─────────────────────────────────────────────────────────────────

function pathExplainer(path: PresentationScenarioPath): Mountable {
  const baseline = path === 'baseline'
  return section({ class: 'path-card', 'data-path': path }, [
    h2([text(GALLERY_PATH_LABELS[path])]),
    p([
      text(
        baseline
          ? 'Plain CSS, no build step: import @llui/components/styles/theme.css once and spread the machines’ part bags. Styles every component the package ships a machine for.'
          : 'shadcn-style source you own: llui add <name> copies Tailwind v4 skins into your app, over @llui/components machines and tokens.css. Covers every copied skin and presentational component.',
      ),
    ]),
    pre([
      code([
        text(
          baseline
            ? "pnpm add @llui/components @llui/dom\nimport '@llui/components/styles/theme.css'"
            : "pnpm exec llui add button\n@import '@llui/components/styles/tokens.css';",
        ),
      ]),
    ]),
  ])
}

function indexView(state: Signal<State>, send: Send<Msg>): Renderable {
  return [
    h1([text('Component Gallery')]),
    p({ class: 'lede' }, [
      text(
        `${GALLERY_ENTRIES.length} components and patterns, each with deterministic scenarios you can open on either styling path. Everything here is generated from the canonical product contract.`,
      ),
    ]),
    div({ class: 'path-cards' }, [pathExplainer('baseline'), pathExplainer('registryTailwind')]),
    p({ class: 'fine-print' }, [
      text(
        'Each path renders in its own document: the two stylesheets never share a cascade, so nothing on one path can restyle the other.',
      ),
    ]),
    h2({ class: 'section-title' }, [
      text(
        state
          .at('location')
          .at('category')
          .map((id) => (id === undefined ? 'All components' : CATEGORY_LABELS[id])),
      ),
    ]),
    ul({ class: 'card-grid' }, [
      each(state.at('results'), {
        key: (name) => name,
        render: (name) => {
          const entry = findGalleryEntry(name.peek())!
          return [
            li({ class: 'entry-card' }, [
              galleryLink(
                { ...state.peek().location, entry: entry.name },
                send,
                { class: 'card-link' },
                [
                  h3([text(entry.displayName)]),
                  span({ class: 'card-meta' }, [
                    badge(CATEGORY_LABELS[entry.category], 'category'),
                    badge(ARTIFACT_KIND_LABELS[entry.artifactKind], 'kind'),
                  ]),
                  span({ class: 'card-paths' }, [
                    ...PATHS.map((path) =>
                      span(
                        {
                          class: 'card-path',
                          'data-rendered': entry.paths[path].rendered ? '' : undefined,
                        },
                        [
                          text(
                            `${GALLERY_PATH_LABELS[path]} · ${COVERAGE_LABELS[entry.paths[path].mode]}`,
                          ),
                        ],
                      ),
                    ),
                  ]),
                ],
              ),
            ]),
          ]
        },
      }),
    ]),
  ]
}

// ── Not found ─────────────────────────────────────────────────────────────

function notFoundView(state: Signal<State>, send: Send<Msg>): Renderable {
  const requested = state
    .at('route')
    .map((route) => (route.kind === 'not-found' ? route.requested : ''))
  const suggestions = state
    .at('route')
    .map((route) => (route.kind === 'not-found' ? [...route.suggestions] : []))
  return [
    section({ class: 'not-found', role: 'alert' }, [
      h1([text('No component named “'), text(requested), text('”')]),
      p([text('The link may be misspelled, or the component was renamed. Did you mean:')]),
      ul({ class: 'suggestions' }, [
        each(suggestions, {
          key: (name) => name,
          render: (name) => {
            const entry = findGalleryEntry(name.peek())!
            return [li([galleryLink({ entry: entry.name }, send, {}, [text(entry.displayName)])])]
          },
        }),
      ]),
      p([galleryLink({}, send, {}, [text('Browse every component')])]),
    ]),
  ]
}

// ── Entry ─────────────────────────────────────────────────────────────────

function installBlock(entry: GalleryEntry, path: PresentationScenarioPath): Mountable {
  const summary = entry.paths[path]
  return section({ class: 'path-summary', 'data-path': path }, [
    h3([
      text(GALLERY_PATH_LABELS[path]),
      text(' '),
      badge(COVERAGE_LABELS[summary.mode], summary.rendered ? 'ok' : 'muted'),
    ]),
    ...(summary.rationale === undefined
      ? []
      : [p({ class: 'rationale' }, [text(summary.rationale)])]),
    ...(summary.composedOf === undefined
      ? []
      : [
          p({ class: 'rationale' }, [
            text(
              `Composed from: ${summary.composedOf.map((name) => findGalleryEntry(name)?.displayName ?? name).join(', ')}.`,
            ),
          ]),
        ]),
    ...(summary.install.length === 0
      ? [p({ class: 'rationale' }, [text('Nothing to install on this path.')])]
      : [pre([code([text(summary.install.join('\n'))])])]),
  ])
}

function radioGroup<T extends string>(
  name: string,
  title: string,
  options: readonly { value: T; label: string }[],
  selected: Signal<T | undefined>,
  onSelect: (value: T) => void,
  disabled?: Signal<boolean>,
): Mountable {
  return fieldset(
    {
      class: 'segmented',
      ...(disabled === undefined ? {} : { disabled }),
    },
    [
      legend([text(title)]),
      div({ class: 'segments' }, [
        ...options.map((option) =>
          label({ class: 'segment' }, [
            input({
              type: 'radio',
              name,
              value: option.value,
              checked: selected.map((value) => value === option.value),
              onChange: () => onSelect(option.value),
            }),
            span([text(option.label)]),
          ]),
        ),
      ]),
    ],
  )
}

function controls(entry: GalleryEntry, state: Signal<State>, send: Send<Msg>): Mountable {
  const route = state.at('route')
  const pathChoice = route.map((current) =>
    current.kind !== 'entry' ? undefined : current.view === 'compare' ? 'compare' : current.path,
  )
  const caseId = route.map((current) => (current.kind === 'entry' ? current.caseId : undefined))
  const axisControl = (axis: PresentationScenarioEnvironmentAxis): Mountable =>
    div({ class: 'axis' }, [
      radioGroup(
        `axis-${axis}`,
        AXIS_LABELS[axis],
        PRESENTATION_SCENARIO_ENVIRONMENT_VALUES[axis].map((value) => ({
          value,
          label: AXIS_VALUE_LABELS[value] ?? value,
        })),
        route.map((current) =>
          current.kind === 'entry' ? String(current.environment[axis]) : undefined,
        ),
        (value) => send({ type: 'setAxis', patch: axisPatch(axis, value) }),
        route.map((current) => current.kind !== 'entry' || !current.axes.includes(axis)),
      ),
    ])
  return section({ class: 'controls', 'aria-label': 'Scenario controls' }, [
    radioGroup(
      'path',
      'Presentation',
      [
        { value: 'baseline', label: GALLERY_PATH_LABELS.baseline },
        { value: 'registryTailwind', label: GALLERY_PATH_LABELS.registryTailwind },
        { value: 'compare', label: 'Compare both' },
      ],
      pathChoice,
      (value) => {
        if (value === 'compare') send({ type: 'setView', view: 'compare' })
        else send({ type: 'setPath', path: value })
      },
    ),
    radioGroup(
      'scenario',
      'Scenario',
      entry.cases.map(({ id, label: caseLabel }) => ({ value: id, label: caseLabel })),
      caseId,
      (value) => send({ type: 'setCase', caseId: value }),
    ),
    ...(entry.copiedArtifacts.length > 1
      ? [
          radioGroup(
            'artifact',
            'Registry artifact',
            entry.copiedArtifacts.map(({ name, displayName }) => ({
              value: name,
              label: `${displayName} (${name})`,
            })),
            route.map((current) =>
              current.kind === 'entry' ? (current.copiedArtifact ?? entry.name) : undefined,
            ),
            (value) => send({ type: 'setArtifact', artifact: value }),
          ),
        ]
      : []),
    div({ class: 'axes' }, AXES.map(axisControl)),
    p({ class: 'fine-print' }, [
      text(
        'Environment axes are enabled only where the selected scenario declares them. Hover, focus and pressed states are live: interact with the rendering.',
      ),
    ]),
  ])
}

interface FrameRow {
  readonly key: string
  readonly path: PresentationScenarioPath
  readonly href?: string
  readonly narrow: boolean
}

function frameRows(state: State): FrameRow[] {
  const route = state.route
  if (route.kind !== 'entry') return []
  return route.frames.map((frame) =>
    frame.href === undefined
      ? { key: `none:${route.entry}:${frame.path}`, path: frame.path, narrow: false }
      : {
          key: frameKey(frame.href, state.reload),
          path: frame.path,
          href: frame.href,
          narrow: route.environment.viewport === 'narrow',
        },
  )
}

/**
 * The document frame. `foreign`, because an `<iframe>` is an imperative
 * boundary: its load, its document and its size are the browser's. A same-
 * origin document that loads without reporting (a 404 page, a crashed build)
 * is detected here at `load`, not only by the shell's timeout.
 */
function documentFrame(row: FrameRow, title: string, send: Send<Msg>): Mountable {
  return foreign({
    tag: 'iframe',
    mount: ({ el }) => {
      const frame = el as HTMLIFrameElement
      frame.src = row.href!
      frame.title = title
      frame.className = 'document-frame'
      let observer: ResizeObserver | undefined
      const onLoad = (): void => {
        // `null` for a cross-origin document — which a gallery document never is.
        const doc = frame.contentDocument
        if (doc === null || !doc.documentElement.hasAttribute(GALLERY_DOCUMENT_READY_ATTRIBUTE)) {
          send({
            type: 'frameStatus',
            key: row.key,
            status: 'error',
            code: 'renderer-failed',
            message: 'The path document failed to load (it is not a gallery document).',
          })
          return
        }
        observer?.disconnect()
        // Fit the frame to the document's content (a closed accordion should
        // not sit in a 480px box), but never below a floor that leaves room
        // for a scenario's overlay to open inside it.
        const content = doc.getElementById('gallery-document') ?? doc.body
        observer = new ResizeObserver(() => {
          const height = Math.ceil(content.getBoundingClientRect().bottom) + 24
          frame.style.height = `${Math.min(Math.max(height, 320), 1600)}px`
        })
        observer.observe(content)
      }
      frame.addEventListener('load', onLoad)
      return () => {
        frame.removeEventListener('load', onLoad)
        observer?.disconnect()
      }
    },
    unmount: (cleanup) => cleanup(),
  })
}

function stage(entry: GalleryEntry, state: Signal<State>, send: Send<Msg>): Mountable {
  return section({ class: 'stage', 'aria-label': 'Rendered scenario' }, [
    each(state.map(frameRows), {
      key: (row) => row.key,
      render: (rowSignal) => {
        const row = rowSignal.peek()
        const pathName = GALLERY_PATH_LABELS[row.path]
        if (row.href === undefined) {
          const summary = entry.paths[row.path]
          return [
            div({ class: 'frame-panel', 'data-path': row.path, 'data-rendered': 'false' }, [
              div({ class: 'frame-bar' }, [strong([text(pathName)])]),
              div({ class: 'frame-empty', role: 'note' }, [
                p([
                  strong([text(`${COVERAGE_LABELS[summary.mode]} on this path. `)]),
                  text(summary.rationale ?? `${entry.displayName} has no ${pathName} rendering.`),
                ]),
                ...(summary.composedOf === undefined
                  ? []
                  : [
                      p([
                        text('See '),
                        ...summary.composedOf.flatMap((name, index) => [
                          ...(index === 0 ? [] : [text(', ')]),
                          galleryLink({ entry: name, path: row.path }, send, {}, [
                            text(findGalleryEntry(name)?.displayName ?? name),
                          ]),
                        ]),
                        text('.'),
                      ]),
                    ]),
              ]),
            ]),
          ]
        }
        const status = state
          .at('frames')
          .map((frames) => frames[row.key] ?? { status: 'loading' as const })
        const statusName = status.map((current) => current.status)
        return [
          div(
            {
              class: 'frame-panel',
              'data-path': row.path,
              'data-rendered': 'true',
              'data-narrow': row.narrow ? '' : undefined,
              'data-status': statusName,
              'aria-busy': statusName.map((name) => name === 'loading'),
            },
            [
              div({ class: 'frame-bar' }, [
                strong([text(pathName)]),
                span({ class: 'frame-status', role: 'status' }, [
                  text(
                    statusName.map((name) =>
                      name === 'loading' ? 'Rendering…' : name === 'ready' ? 'Rendered' : 'Failed',
                    ),
                  ),
                ]),
                a({ class: 'frame-open', href: row.href, target: '_blank', rel: 'noopener' }, [
                  text('Open document'),
                  span({ class: 'sr-only' }, [text(` (${pathName}, new tab)`)]),
                ]),
              ]),
              div({ class: 'frame-viewport' }, [
                documentFrame(row, `${entry.displayName} — ${pathName}`, send),
                // The message is read from `status`, not from the arm's narrowed
                // signal: that signal derives from a `.map`, so `.at()` on it
                // throws at runtime (while the compiler's prefer-at-over-map
                // lint would ask for exactly that on a `.map(s => s.message)`).
                show(
                  statusName.map((name) => name === 'error'),
                  () => [
                    div({ class: 'frame-error', role: 'alert' }, [
                      strong([text(`${pathName} could not render this scenario.`)]),
                      p([
                        text(
                          status.map((current) =>
                            current.status === 'error' ? current.message : '',
                          ),
                        ),
                      ]),
                      button({ type: 'button', onClick: () => send({ type: 'retry' }) }, [
                        text('Retry'),
                      ]),
                    ]),
                  ],
                ),
              ]),
            ],
          ),
        ]
      },
    }),
  ])
}

function entryView(entry: GalleryEntry, state: Signal<State>, send: Send<Msg>): Mountable {
  const description = entry.copiedArtifacts.find(
    ({ description }) => description !== undefined,
  )?.description
  return div({ class: 'entry' }, [
    header({ class: 'entry-header' }, [
      h1([text(entry.displayName)]),
      ...(description === undefined ? [] : [p({ class: 'lede' }, [text(description)])]),
      div({ class: 'badges' }, [
        badge(CATEGORY_LABELS[entry.category], 'category'),
        badge(ARTIFACT_KIND_LABELS[entry.artifactKind], 'kind'),
        badge(FAMILY_LABELS[entry.family], 'family'),
        ...(entry.machineImport === undefined
          ? [badge('No state machine', 'muted')]
          : [span({ class: 'badge', 'data-tone': 'code' }, [code([text(entry.machineImport)])])]),
        ...entry.aliases.map((alias) => badge(`alias: ${alias}`, 'alias')),
        ...entry.copiedArtifacts.map(({ name }) => badge(`llui add ${name}`, 'skin')),
      ]),
      div({ class: 'entry-actions' }, [
        button({ type: 'button', onClick: () => send({ type: 'copyLink' }) }, [
          text(state.at('copied').map((copied) => (copied ? 'Link copied' : 'Copy link'))),
        ]),
      ]),
    ]),
    controls(entry, state, send),
    stage(entry, state, send),
    div({ class: 'path-summaries' }, [
      installBlock(entry, 'baseline'),
      installBlock(entry, 'registryTailwind'),
    ]),
  ])
}

// ── Root ──────────────────────────────────────────────────────────────────

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
}

/** Window-level listeners: history, document status messages, shortcuts. */
export function shellListeners(state: Signal<State>, send: Send<Msg>): Mountable {
  return onMount(() => {
    const onPopState = (): void => send({ type: 'popState', search: window.location.search })
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin || !isGalleryDocumentMessage(event.data)) return
      const message = event.data
      const row = frameRows(state.peek()).find(
        ({ href }) =>
          href !== undefined && new URL(href, window.location.href).href === message.href,
      )
      if (row === undefined) return
      send({
        type: 'frameStatus',
        key: row.key,
        status: message.status,
        ...(message.code === undefined ? {} : { code: message.code }),
        ...(message.message === undefined ? {} : { message: message.message }),
      })
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === '/' && !isTypingTarget(event.target)) {
        event.preventDefault()
        document.getElementById('gallery-search')?.focus()
      } else if (event.key === 'Escape' && state.peek().navOpen) {
        send({ type: 'closeNav' })
      }
    }
    window.addEventListener('popstate', onPopState)
    window.addEventListener('message', onMessage)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('message', onMessage)
      document.removeEventListener('keydown', onKeyDown)
    }
  })
}

/** Everything inside the themed `.gallery` root. */
export function shellChrome(state: Signal<State>, send: Send<Msg>): Renderable {
  const kind = state.at('route').map((route) => route.kind)
  const entryName = state.at('route').map((route) => (route.kind === 'entry' ? [route.entry] : []))
  return [
    a({ class: 'skip-link', href: '#gallery-main' }, [text('Skip to content')]),
    shellHeader(state, send),
    div({ class: 'gallery-layout' }, [
      sidebar(state, send),
      main({ id: 'gallery-main', class: 'gallery-main', tabindex: '-1' }, [
        show(
          state.at('notices').map((notices) => notices.length > 0),
          () => [
            ul({ class: 'notices', role: 'status', 'aria-label': 'Link corrections' }, [
              each(state.at('notices'), {
                key: (notice) => notice,
                render: (notice) => [li([text(notice)])],
              }),
            ]),
          ],
        ),
        show(
          kind.map((value) => value === 'index'),
          () => indexView(state, send),
        ),
        show(
          kind.map((value) => value === 'not-found'),
          () => notFoundView(state, send),
        ),
        each(entryName, {
          key: (name) => name,
          render: (name) => {
            const entry = findGalleryEntry(name.peek())!
            return [entryView(entry, state, send)]
          },
        }),
      ]),
    ]),
  ]
}
