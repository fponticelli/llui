import { EXAMPLE_SLUGS } from '../../../src/examples-data'

export function onBeforePrerenderStart() {
  return EXAMPLE_SLUGS.map((slug) => `/examples/${slug}`)
}
