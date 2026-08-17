const PNPM_ONLY_NPM_CONFIG = [
  'npm_config_save_workspace_protocol',
  'npm_config_verify_deps_before_run',
  'npm_config_npm_globalconfig',
  'npm_config__jsr_registry',
  'npm_config__llui_registry',
  'npm_config_frozen_lockfile',
  'npm_config_link_workspace_packages',
] as const

/** Prevent npm from warning about pnpm-only config inherited through its env. */
export function environmentForNpm(environment: Readonly<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  const sanitized = { ...environment }
  for (const name of PNPM_ONLY_NPM_CONFIG) delete sanitized[name]
  // JFB has only public npm dependencies. Isolating its install from the
  // operator's npmrc files prevents machine-specific scopes, credentials, and
  // pnpm-only settings from changing or warning during a reproducible setup.
  sanitized.npm_config_userconfig = '/dev/null'
  return sanitized
}
