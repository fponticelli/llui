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
