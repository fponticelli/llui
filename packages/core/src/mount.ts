import type { ComponentDef, AppHandle } from './types'

export function mountApp<S, M, E>(
  _container: HTMLElement,
  _def: ComponentDef<S, M, E>,
  _data?: unknown,
): AppHandle {
  // TODO: implement
  throw new Error('mountApp not yet implemented')
}

export function hydrateApp<S, M, E>(
  _container: HTMLElement,
  _def: ComponentDef<S, M, E>,
  _serverState: S,
): AppHandle {
  // TODO: implement
  throw new Error('hydrateApp not yet implemented')
}
