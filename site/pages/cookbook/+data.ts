import { loadDoc } from '../../src/markdown'

export async function data() {
  return loadDoc('cookbook')
}
