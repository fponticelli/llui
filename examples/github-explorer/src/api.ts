const BASE = 'https://api.github.com'

export function searchUrl(q: string, page: number): string {
  return `${BASE}/search/repositories?q=${encodeURIComponent(q)}&per_page=10&page=${page + 1}`
}

export function repoUrl(owner: string, name: string): string {
  return `${BASE}/repos/${owner}/${name}`
}

export function contentsUrl(owner: string, name: string, path: string): string {
  const p = path ? `/${path}` : ''
  return `${BASE}/repos/${owner}/${name}/contents${p}`
}

export function readmeUrl(owner: string, name: string): string {
  return `${BASE}/repos/${owner}/${name}/readme`
}

export function issuesUrl(owner: string, name: string): string {
  return `${BASE}/repos/${owner}/${name}/issues?per_page=20&state=open`
}

export const JSON_HEADERS: Record<string, string> = {
  Accept: 'application/vnd.github.v3+json',
}

export const HTML_HEADERS: Record<string, string> = {
  Accept: 'application/vnd.github.v3.html',
}
