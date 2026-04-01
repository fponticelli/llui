export function errorBoundary(_opts: {
  render: () => Node[]
  fallback: (error: Error) => Node[]
  onError?: (error: Error) => void
}): Node[] {
  // TODO: implement
  throw new Error('errorBoundary not yet implemented')
}
