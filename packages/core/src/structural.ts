export interface StructuralBlock {
  reconcile(state: unknown, dirtyMask: number): void
}

const blocks: StructuralBlock[] = []

export function registerStructuralBlock(block: StructuralBlock): void {
  blocks.push(block)
}

export function removeStructuralBlock(block: StructuralBlock): void {
  const idx = blocks.indexOf(block)
  if (idx !== -1) blocks.splice(idx, 1)
}

export function runPhase1(state: unknown, dirtyMask: number): void {
  // Iterate a copy — reconcile may add/remove blocks
  const snapshot = blocks.slice()
  for (const block of snapshot) {
    block.reconcile(state, dirtyMask)
  }
}
