// Signal DOM layer — barrel.
//
// The lowered runtime form a signal-compiled `view` emits to. Element/text helpers
// build real DOM nodes and register their reactive bindings (a `produce` accessor +
// the absolute dependency paths) into the scope being built; `mountSignal` wires
// those bindings through `createSignalScope` (chunked mask gate + output-equality).
// There is no virtual DOM: `view` builds nodes once, updates mutate them in place.
//
// This module was a ~2.3k-line god file; it is now split along its seams into the
// modules re-exported below. Kept as a barrel so existing internal-path imports
// (`src/signals/dom`) — notably the test suite — keep resolving. New code should
// import from the specific module.
//
//  - build-context : the ctx singleton, Mountable core, runBuild + build accessors
//  - element       : el/elNS/text mountables + applyAttr/applyProp (DOM application)
//  - context       : provide/useContext (DI) + portal
//  - scope-build   : specs → chunked-mask scope (+ per-row shape cache)
//  - row-rebase    : re-rooting enclosing-view bindings onto the combined row ctx
//  - row / row-state-gate : shared RowCtx + sentinels; the state-fanout gate
//  - each          : the keyed-each family (LIS reconciler)
//  - arm-controller: the one mounted-arm machine shared by show/branch/lazy
//  - show-branch / unsafe-html / sub-app / foreign / lazy / virtual-each : primitives
//  - dom-region    : removeBetween + cross-env HTML parse
//  - mount         : mount targets + renderSignalTree/mountSignal

export * from './build-context.js'
export * from './element.js'
export * from './context.js'
export * from './scope-build.js'
export * from './row-rebase.js'
export * from './row-state-gate.js'
export * from './dom-region.js'
export * from './each.js' // also re-exports RowCtx (from ./row.js)
export * from './arm-controller.js'
export * from './show-branch.js'
export * from './unsafe-html.js'
export * from './sub-app.js'
export * from './foreign.js'
export * from './lazy.js'
export * from './virtual-each.js'
export * from './mount.js'
