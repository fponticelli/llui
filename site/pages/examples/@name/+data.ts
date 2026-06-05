import { loadDoc } from '../../../src/markdown'

export async function data(pageContext: { routeParams: { name: string } }) {
  return loadDoc(`examples/${pageContext.routeParams.name}`)
}
