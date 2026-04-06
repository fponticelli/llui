import { cx, type ClassValue } from './cx'

export type VariantRecord = Record<string, Record<string, string>>

export interface VariantConfig<V extends VariantRecord> {
  base: string
  variants: V
  defaultVariants?: { [K in keyof V]?: keyof V[K] }
  compoundVariants?: Array<{ [K in keyof V]?: keyof V[K] } & { class: string }>
}

export type VariantProps<V extends VariantRecord> = {
  [K in keyof V]?: keyof V[K]
}

export function createVariants<V extends VariantRecord>(
  config: VariantConfig<V>,
): (props?: VariantProps<V>) => string {
  return (props = {} as VariantProps<V>): string => {
    const resolved: Record<string, string | undefined> = {}

    for (const key of Object.keys(config.variants)) {
      resolved[key] =
        (props[key] as string | undefined) ?? (config.defaultVariants?.[key] as string | undefined)
    }

    const parts: ClassValue[] = [config.base]
    for (const [key, value] of Object.entries(resolved)) {
      if (value != null && config.variants[key]?.[value]) {
        parts.push(config.variants[key]![value])
      }
    }

    if (config.compoundVariants) {
      for (const compound of config.compoundVariants) {
        const { class: cls, ...conditions } = compound
        const match = Object.entries(conditions).every(([k, v]) => resolved[k] === v)
        if (match) parts.push(cls)
      }
    }

    return cx(...parts)
  }
}
