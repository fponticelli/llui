// Escape hatches — rarely-needed boundaries kept off the main authoring surface.
//
// `subApp` is a DEPRECATED alias for `island()`, which is now on the main barrel.
// The primitive did not change; its framing did. It was described here as a valve
// for third-party UI and 60fps layers, which is what made a component with private
// local state — the ordinary case it also serves — read as something you were being
// warned off. Two names for one primitive is worse than one rename, so this exists
// only to keep existing call sites compiling: it takes the same spec (with `reason`
// still REQUIRED, as it always was here) and returns the same `Renderable` array.
//
// New code writes `island({ def })` from `@llui/dom`.

import { signalIsland, type IslandSpec } from './island.js'
import type { Renderable } from './element.js'

/** Spec for the deprecated {@link subApp}: {@link IslandSpec} with `reason`
 * required, as this entry point has always required it.
 *
 * @deprecated Use `IslandSpec` with `island()` from `@llui/dom`. */
export type SubAppSpec<S, M, E = never> = IslandSpec<S, M, E> & { reason: string }

/**
 * Mount an isolated component instance at this point in the view. Returns the
 * anchor node(s) to splice into the surrounding view array (`...subApp({ … })`).
 *
 * @deprecated Use `island()` from `@llui/dom` — the same primitive, on the main
 * barrel, with `reason` optional and a declarative `props`/`onProps` channel.
 * `island()` returns a single `Mountable`, so drop the spread: `island({ def })`.
 */
export function subApp<S, M, E = never>(spec: SubAppSpec<S, M, E>): Renderable {
  return [signalIsland(spec)]
}
