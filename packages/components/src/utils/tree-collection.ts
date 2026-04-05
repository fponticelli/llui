/**
 * TreeCollection — helper for building tree-view payloads from a nested
 * data structure. Tree-view's state machine only knows about flat lists
 * (visibleItems, visibleLabels) and opaque ids; the collection owns the
 * structure and derives those flat arrays on demand.
 *
 * Typical flow:
 *
 *   const col = new TreeCollection(data)
 *   state.visibleItems = col.visibleItems(state.expanded)
 *   state.visibleLabels = col.visibleLabels(state.expanded)
 *
 * After every `expand` / `collapse` message, the consumer dispatches
 * `setVisibleItems` with the updated arrays. The collection itself is
 * immutable — build a new one when the tree structure changes.
 */

export interface TreeNode {
  id: string
  label?: string
  disabled?: boolean
  children?: TreeNode[]
}

interface NodeInfo {
  node: TreeNode
  parentId: string | null
  depth: number
  childIds: string[]
}

export class TreeCollection {
  readonly roots: TreeNode[]
  private readonly info: Map<string, NodeInfo>

  constructor(roots: TreeNode | TreeNode[]) {
    this.roots = Array.isArray(roots) ? roots : [roots]
    this.info = new Map()
    this.index()
  }

  private index(): void {
    const walk = (node: TreeNode, parentId: string | null, depth: number): void => {
      const children = node.children ?? []
      this.info.set(node.id, {
        node,
        parentId,
        depth,
        childIds: children.map((c) => c.id),
      })
      for (const child of children) walk(child, node.id, depth + 1)
    }
    for (const root of this.roots) walk(root, null, 0)
  }

  /** All ids in the collection, in depth-first order. */
  get allIds(): string[] {
    return Array.from(this.info.keys())
  }

  getNode(id: string): TreeNode | null {
    return this.info.get(id)?.node ?? null
  }

  getLabel(id: string): string {
    const node = this.getNode(id)
    return node?.label ?? id
  }

  getParent(id: string): string | null {
    return this.info.get(id)?.parentId ?? null
  }

  getDepth(id: string): number {
    return this.info.get(id)?.depth ?? 0
  }

  getChildren(id: string): string[] {
    return this.info.get(id)?.childIds ?? []
  }

  /** All descendants of id in depth-first order (excluding id itself). */
  getDescendants(id: string): string[] {
    const out: string[] = []
    const walk = (current: string): void => {
      for (const childId of this.getChildren(current)) {
        out.push(childId)
        walk(childId)
      }
    }
    walk(id)
    return out
  }

  isBranch(id: string): boolean {
    return this.getChildren(id).length > 0
  }

  isDisabled(id: string): boolean {
    return this.info.get(id)?.node.disabled === true
  }

  /**
   * The ordered list of visible item ids given a set of expanded branches.
   * A branch's descendants appear only if every ancestor up to a root is
   * in `expanded`.
   */
  visibleItems(expanded: string[]): string[] {
    const expandedSet = new Set(expanded)
    const out: string[] = []
    const walk = (nodes: TreeNode[]): void => {
      for (const node of nodes) {
        out.push(node.id)
        if (expandedSet.has(node.id) && node.children) {
          walk(node.children)
        }
      }
    }
    walk(this.roots)
    return out
  }

  /** Parallel array of labels for `visibleItems()`, using `label ?? id`. */
  visibleLabels(expanded: string[]): string[] {
    return this.visibleItems(expanded).map((id) => this.getLabel(id))
  }

  /**
   * Ids of all branches in the collection (useful for `expandAll`).
   */
  get branchIds(): string[] {
    const out: string[] = []
    for (const [id, info] of this.info) {
      if (info.childIds.length > 0) out.push(id)
    }
    return out
  }

  /**
   * Compute the indeterminate-set from a set of checked ids: any branch
   * whose descendants are partially — but not fully — checked. Useful as
   * a post-toggleChecked reconciler:
   *
   *   const indeterminate = col.computeIndeterminate(new Set(state.checked))
   *   send({ type: 'setIndeterminate', ids: indeterminate })
   */
  computeIndeterminate(checked: Set<string>): string[] {
    const out: string[] = []
    for (const [id, info] of this.info) {
      if (info.childIds.length === 0) continue
      const desc = this.getDescendants(id)
      if (desc.length === 0) continue
      let checkedCount = 0
      for (const d of desc) if (checked.has(d)) checkedCount++
      if (checkedCount > 0 && checkedCount < desc.length) out.push(id)
    }
    return out
  }
}
