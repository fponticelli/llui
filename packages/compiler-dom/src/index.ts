// @llui/compiler-dom — DOM code generation modules (always-on).
//
// This package owns the modules that produce compiled output the
// `@llui/dom` runtime executes:
//
//   - each-memo            wrap allocating each() items in memo()
//   - item-dedup           hoist __sN/__aN in render bodies
//   - structural-mask      inject __mask on each/branch/scope/show
//   - text-mask            inject __mask as text()'s 2nd arg
//   - element-rewrite      div() → elSplit / elTemplate / __cloneStaticTemplate
//   - row-factory          each() → row-factory shape
//   - core-synthesis       __update / __handlers / __prefixes
//
// Activation: always-on. A project that disables this package has
// no compiled output — the @llui/dom runtime falls back to its
// generic path with no bitmask gating.
//
// Modules move here in v2c/decomp-25 (scaffolding lands first in
// v2c/decomp-24; this file is the placeholder index).

export {}
