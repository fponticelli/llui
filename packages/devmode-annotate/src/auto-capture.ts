// Auto-capture on uncaught error — window `error` / `unhandledrejection`
// listeners that pre-fill the compose draft with the error and pop the HUD
// open. Rate-limited (one auto-capture per 5s) and non-destructive (appends
// below an in-progress draft rather than clobbering it). Owns its window
// listeners; `dispose()` removes them.

const AUTO_CAPTURE_THROTTLE_MS = 5000

export interface AutoCaptureDeps {
  /** Master gate — when false, the listeners are still installed but inert
   *  (matches the original in-handler guard). */
  enabled: boolean
  /** The current draft prose (live editor value preferred over state mirror). */
  proseValue: () => string
  /** Push a new draft value into the editor. */
  setProse: (value: string) => void
  /** Pop the HUD open (and focus the editor). */
  open: () => void
}

export interface AutoCapture {
  /** Remove the window listeners. */
  dispose(): void
}

export function installAutoCapture(deps: AutoCaptureDeps): AutoCapture {
  const { enabled, proseValue, setProse, open } = deps
  let lastAutoCaptureAt = 0

  const fillFromError = (lbl: string, message: string, stack: string | undefined): void => {
    const now = Date.now()
    if (now - lastAutoCaptureAt < AUTO_CAPTURE_THROTTLE_MS) return
    lastAutoCaptureAt = now
    const lines = [
      `**Auto-captured ${lbl}**`,
      '',
      '```',
      message,
      ...(stack ? [stack.split('\n').slice(0, 8).join('\n')] : []),
      '```',
      '',
      'What was happening when this fired?',
    ]
    const errorBlock = lines.join('\n')
    // Never clobber an in-progress draft: if the user has already typed
    // something, APPEND the error block below it instead of replacing.
    const existing = proseValue()
    const value = existing.trim() ? `${existing}\n\n${errorBlock}` : errorBlock
    // setProse flows into the editor via the foreign value bind; open() focuses it.
    setProse(value)
    open()
  }

  const onWindowError = (e: ErrorEvent): void => {
    if (enabled) fillFromError('error', e.message || String(e.error), e.error?.stack)
  }
  const onUnhandledRejection = (e: PromiseRejectionEvent): void => {
    if (!enabled) return
    const reason = e.reason
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : String(reason)
    fillFromError(
      'unhandled rejection',
      message,
      reason instanceof Error ? reason.stack : undefined,
    )
  }

  if (enabled && typeof window !== 'undefined') {
    window.addEventListener('error', onWindowError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
  }

  return {
    dispose(): void {
      if (typeof window !== 'undefined') {
        window.removeEventListener('error', onWindowError)
        window.removeEventListener('unhandledrejection', onUnhandledRejection)
      }
    },
  }
}
