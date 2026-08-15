import { mergeConfig, defineConfig } from 'vitest/config'
import shared from '../../vitest.shared'

// Cross-file / cross-package tests here spin up real TypeScript programs
// (Compiler API) and resolve manifests — genuinely CPU-heavy work that runs
// 5–6s on a fast machine and longer on a CPU-starved parallel runner. That is
// no longer a per-package concern: `vitest.shared.ts` states the workspace-wide
// 30s testTimeout, measured against exactly that kind of load (#147). Restating
// it here would only shadow it the next time the shared budget moves.
export default mergeConfig(shared, defineConfig({}))
