import { EXAMPLE_SLUGS } from '../../../src/examples-data'

export default (pageContext: { urlPathname: string }) => {
  const match = pageContext.urlPathname.match(/^\/examples\/(.+?)(?:\/)?$/)
  if (!match) return false
  const name = match[1]!
  if (!EXAMPLE_SLUGS.includes(name)) return false
  return { routeParams: { name } }
}
