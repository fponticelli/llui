export interface BindingSourceEntry {
  bindingIndex: number
  file: string
  line: number
  column: number
}

export interface CompilerCacheEntry {
  preSource: string
  postSource: string
  msgMaskMap: Record<string, number>
  bindingSources: BindingSourceEntry[]
}

const MAX_ENTRIES = 50

export class CompilerCache {
  private readonly cache = new Map<string, CompilerCacheEntry>()

  set(componentName: string, entry: CompilerCacheEntry): void {
    if (this.cache.has(componentName)) this.cache.delete(componentName)
    this.cache.set(componentName, entry)
    if (this.cache.size > MAX_ENTRIES) {
      this.cache.delete(this.cache.keys().next().value!)
    }
  }

  get(componentName: string): CompilerCacheEntry | undefined {
    return this.cache.get(componentName)
  }

  has(componentName: string): boolean {
    return this.cache.has(componentName)
  }
}

export const compilerCache = new CompilerCache()
