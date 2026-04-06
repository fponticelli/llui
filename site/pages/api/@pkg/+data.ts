import { loadDoc } from '../../../src/markdown'

export async function data(pageContext: { routeParams: { pkg: string } }) {
  return loadDoc(`api/${pageContext.routeParams.pkg}`)
}
