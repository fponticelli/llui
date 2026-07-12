import { describe, it, expect, afterEach } from 'vitest'
import { getElementByIdInScope } from '../../src/utils/root-scope'

// Overlays resolve their trigger/content parts by id inside `onMount`, which used
// to call the GLOBAL `document.getElementById`. When the component is mounted
// inside a shadow root (isolate mode) the parts live in that ShadowRoot, which
// `document.getElementById` cannot see into — it returns null and floating
// positioning silently no-ops. `getElementByIdInScope` resolves against the
// reference node's OWN root (`Document` in light DOM, the enclosing `ShadowRoot`
// under isolation), both of which expose `getElementById`.

describe('getElementByIdInScope', () => {
  const created: Element[] = []
  afterEach(() => {
    for (const el of created.splice(0)) el.remove()
  })

  it('resolves an id in the light DOM, identical to document.getElementById', () => {
    const host = document.createElement('div')
    const target = document.createElement('span')
    target.id = 'light-target'
    host.appendChild(target)
    document.body.appendChild(host)
    created.push(host)

    expect(getElementByIdInScope(host, 'light-target')).toBe(target)
    expect(getElementByIdInScope(host, 'light-target')).toBe(
      document.getElementById('light-target'),
    )
  })

  it('resolves an id that lives under a ShadowRoot (isolate-mode positioning)', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    created.push(host)
    const shadow = host.attachShadow({ mode: 'open' })

    const trigger = document.createElement('button')
    trigger.id = 'shadow-trigger'
    const content = document.createElement('div')
    content.id = 'shadow-content'
    shadow.append(trigger, content)

    // The bug: the global document cannot see into the shadow tree.
    expect(document.getElementById('shadow-trigger')).toBeNull()

    // The fix: resolving via a node inside the shadow tree finds the parts, so
    // positioning can anchor the content to the trigger.
    expect(getElementByIdInScope(content, 'shadow-trigger')).toBe(trigger)
    expect(getElementByIdInScope(trigger, 'shadow-content')).toBe(content)
  })

  it('returns null for a missing id', () => {
    expect(getElementByIdInScope(document.body, 'not-a-real-id')).toBeNull()
  })
})
