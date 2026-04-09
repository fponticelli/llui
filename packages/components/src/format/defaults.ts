/** Default locale: navigator.language in browsers, 'en' in SSR/tests. */
export function defaultLocale(): string {
  return typeof navigator !== 'undefined' ? navigator.language : 'en'
}
