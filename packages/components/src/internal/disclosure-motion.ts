/**
 * Measure the content's natural logical block size at the animation boundary.
 *
 * CSS cannot interpolate from `0` to `auto`. Both supported skins instead
 * animate to this pixel custom property, which is refreshed for every enter
 * and exit so dynamic content never reuses a stale endpoint.
 */
export function measureDisclosureBlockSize(event: AnimationEvent): void {
  if (event.currentTarget !== event.target || !(event.currentTarget instanceof HTMLElement)) return
  const element = event.currentTarget
  const style = getComputedStyle(element)
  const writingMode = style.writingMode
  const vertical = writingMode.startsWith('vertical') || writingMode.startsWith('sideways')
  const scrollSize = vertical ? element.scrollWidth : element.scrollHeight
  const paddingStart = Number.parseFloat(style.paddingBlockStart) || 0
  const paddingEnd = Number.parseFloat(style.paddingBlockEnd) || 0
  const borderStart = Number.parseFloat(style.borderBlockStartWidth) || 0
  const borderEnd = Number.parseFloat(style.borderBlockEndWidth) || 0
  const blockSize =
    style.boxSizing === 'border-box'
      ? scrollSize + borderStart + borderEnd
      : scrollSize - paddingStart - paddingEnd
  if (!Number.isFinite(blockSize) || blockSize < 0) return
  element.style.setProperty('--llui-disclosure-block-size', `${blockSize}px`)
}

interface NamedAnimation extends Animation {
  readonly animationName?: string
}

export interface ArmedDisclosureExit {
  readonly animationName: string
  readonly generation: number
  readonly animation?: Animation
}

/** Arm the concrete CSS animation that began for one exit generation. */
export function armDisclosureExit(
  event: AnimationEvent,
  generation: number,
): ArmedDisclosureExit | undefined {
  measureDisclosureBlockSize(event)
  if (event.currentTarget !== event.target || !(event.currentTarget instanceof HTMLElement))
    return undefined
  const expectedName = getComputedStyle(event.currentTarget)
    .getPropertyValue('--llui-disclosure-exit-animation')
    .trim()
  if (expectedName === '' || event.animationName !== expectedName) return undefined
  const animations =
    typeof event.currentTarget.getAnimations === 'function'
      ? event.currentTarget.getAnimations({ subtree: false })
      : []
  const animation = animations.find(
    (candidate) =>
      (candidate as NamedAnimation).animationName === event.animationName &&
      candidate.playState !== 'finished' &&
      candidate.playState !== 'idle',
  )
  return {
    animationName: event.animationName,
    generation,
    ...(animation === undefined ? {} : { animation }),
  }
}

/**
 * Match completion to the exact armed generation and, when Web Animations is
 * available, the concrete animation object. A stale same-name cancel sees the
 * newer animation still running and cannot consume it.
 */
export function matchesArmedDisclosureExit(
  event: AnimationEvent,
  generation: number,
  armed: ArmedDisclosureExit | undefined,
): armed is ArmedDisclosureExit {
  if (
    event.currentTarget !== event.target ||
    armed === undefined ||
    armed.generation !== generation ||
    armed.animationName !== event.animationName
  )
    return false
  return (
    armed.animation === undefined ||
    !['running', 'paused', 'pending'].includes(armed.animation.playState)
  )
}
