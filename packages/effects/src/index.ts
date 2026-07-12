// ── @llui/effects public surface ─────────────────────────────────
//
// This module is the package entry point. It only RE-EXPORTS from the split
// modules — there is no module-level side effect here (or in any imported
// module), so `"sideEffects": false` stays valid and a consumer that touches
// only the builders (or only a hand-picked runner set) tree-shakes the rest.

// ── Effect types ──────────────────────────────────────────────────
export type {
  Async,
  ApiError,
  HttpEffect,
  CancelEffect,
  CancelReplaceEffect,
  DebounceEffect,
  TimeoutEffect,
  IntervalEffect,
  LogEffect,
  StorageScope,
  StorageSetEffect,
  StorageRemoveEffect,
  StorageGetEffect,
  StorageWatchEffect,
  BroadcastEffect,
  BroadcastListenEffect,
  SequenceEffect,
  RaceEffect,
  WebSocketEffect,
  WebSocketSendEffect,
  UploadEffect,
  RetryEffect,
  ClipboardReadEffect,
  ClipboardWriteEffect,
  NotificationEffect,
  GeolocationEffect,
  BuiltinEffect as Effect,
} from './types.js'

// ── Builders ──────────────────────────────────────────────────────
export {
  http,
  cancel,
  debounce,
  timeout,
  interval,
  delay,
  log,
  storageLoad,
  storageSet,
  storageRemove,
  storageGet,
  storageWatch,
  broadcast,
  broadcastListen,
  websocket,
  wsSend,
  retry,
  upload,
  clipboardRead,
  clipboardWrite,
  notification,
  geolocation,
  sequence,
  race,
} from './builders.js'

// ── Shared HTTP core (also used by SSR resolveEffects) ────────────
export { buildRequest, parseResponse, httpStatusToApiError } from './http-core.js'

// ── Handler chain ─────────────────────────────────────────────────
export { handleEffects, handleEffectsWith, asOnEffect } from './handle-effects.js'
export type { EffectCtx, EffectPlugin } from './handle-effects.js'

// ── Runner registry (opt-in tree-shakeable dispatch) ──────────────
//
// `handleEffects()` is batteries-included. To ship only the runners you use,
// import the individual runner objects and pass them to `handleEffectsWith(...)`;
// never importing `defaultRunners` lets the bundler drop the runners you omit.
export type { Runner } from './core.js'
export { defaultRunners } from './default-runners.js'
export { httpRunner } from './runners/http.js'
export { cancelRunner } from './runners/cancel.js'
export { debounceRunner } from './runners/debounce.js'
export { timeoutRunner } from './runners/timeout.js'
export { intervalRunner } from './runners/interval.js'
export { logRunner } from './runners/log.js'
export {
  storageSetRunner,
  storageRemoveRunner,
  storageGetRunner,
  storageWatchRunner,
} from './runners/storage.js'
export { broadcastRunner, broadcastListenRunner } from './runners/broadcast.js'
export { sequenceRunner } from './runners/sequence.js'
export { raceRunner } from './runners/race.js'
export { websocketRunner, wsSendRunner } from './runners/websocket.js'
export { retryRunner } from './runners/retry.js'
export { uploadRunner } from './runners/upload.js'
export { clipboardReadRunner, clipboardWriteRunner } from './runners/clipboard.js'
export { notificationRunner } from './runners/notification.js'
export { geolocationRunner } from './runners/geolocation.js'

// ── SSR Effect Resolution ────────────────────────────────────────
export { resolveEffects } from './resolve.js'

// ── Dev-only effect interceptor ──────────────────────────────────
export {
  _setEffectInterceptor,
  _getEffectInterceptor,
  type EffectInterceptor,
  type EffectInterceptorResult,
} from './interceptor.js'
