// ── Batteries-included runner set ────────────────────────────────
//
// The default set of runners wired into `handleEffects()`. Importing this pulls
// EVERY built-in runner (that is the batteries-included contract). Consumers who
// want to tree-shake unused runners import the individual runner objects and pass
// only what they use to `handleEffectsWith(...)` — never importing this module, so
// the bundler drops the runners they don't reference.

import type { Runner } from './core.js'
import { httpRunner } from './runners/http.js'
import { cancelRunner } from './runners/cancel.js'
import { debounceRunner } from './runners/debounce.js'
import { timeoutRunner } from './runners/timeout.js'
import { intervalRunner } from './runners/interval.js'
import { logRunner } from './runners/log.js'
import {
  storageGetRunner,
  storageRemoveRunner,
  storageSetRunner,
  storageWatchRunner,
} from './runners/storage.js'
import { broadcastListenRunner, broadcastRunner } from './runners/broadcast.js'
import { sequenceRunner } from './runners/sequence.js'
import { raceRunner } from './runners/race.js'
import { websocketRunner, wsSendRunner } from './runners/websocket.js'
import { retryRunner } from './runners/retry.js'
import { uploadRunner } from './runners/upload.js'
import { clipboardReadRunner, clipboardWriteRunner } from './runners/clipboard.js'
import { notificationRunner } from './runners/notification.js'
import { geolocationRunner } from './runners/geolocation.js'

/** Every built-in runner, in the original dispatch order. */
export const defaultRunners: readonly Runner[] = [
  httpRunner,
  cancelRunner,
  debounceRunner,
  timeoutRunner,
  intervalRunner,
  logRunner,
  storageSetRunner,
  storageRemoveRunner,
  storageGetRunner,
  storageWatchRunner,
  broadcastRunner,
  broadcastListenRunner,
  sequenceRunner,
  raceRunner,
  websocketRunner,
  wsSendRunner,
  retryRunner,
  uploadRunner,
  clipboardReadRunner,
  clipboardWriteRunner,
  notificationRunner,
  geolocationRunner,
]
