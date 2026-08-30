// Theme token types
export type { ThemeTokens, ThemeToken } from './theme.js'

// Variant utilities — the class-recipe primitives shared with the LLui registry
// (`llui add …`). The per-component `xClasses()` helpers that used to live in
// `./classes/` are GONE: they had no consumer in this repo and 116 of their
// utility occurrences compiled to no CSS at all. Recipes now ship as registry
// source the consumer owns and edits, and are verified by a real Tailwind build
// (`test/tailwind-classes.test.ts`).
export { cx, createVariants } from './utils/index.js'
export type { ClassValue, VariantConfig, VariantProps, VariantRecord } from './utils/index.js'

// Value-hued categorical chips — the hash, the scale, and the status hues it
// must not land on. A pure function plus a CSS rule, deliberately NOT an
// init/update/connect machine: a chip has no state, no interaction and no ARIA
// beyond its text, so a reducer would be ceremony around a colour.
export {
  chipHue,
  chipHueAt,
  isReservedHue,
  CHIP_HUES,
  CHIP_HUE_SLOT_COUNT,
  RESERVED_HUE_ARCS,
} from './chip-hue.js'
export type { ReservedHueArc } from './chip-hue.js'
