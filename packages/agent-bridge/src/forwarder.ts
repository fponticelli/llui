export type ForwardResult =
  | { ok: true; body: unknown }
  | { ok: false; status: number; error: unknown }

export type ForwardDeps = {
  fetch?: typeof fetch
}

/**
 * POST {baseUrl}{path} with Authorization: Bearer {token}, JSON body.
 * Returns a discriminated success/failure envelope.
 * Spec §11.4.
 */
export async function forwardLap(
  baseUrl: string,
  token: string,
  path: string,
  args: object,
  deps: ForwardDeps = {},
): Promise<ForwardResult> {
  const doFetch = deps.fetch ?? fetch.bind(globalThis)
  const url = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) + path : baseUrl + path
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(args),
    })
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      body = null
    }
    if (!res.ok) return { ok: false, status: res.status, error: body }
    return { ok: true, body }
  } catch (e) {
    return { ok: false, status: 0, error: { code: 'network', detail: String(e) } }
  }
}
