export type ClassValue = string | false | null | undefined

/** Concatenate class strings, filtering falsy values. */
export function cx(...classes: ClassValue[]): string {
  let result = ''
  for (const c of classes) {
    if (c) {
      if (result) result += ' '
      result += c
    }
  }
  return result
}
