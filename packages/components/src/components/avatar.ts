import type { Send } from '@llui/dom'

/**
 * Avatar — image with automatic fallback. Tracks image load status so
 * consumers can render the image, a fallback (initials, icon), or a
 * loading placeholder.
 */

export type ImageStatus = 'idle' | 'loading' | 'loaded' | 'error'

export interface AvatarState {
  status: ImageStatus
}

export type AvatarMsg =
  | { type: 'loadStart' }
  | { type: 'loaded' }
  | { type: 'error' }
  | { type: 'reset' }

export interface AvatarInit {
  status?: ImageStatus
}

export function init(opts: AvatarInit = {}): AvatarState {
  return { status: opts.status ?? 'idle' }
}

export function update(state: AvatarState, msg: AvatarMsg): [AvatarState, never[]] {
  switch (msg.type) {
    case 'loadStart':
      return [{ ...state, status: 'loading' }, []]
    case 'loaded':
      return [{ ...state, status: 'loaded' }, []]
    case 'error':
      return [{ ...state, status: 'error' }, []]
    case 'reset':
      return [{ ...state, status: 'idle' }, []]
  }
}

export interface AvatarParts<S> {
  root: {
    'data-scope': 'avatar'
    'data-part': 'root'
    'data-status': (s: S) => ImageStatus
  }
  image: {
    'data-scope': 'avatar'
    'data-part': 'image'
    'data-status': (s: S) => ImageStatus
    hidden: (s: S) => boolean
    alt: string
    onLoad: (e: Event) => void
    onError: (e: Event) => void
    onLoadStart: (e: Event) => void
  }
  fallback: {
    'data-scope': 'avatar'
    'data-part': 'fallback'
    'data-status': (s: S) => ImageStatus
    hidden: (s: S) => boolean
    'aria-hidden': (s: S) => 'true' | undefined
  }
}

export interface ConnectOptions {
  alt?: string
}

export function connect<S>(
  get: (s: S) => AvatarState,
  send: Send<AvatarMsg>,
  opts: ConnectOptions = {},
): AvatarParts<S> {
  const alt = opts.alt ?? ''
  return {
    root: {
      'data-scope': 'avatar',
      'data-part': 'root',
      'data-status': (s) => get(s).status,
    },
    image: {
      'data-scope': 'avatar',
      'data-part': 'image',
      'data-status': (s) => get(s).status,
      hidden: (s) => get(s).status !== 'loaded',
      alt,
      onLoad: () => send({ type: 'loaded' }),
      onError: () => send({ type: 'error' }),
      onLoadStart: () => send({ type: 'loadStart' }),
    },
    fallback: {
      'data-scope': 'avatar',
      'data-part': 'fallback',
      'data-status': (s) => get(s).status,
      hidden: (s) => get(s).status === 'loaded',
      'aria-hidden': (s) => (get(s).status === 'loaded' ? 'true' : undefined),
    },
  }
}

export const avatar = { init, update, connect }
