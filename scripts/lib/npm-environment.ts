const PNPM_ONLY_NPM_CONFIG = [
  'npm_config_save_workspace_protocol',
  'npm_config_verify_deps_before_run',
  'npm_config_npm_globalconfig',
  'npm_config__jsr_registry',
] as const

/** Prevent npm from warning about pnpm-only config inherited through its env. */
export function environmentForNpm(environment: Readonly<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  const sanitized = { ...environment }
  for (const name of PNPM_ONLY_NPM_CONFIG) delete sanitized[name]
  return sanitized
}
