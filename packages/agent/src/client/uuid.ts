export function randomUUID(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  // Simple v4 fallback for environments without crypto.randomUUID
  const chars = '0123456789abcdef'
  let s = ''
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      s += '-'
    } else if (i === 14) {
      s += '4'
    } else if (i === 19) {
      s += chars[((Math.random() * 4) | 0) + 8]
    } else {
      s += chars[(Math.random() * 16) | 0]
    }
  }
  return s
}
