import { describe, it, expect } from 'vitest'
import { renderToString } from '../src/ssr'
import { linkedomEnv } from '../src/ssr/linkedom'
import { component, div, select, option, portal, text, show } from '../src/index'

describe('linkedomEnv — HTMLSelectElement.value setter patch', () => {
  it('mirrors `select.value = X` as `<option value="X" selected>` in the SSR output', async () => {
    type S = { selected: string }
    const Def = component<S, never, never>({
      name: 'SelectBind',
      init: () => [{ selected: 'b' }, []],
      update: (s) => [s, []],
      view: () => [
        select({ value: (s: S) => s.selected }, [
          option({ value: 'a' }, [text('A')]),
          option({ value: 'b' }, [text('B')]),
          option({ value: 'c' }, [text('C')]),
        ]),
      ],
      __dirty: (o, n) => (Object.is(o.selected, n.selected) ? 0 : 1),
    })

    const env = await linkedomEnv()
    // Before the patch, this threw
    //   TypeError: Cannot set property value of [object Object]
    //   which has only a getter
    // because linkedom ships HTMLSelectElement.prototype.value as
    // get-only. Now the setter toggles option[selected] instead.
    const html = renderToString(Def, { selected: 'b' }, env)

    // Linkedom serializes attributes in insertion order; `selected`
    // was added by our setter patch BEFORE the option's value
    // attribute was set, so the resulting serialization has
    // `selected` first. Match both orderings.
    expect(html).toMatch(
      /<option[^>]*\bselected[^>]*value="b"|<option[^>]*value="b"[^>]*\bselected/,
    )
    expect(html).not.toMatch(
      /<option[^>]*value="a"[^>]*\bselected|<option[^>]*\bselected[^>]*value="a"/,
    )
    expect(html).not.toMatch(
      /<option[^>]*value="c"[^>]*\bselected|<option[^>]*\bselected[^>]*value="c"/,
    )
  })

  it('getter returns the currently-selected option value', async () => {
    const env = await linkedomEnv()
    const sel = env.createElement('select') as HTMLSelectElement
    const optA = env.createElement('option') as HTMLOptionElement
    optA.setAttribute('value', 'a')
    optA.textContent = 'A'
    const optB = env.createElement('option') as HTMLOptionElement
    optB.setAttribute('value', 'b')
    optB.textContent = 'B'
    sel.appendChild(optA)
    sel.appendChild(optB)

    sel.value = 'b'
    expect(sel.value).toBe('b')

    sel.value = 'a'
    expect(sel.value).toBe('a')
  })
})

describe('portal() — SSR safety under linkedom', () => {
  it('returns no nodes when a string target cannot be resolved (SSR fallback-render case)', async () => {
    // Reproduces the /my-rolls crash: a component view that calls
    // portal() during SSR must not throw `ReferenceError: document
    // is not defined`. Portal is semantically a client-only concept
    // (its target lives outside the rendered subtree), so SSR emits
    // nothing for it.
    type S = { visible: boolean }
    const Def = component<S, never, never>({
      name: 'PortalOverlay',
      init: () => [{ visible: true }, []],
      update: (s) => [s, []],
      view: () => [
        div({ class: 'host' }, [
          ...show<S>({
            when: (s) => s.visible,
            render: () => [
              ...portal({
                target: '#does-not-exist',
                render: () => [div({ class: 'overlay-content' })],
              }),
            ],
          }),
        ]),
      ],
      __dirty: (o, n) => (Object.is(o.visible, n.visible) ? 0 : 1),
    })

    const env = await linkedomEnv()
    const html = renderToString(Def, { visible: true }, env)

    // The host element is serialized; the portal's content isn't
    // (portals return [] to the parent regardless of where the
    // nodes land). The important assertion is that render did not
    // throw during SSR.
    expect(html).toContain('class="host"')
    expect(html).not.toContain('overlay-content')
  })

  it('uses the env to resolve string targets instead of bare document (no globalThis access)', async () => {
    // The linkedom env's document has its own body. A target like
    // `body` should resolve through `ctx.dom.querySelector` to THAT
    // document's body, not globalThis.document.
    type S = Record<string, never>
    const Def = component<S, never, never>({
      name: 'PortalBody',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [
        div({ class: 'host' }, [
          ...portal({
            target: 'body',
            render: () => [div({ class: 'portalled' })],
          }),
        ]),
      ],
    })

    const env = await linkedomEnv()
    // No throw. Whether the portalled content appears in `html`
    // depends on whether linkedom's serializer walks the whole
    // document (it doesn't — we pass only the component's own
    // nodes), so we just assert the render completes.
    const html = renderToString(Def, {}, env)
    expect(html).toContain('class="host"')
  })
})
