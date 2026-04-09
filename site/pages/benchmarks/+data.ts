import { readFileSync } from 'fs'
import { resolve } from 'path'
import { loadDoc } from '../../src/markdown'

export type BenchmarkData = Record<string, Record<string, number>>

export interface BenchmarksPageData {
  title: string
  description: string
  html: string
  slug: string
  section?: string
  order?: number
  benchmarks: BenchmarkData
}

export async function data(): Promise<BenchmarksPageData> {
  const doc = await loadDoc('benchmarks')
  const benchmarks = JSON.parse(
    readFileSync(resolve(process.cwd(), 'public/benchmark-data.json'), 'utf-8'),
  ) as BenchmarkData
  return { ...doc, benchmarks }
}
