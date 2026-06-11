import { PACKAGE_SLUGS } from './packages.js'

export default (pageContext: { urlPathname: string }) => {
  const match = pageContext.urlPathname.match(/^\/api\/(.+?)(?:\/)?$/)
  if (!match) return false
  const pkg = match[1]
  if (!PACKAGE_SLUGS.includes(pkg!)) return false
  return { routeParams: { pkg } }
}
