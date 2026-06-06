import { PACKAGES } from './packages.js'

export default (pageContext: { urlPathname: string }) => {
  const match = pageContext.urlPathname.match(/^\/api\/(.+?)(?:\/)?$/)
  if (!match) return false
  const pkg = match[1]
  if (!PACKAGES.includes(pkg!)) return false
  return { routeParams: { pkg } }
}
