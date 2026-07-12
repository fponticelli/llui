// HUD state persistence — the debounced localStorage mirror of the bits of HUD
// state worth surviving a reload (modal open/view/draft/selected resume chain).
// Owns its own debounce timer; `dispose()` cancels a pending write so nothing
// lands after the HUD is torn down.

const HUD_STATE_KEY = 'llui-devmode-annotate.hud-state'
const PERSIST_DEBOUNCE_MS = 200

/** The serialized shape written to / read from localStorage. */
export interface PersistedHudState {
  modalOpen?: boolean
  view?: 'compose' | 'browse'
  draftProse?: string
  selectedResumeChain?: string | null
}

/** The minimal live-state shape the persister reads from. `HudState` is
 *  structurally compatible, so no dependency back on the HUD state type. */
export interface PersistSource {
  modalOpen: boolean
  tabs: { value: string }
  draftProse: string
  tasks: { selectedChain: string | null }
}

export interface Persistence {
  /** Debounced write of the current HUD state to localStorage. */
  schedule(): void
  /** Read the persisted state (best-effort — {} when unavailable/corrupt). */
  read(): PersistedHudState
  /** Cancel a pending debounced write. */
  dispose(): void
}

export function createPersistence(getState: () => PersistSource): Persistence {
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  return {
    schedule(): void {
      if (persistTimer) clearTimeout(persistTimer)
      persistTimer = setTimeout(() => {
        persistTimer = null
        try {
          const s = getState()
          const data: PersistedHudState = {
            modalOpen: s.modalOpen,
            view: s.tabs.value as 'compose' | 'browse',
            draftProse: s.draftProse,
            selectedResumeChain: s.tasks.selectedChain,
          }
          localStorage.setItem(HUD_STATE_KEY, JSON.stringify(data))
        } catch {
          // unavailable; skip.
        }
      }, PERSIST_DEBOUNCE_MS)
    },
    read(): PersistedHudState {
      try {
        const raw = localStorage.getItem(HUD_STATE_KEY)
        if (!raw) return {}
        const parsed = JSON.parse(raw) as PersistedHudState
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    },
    dispose(): void {
      if (persistTimer) {
        clearTimeout(persistTimer)
        persistTimer = null
      }
    },
  }
}
