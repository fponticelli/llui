import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import {
  div,
  span,
  input,
  button,
  text,
  each,
  branch,
  unsafeHtml,
  onMount,
} from '../../src/signals/index'

// ---------------------------------------------------------------------------
// dungeonlogs signal-migration spike.
//
// dungeonlogs (a local-first TTRPG worldbuilder on @llui/dom) is migrating off
// the 0.4.x callback/path-analyzer runtime. These tests reproduce the FOUR
// patterns that are load-bearing in that app and historically fragile, to
// prove the signal runtime (0.5.10) handles them BEFORE we commit ~14k LOC of
// view code. Each test names the dungeonlogs surface it stands in for.
// ---------------------------------------------------------------------------

describe('dungeonlogs spike #1 — route-keyed subtree remount (replaces h.scope({on}))', () => {
  // app.ts uses `h.scope({ on: (s) => routeKey(s.route) })` to remount the
  // whole route subtree when the key changes — INCLUDING entity→entity within
  // the same route *kind* (the key embeds the entity id). The signal runtime
  // has no `scope` primitive. `branch` swaps on a discriminant, but within one
  // arm an id change does NOT remount. The proposed idiom is a single-row
  // `each` keyed by id. This asserts that idiom actually forces a remount.
  interface S {
    entityId: string
  }
  type M = { type: 'goto'; id: string }

  it('single-row each keyed by id remounts the subtree on id change', () => {
    const mounts: string[] = []
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init: () => ({ entityId: 'a' }),
      update: (_s, m) => ({ entityId: m.id }),
      view: ({ state }) => [
        div({}, [
          each(
            state.at('entityId').map((id) => [id]),
            {
              key: (id) => id,
              render: (item) => [
                div({ class: 'detail' }, [
                  span({ class: 'eid' }, [text(item)]),
                  // onMount fires once per mounted row — the remount probe.
                  div({}, [
                    onMount(() => {
                      mounts.push(item.peek())
                      return () => {}
                    }),
                  ]),
                ]),
              ],
            },
          ),
        ]),
      ],
    })

    expect(mounts).toEqual(['a'])
    expect(container.querySelector('.eid')?.textContent).toBe('a')

    h.send({ type: 'goto', id: 'b' })
    // If the subtree remounted, onMount fired again for 'b'.
    expect(mounts).toEqual(['a', 'b'])
    expect(container.querySelector('.eid')?.textContent).toBe('b')
    h.dispose()
  })
})

describe('dungeonlogs spike #2 — inline-edit commit: send during structural arm swap (0.5.10 reentrancy)', () => {
  // The trait-editor / fact-row inline edit: an <input> lives in the `edit`
  // arm of a branch. Committing flips editing→false, which swaps the arm and
  // removes the focused input — in a browser that fires blur synchronously,
  // re-entering the reducer mid-reconcile. The 0.5.10 fix QUEUES the reentrant
  // send rather than nesting a reducer+reconcile, so (a) the outer message's
  // effects still run (the bug dropped them — in dungeonlogs, a dropped op
  // submit) and (b) the scope tree / DOM are never mutated mid-reconcile.
  //
  // Here we trigger the reentrancy deterministically — the freshly-mounted
  // `view` arm's onMount sends a follow-up DURING commit's reconcile (jsdom does
  // not fire blur on node removal, so the literal blur path can't be driven in
  // this package). The genuine focus→blur→commit path, with browser-faithful
  // synchronous blur, is covered end-to-end in
  // `@llui/test`'s `inline-edit-commit.test.ts` via `emulateBlurOnRemoval`.
  interface S {
    editing: boolean
    draft: string
    committed: string
    log: string[]
  }
  type M = { type: 'commit' } | { type: 'after-swap' }
  // `swept` is emitted by the reentrant message; its position relative to
  // `persist` is the queue-vs-nest discriminator (see assertions below).
  type E = { type: 'persist'; value: string } | { type: 'swept' }

  it('reentrant send during arm swap is queued — outer effect kept, no nesting', () => {
    const effects: E[] = []
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M, E>(container, {
      init: () => [{ editing: true, draft: 'Gandalf', committed: '', log: [] }, []],
      update: (s, m) => {
        switch (m.type) {
          case 'commit':
            // outer message: persist + leave edit mode (swaps the arm)
            return [
              { ...s, editing: false, committed: s.draft },
              [{ type: 'persist', value: s.draft }],
            ]
          case 'after-swap':
            return [{ ...s, log: [...s.log, 'after-swap'] }, [{ type: 'swept' }]]
        }
      },
      onEffect: (e) => {
        effects.push(e)
      },
      view: ({ state, send }) => [
        branch(
          state.at('editing').map((e) => (e ? 'edit' : 'view')),
          {
            edit: () => [
              input({
                id: 'name',
                value: state.at('draft'),
                onBlur: () => send({ type: 'commit' }),
              }),
              button({ id: 'commit', onClick: () => send({ type: 'commit' }) }, [text('Save')]),
            ],
            view: () => [
              // Reentrant send: this fires while the commit message is still
              // being processed (the arm is mounting inside commit's reconcile).
              onMount(() => {
                send({ type: 'after-swap' })
                return () => {}
              }),
              span({ id: 'committed' }, [text(state.at('committed'))]),
            ],
          },
        ),
      ],
    })

    expect(() => h.send({ type: 'commit' })).not.toThrow()
    h.flush()

    expect(container.querySelector('#committed')?.textContent).toBe('Gandalf')
    // Effect ORDER proves queueing, not nesting: a queued reentrant send drains
    // the outer commit FULLY (persist) before the reentrant message runs (swept).
    // A nested reducer would emit `swept` from inside commit's reconcile —
    // BEFORE persist — and the historic bug dropped persist entirely.
    expect(effects).toEqual([{ type: 'persist', value: 'Gandalf' }, { type: 'swept' }])
    // The queued reentrant message was actually processed (not silently lost).
    expect(h.getState().log).toEqual(['after-swap'])
    h.dispose()
  })
})

describe('dungeonlogs spike #3 — dirty-buffer re-modeled as draft+commit (async ACK must not stomp typing)', () => {
  // Today dungeonlogs carries an `inputBuffer` Record + `factDirtyEpoch` to stop
  // an async save-ACK from overwriting in-progress typing. dicerun drops the
  // buffer: value reads a `draft` field, commit writes canon. This asserts that
  // an interleaved ACK (updates `committed`, not `draft`) does NOT rewrite the
  // live input value — i.e. the buffer can be deleted in the migration.
  interface S {
    draft: string
    committed: string
  }
  type M = { type: 'type'; value: string } | { type: 'ack'; value: string }

  it('an async ACK that changes committed does not disturb the input value', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init: () => ({ draft: '', committed: '' }),
      update: (s, m) =>
        m.type === 'type' ? { ...s, draft: m.value } : { ...s, committed: m.value },
      view: ({ state, send }) => [
        input({
          id: 'fact',
          value: state.at('draft'),
          onInput: (e: Event) =>
            send({ type: 'type', value: (e.target as HTMLInputElement).value }),
        }),
      ],
    })

    const el = container.querySelector('#fact') as HTMLInputElement
    el.value = 'Minas Tirith'
    el.dispatchEvent(new Event('input', { bubbles: true }))
    h.flush()
    expect(el.value).toBe('Minas Tirith')

    // Async save ACK lands mid-typing: updates committed, leaves draft alone.
    h.send({ type: 'ack', value: 'stale-server-value' })
    expect(el.value).toBe('Minas Tirith') // typing preserved — buffer not needed
    h.dispose()
  })
})

describe('dungeonlogs spike #4 — nested each over row item (0.5.8) + reactive unsafeHtml (rich_text)', () => {
  // viewMultiInput / tuple inputs: an outer `each` over facts, each row renders
  // an inner `each` over that row's values (`each(item.at('values'))`). And
  // rich_text facts render markdown via unsafeHtml — must update reactively.
  interface Row {
    id: string
    label: string
    values: string[]
  }
  interface S {
    rows: Row[]
    html: string
  }
  type M = { type: 'set-html'; html: string }

  it('inner each reads the row item and unsafeHtml reacts to a signal', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent<S, M>(container, {
      init: () => ({
        rows: [
          { id: 'r1', label: 'Aliases', values: ['Strider', 'Elessar'] },
          { id: 'r2', label: 'Titles', values: ['King'] },
        ],
        html: '<em>draft</em>',
      }),
      update: (s, m) => ({ ...s, html: m.html }),
      view: ({ state }) => [
        div({ class: 'rows' }, [
          each(state.at('rows'), {
            key: (r) => r.id,
            render: (item) => [
              div({ class: 'row' }, [
                span({ class: 'label' }, [text(item.at('label'))]),
                each(item.at('values'), {
                  key: (v) => v,
                  render: (v) => [span({ class: 'val' }, [text(v)])],
                }),
              ]),
            ],
          }),
        ]),
        div({ class: 'rich' }, [unsafeHtml(state.at('html'))]),
      ],
    })

    // 0.5.8: inner each over the row item must render (was silently empty).
    expect(container.querySelectorAll('.val').length).toBe(3)
    expect(container.querySelector('.rich')?.innerHTML).toContain('<em>draft</em>')

    h.send({ type: 'set-html', html: '<strong>canon</strong>' })
    expect(container.querySelector('.rich')?.innerHTML).toContain('<strong>canon</strong>')
    h.dispose()
  })
})
