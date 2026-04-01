export function useMachine(
  _machine: unknown,
  _options?: { context?: Record<string, unknown> },
): { state: unknown; send: (event: unknown) => void; api: unknown } {
  // TODO: implement Zag machine bridge
  throw new Error('useMachine not yet implemented')
}
