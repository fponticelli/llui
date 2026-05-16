// Synthetic state shape that exercises:
// - Top-level scalars and objects
// - Nested branches (3 levels deep)
// - Arrays (the each-style structural primitive case)
// - >31 top-level fields so the overflow path matters

export interface AppState {
  // Frequently-changing top-level scalars (sim'd as "user actively typing")
  query: string
  selectedId: string | null
  // Auth slice (medium-frequency)
  auth: {
    status: 'unknown' | 'signed-in' | 'signed-out'
    user: { id: string; email: string; name: string } | null
    formError: string | null
  }
  // UI slice (low-frequency)
  ui: {
    sidebarOpen: boolean
    viewport: 'mobile' | 'desktop'
    confirm: { open: boolean; title: string; body: string } | null
  }
  // Items collection (changes on add/remove/edit)
  items: Array<{ id: string; title: string; body: string; tags: string[] }>
  // Filter sub-state
  filter: {
    text: string
    tags: string[]
    sort: 'name' | 'date'
  }
  // Lots of independent flags — what forces FULL_MASK in current model
  flag0: boolean
  flag1: boolean
  flag2: boolean
  flag3: boolean
  flag4: boolean
  flag5: boolean
  flag6: boolean
  flag7: boolean
  flag8: boolean
  flag9: boolean
  flag10: boolean
  flag11: boolean
  flag12: boolean
  flag13: boolean
  flag14: boolean
  flag15: boolean
  flag16: boolean
  flag17: boolean
  flag18: boolean
  flag19: boolean
  flag20: boolean
  flag21: boolean
  flag22: boolean
  flag23: boolean
  flag24: boolean
  flag25: boolean
  flag26: boolean
  flag27: boolean
  flag28: boolean
  flag29: boolean
  flag30: boolean
  flag31: boolean // pushes us into overflow territory under bitmask
  flag32: boolean
  flag33: boolean
  flag34: boolean
  flag35: boolean
}

export function initialState(): AppState {
  const items = []
  for (let i = 0; i < 50; i++) {
    items.push({
      id: `item-${i}`,
      title: `Item ${i}`,
      body: `Body for item ${i}`,
      tags: [`tag-${i % 3}`],
    })
  }
  return {
    query: '',
    selectedId: null,
    auth: { status: 'unknown', user: null, formError: null },
    ui: {
      sidebarOpen: false,
      viewport: 'desktop',
      confirm: null,
    },
    items,
    filter: { text: '', tags: [], sort: 'name' },
    flag0: false, flag1: false, flag2: false, flag3: false, flag4: false,
    flag5: false, flag6: false, flag7: false, flag8: false, flag9: false,
    flag10: false, flag11: false, flag12: false, flag13: false, flag14: false,
    flag15: false, flag16: false, flag17: false, flag18: false, flag19: false,
    flag20: false, flag21: false, flag22: false, flag23: false, flag24: false,
    flag25: false, flag26: false, flag27: false, flag28: false, flag29: false,
    flag30: false, flag31: false, flag32: false, flag33: false, flag34: false, flag35: false,
  }
}

// Simulate an immutable splice: replace one path with a new value, preserving structural sharing elsewhere.
export function splice<T>(state: T, path: string[], value: unknown): T {
  if (path.length === 0) return value as T
  const [head, ...rest] = path
  const cur = (state as Record<string, unknown>)[head!]
  const next = splice(cur as T, rest, value)
  if (next === cur) return state
  return { ...state, [head!]: next } as T
}
