// `subApp` — the legitimate state-isolation escape hatch.
//
// Mounts a fully isolated app-in-app at a point in the parent's view.
// The sub-app has its OWN state, OWN reducer, OWN scope tree, OWN effect
// pipeline, OWN AppHandle. The parent and sub-app communicate ONLY via
// the parent passing init data into the sub-app at mount time; afterward,
// the sub-app is a black box.
//
// **Use `subApp` only when you genuinely need a second app.** Examples:
//   - A third-party UI widget with its own non-TEA lifecycle (Monaco,
//     ProseMirror) wrapped in a TEA-style adapter that owns its
//     foreign-DOM state.
//   - An isolated 60fps drag layer that should not pump every drag
//     message through the host's reducer.
//   - A deferred chunk loaded for a sub-feature that wants its own
//     state lifecycle, independent of any host-side compaction.
//
// For decomposition / organization, **write a view function**. A view
// function shares the host's state and routes messages through the
// host's reducer — that's the whole point of the unified composition
// model. Reaching for `subApp` to break up a big component is the
// anti-pattern; see `docs/proposals/unified-composition-model.md` for
// the long-form rationale.
//
// The `reason: string` argument is mandatory and shows up in devtools
// + MCP introspection so reviewers can audit whether the boundary is
// load-bearing. Treat it like a `eslint-disable` comment: an explicit
// note that you've considered the alternatives and chosen the boundary
// deliberately. ESLint rule `llui/subapp-requires-reason` enforces
// non-empty values.

import type { ComponentDef, AppHandle } from './types.js'
import { mountApp, type MountOptions } from './mount.js'
import { getRenderContext } from './render-context.js'
import { addDisposer } from './lifetime.js'
import { onMount } from './primitives/on-mount.js'

export interface SubAppOptions<D = void> extends MountOptions {
  /**
   * Why a `subApp` boundary is needed here rather than a view function.
   * Required, non-empty. Shown in devtools / MCP / agent introspection
   * so a reviewer can audit isolation boundaries the way they'd audit
   * `eslint-disable` comments. ESLint rule `llui/subapp-requires-reason`
   * enforces that this is a non-empty string literal.
   *
   * Examples of good reasons:
   *   - "Monaco editor owns its own DOM + selection lifecycle"
   *   - "60fps drag layer — pumping every drag through the host reducer
   *      is too expensive"
   *   - "Lazy-loaded admin tools chunk; state is sealed off from main app"
   *
   * "code organization", "to break up this component", "I felt like it"
   * are all wrong answers — they signal the call should be a view
   * function instead.
   */
  reason: string
  /** Init data threaded into the sub-app's `def.init(data)`. */
  data?: D
}

/**
 * Mount a fully isolated app-in-app at the current view position.
 *
 * The sub-app's lifecycle is tied to the parent scope: when the parent
 * scope disposes (component unmount, branch arm replaced, `each` row
 * removed, ...), the sub-app's handle is `dispose()`'d automatically.
 *
 * Returns the node array to splice into the parent's view. Internally
 * synthesizes a wrapper container; the sub-app mounts inside it on the
 * synchronous `onMount` cycle after the parent's DOM is in place.
 *
 * For host code that needs the `AppHandle` (to drive the sub-app from
 * outside — typically a foreign integration), pass `onHandle` in the
 * options; it receives the handle once mount completes.
 */
export function subApp<S, M, E>(opts: SubAppOptions & { def: ComponentDef<S, M, E> }): Node[]
export function subApp<S, M, E, D>(
  opts: SubAppOptions<D> & {
    def: ComponentDef<S, M, E, D>
    onHandle?: (handle: AppHandle) => void
  },
): Node[]
export function subApp<S, M, E, D>(
  opts: SubAppOptions<D> & {
    def: ComponentDef<S, M, E, D>
    onHandle?: (handle: AppHandle) => void
  },
): Node[] {
  if (typeof opts.reason !== 'string' || opts.reason.trim() === '') {
    throw new Error(
      `[LLui] subApp() requires a non-empty 'reason' string explaining why a state-isolation ` +
        `boundary is necessary here rather than a view function. See ` +
        `docs/proposals/unified-composition-model.md.`,
    )
  }

  const ctx = getRenderContext('subApp')
  const parentScope = ctx.rootLifetime
  const wrapper = ctx.dom.createElement('div') as HTMLElement
  wrapper.setAttribute('data-llui-sub-app', '')
  // Mark with the reason so devtools / MCP / agent tools can surface it.
  wrapper.setAttribute('data-llui-sub-app-reason', opts.reason)

  // Mount the sub-app on the synchronous onMount cycle once the wrapper
  // is in the DOM. mountApp requires its container to be live.
  onMount(() => {
    const handle = mountApp(wrapper, opts.def, opts.data as never, {
      env: opts.env,
      devTools: opts.devTools,
      runInitEffectsOnHydrate: opts.runInitEffectsOnHydrate,
    })
    // Surface the handle to the caller if they asked.
    if (opts.onHandle) opts.onHandle(handle)
    // Tie the sub-app's lifecycle to the parent scope.
    addDisposer(parentScope, () => handle.dispose())
  })

  return [wrapper]
}
