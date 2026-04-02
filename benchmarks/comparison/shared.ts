// Shared data builder — identical across all frameworks
let nextId = 1
const adjectives = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'nice', 'quick']
const nouns = ['table', 'chair', 'house', 'mouse', 'car', 'bike', 'tree', 'bird', 'fish']

export type Row = { id: number; label: string }

export function buildData(count: number): Row[] {
  const data: Row[] = []
  for (let i = 0; i < count; i++) {
    data.push({
      id: nextId++,
      label: adjectives[nextId % adjectives.length]! + ' ' + nouns[nextId % nouns.length]!,
    })
  }
  return data
}
