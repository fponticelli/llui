import type { ProductContract } from '../src/product-contract'

export type ProductInventory = {
  machineImports: readonly string[]
  registryItems: readonly string[]
}

export function assertProductInventory(
  contract: ProductContract,
  inventory: ProductInventory,
): void {
  const declaredMachines = contract.entries.flatMap(({ machine }) =>
    machine.kind === 'public' ? [machine.importPath] : [],
  )
  const declaredArtifacts = contract.entries.flatMap(({ copiedArtifacts }) =>
    copiedArtifacts.map(({ name }) => name),
  )
  const errors = [
    ...duplicates(inventory.machineImports).map(
      (name) => `Duplicate public machine export: ${name}`,
    ),
    ...difference(inventory.machineImports, declaredMachines).map(
      (name) => `Unclassified public machine import: ${name}`,
    ),
    ...difference(declaredMachines, inventory.machineImports).map(
      (name) => `Invalid public machine import: ${name}`,
    ),
    ...duplicates(inventory.registryItems).map(
      (name) => `Duplicate published registry item: ${name}`,
    ),
    ...difference(inventory.registryItems, declaredArtifacts).map(
      (name) => `Orphan registry item: ${name}`,
    ),
    ...difference(declaredArtifacts, inventory.registryItems).map(
      (name) => `Unpublished copied artifact: ${name}`,
    ),
  ]

  if (errors.length > 0) throw new Error(errors.join('\n'))
}

function difference(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right)
  return [...new Set(left)].filter((value) => !rightSet.has(value)).sort()
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const repeated = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) repeated.add(value)
    seen.add(value)
  }
  return [...repeated].sort()
}
