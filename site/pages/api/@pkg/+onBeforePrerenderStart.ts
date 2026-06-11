import { PACKAGES } from './packages.js'

export function onBeforePrerenderStart() {
  return PACKAGES.map((pkg) => `/api/${pkg.slug}`)
}
