const API_BASE = 'https://api.realworld.io/api'

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) h['Authorization'] = `Token ${token}`
  return h
}

export function apiUrl(path: string, params?: Record<string, string | number>): string {
  let url = `${API_BASE}${path}`
  if (params) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== '' && v !== undefined)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&')
    if (qs) url += `?${qs}`
  }
  return url
}

export function authHeaders(token: string): Record<string, string> {
  return headers(token)
}

export function publicHeaders(): Record<string, string> {
  return headers()
}
