import { defineConfig } from 'vitest/config'
import shared from './vitest.shared'

// Tests for the repo's own tooling under `scripts/`. These live outside the
// workspace packages (the root is not a pnpm workspace member), so `turbo run
// test` cannot see them — the root `test:scripts` script runs this config, and
// `pnpm verify` calls it.
//
// It extends `vitest.shared.ts` like every other vitest config in the repo, and
// that is not cosmetic (#249). It was the ONE config that did not, so
// `scripts/test/**` ran on vitest's stock 5 s `testTimeout` while the whole rest
// of the workspace ran on the 30 s the shared base states for a deliberate,
// measured reason (#147/#180). The gap is invisible on a quiet machine and
// closes on a loaded one, which is exactly where CI lives: on this 18-core
// machine `registry-attrs.test.ts`'s heaviest case measures 710 ms quiet and
// 2.77 s at load ~750, and `tailwind-classes.test.ts` (a REAL Tailwind build)
// 684 ms → 3.59 s. That is 1.4x margin against a 5 s budget and 8.4x against the
// shared 30 s — and two lanes in one batch had already spent it, timing out
// here and passing on re-run. `scripts/test/` is also where the cheapest guards
// in the repo live (`verify-install`, `source-encoding`, `tailwind-classes`), so
// an intermittent red here trains people to re-run rather than read.
//
// Do NOT use `mergeConfig`: it CONCATENATES arrays, so the shared
// `test/**/*.test.ts` glob would survive beside this one and this command would
// discover a root `test/` directory that does not exist today but would be
// picked up silently the day someone adds one. `packages/lexical-loro/
// vitest.stress.config.ts` spreads for the same reason — copy that idiom, and
// keep `...shared.test` ahead of the override so the defines, the duration
// reporters (#193) and both budgets still come from one place.
export default defineConfig({
  ...shared,
  test: {
    ...shared.test,
    include: ['scripts/test/**/*.test.ts'],
  },
})
