export interface StructuralBlock {
  reconcile(state: unknown, dirtyMask: number): void
}
