/**
 * The @llui/compiler version stamped on every emitted ComponentDef.
 * Read at runtime by `assertCompilerCompatibility()` in @llui/dom's
 * update-loop. v2b §5.
 *
 * Keep this in sync with `package.json` — the publish script (Phase 7
 * `scripts/publish.sh`) reads from package.json so a drift is caught at
 * release time.
 */
export const COMPILER_VERSION = '0.3.0-alpha.0'
