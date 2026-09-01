import { tagSend } from '@llui/dom'
import type { Send, Signal } from '@llui/dom'

/**
 * Avatar — image with automatic fallback. Tracks image load status so
 * consumers can render the image, a fallback (initials, icon), or a
 * loading placeholder.
 */

export type ImageStatus = 'idle' | 'loading' | 'loaded' | 'error'

/** Optional density of the styled avatar root; behavior remains unchanged. */
export type AvatarDensity = 'comfortable' | 'compact'

export interface AvatarState {
  status: ImageStatus
}

export type AvatarMsg =
  /** @humanOnly */
  | { type: 'loadStart' }
  /** @humanOnly */
  | { type: 'loaded' }
  /** @humanOnly */
  | { type: 'error' }
  /** @intent("Reset the avatar's load status back to idle") */
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

export interface AvatarParts {
  root: {
    'data-scope': 'avatar'
    'data-part': 'root'
    'data-status': Signal<ImageStatus>
    'data-density': AvatarDensity | undefined
  }
  image: {
    'data-scope': 'avatar'
    'data-part': 'image'
    'data-status': Signal<ImageStatus>
    hidden: Signal<boolean>
    alt: string
    onLoad: (e: Event) => void
    onError: (e: Event) => void
    onLoadStart: (e: Event) => void
  }
  fallback: {
    'data-scope': 'avatar'
    'data-part': 'fallback'
    'data-status': Signal<ImageStatus>
    hidden: Signal<boolean>
    'aria-hidden': Signal<'true' | undefined>
  }
}

export interface ConnectOptions {
  alt?: string
  /** Presentation density published on the root for either skin to consume. */
  density?: AvatarDensity
}

export function connect(
  state: Signal<AvatarState>,
  send: Send<AvatarMsg>,
  opts: ConnectOptions = {},
): AvatarParts {
  const alt = opts.alt ?? ''
  return {
    root: {
      'data-scope': 'avatar',
      'data-part': 'root',
      'data-status': state.map((s) => s.status),
      'data-density': opts.density,
    },
    image: {
      'data-scope': 'avatar',
      'data-part': 'image',
      'data-status': state.map((s) => s.status),
      hidden: state.map((s) => s.status !== 'loaded'),
      alt,
      onLoad: tagSend(send, ['loaded'], () => send({ type: 'loaded' })),
      onError: tagSend(send, ['error'], () => send({ type: 'error' })),
      onLoadStart: tagSend(send, ['loadStart'], () => send({ type: 'loadStart' })),
    },
    fallback: {
      'data-scope': 'avatar',
      'data-part': 'fallback',
      'data-status': state.map((s) => s.status),
      hidden: state.map((s) => s.status === 'loaded'),
      'aria-hidden': state.map((s) => (s.status === 'loaded' ? 'true' : undefined)),
    },
  }
}

export const avatar = { init, update, connect }
