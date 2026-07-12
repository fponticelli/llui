// Escape hatches — rarely-needed boundaries kept off the main authoring surface.
//
// `subApp` mounts an ISOLATED component instance (own update loop + mask scope +
// DOM region) inside a parent view. Everyday decomposition does NOT need this —
// use plain view-helper functions over `Signal<T>` slices, which chunked masks
// make cheap. Reach here only for genuine isolation: third-party UI, a long-lived
// loop with no reactive props, a 60fps layer, a deferred chunk with its own
// lifecycle. Each call documents WHY via the required `reason` field.

import { signalSubApp, type SubAppSpec } from './sub-app.js'
import type { Renderable } from './element.js'

/**
 * Mount an isolated sub-application at this point in the view. Returns the anchor
 * node(s) to splice into the surrounding view array (`...subApp({ … })`). Drive
 * the instance — push props in, bubble messages out — via `onHandle`'s handle;
 * the sub-app shares no state with the host. Disposed automatically when the host
 * unmounts.
 */
export function subApp<S, M, E = never>(spec: SubAppSpec<S, M, E>): Renderable {
  return [signalSubApp(spec)]
}

export type { SubAppSpec }
