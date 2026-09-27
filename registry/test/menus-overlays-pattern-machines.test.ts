import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ProductContractSchema } from '../../packages/cli/src/product-contract'
import * as commandMenu from '../../packages/components/src/patterns/command-menu'
import * as confirmDialog from '../../packages/components/src/patterns/confirm-dialog'
import * as searchableSelect from '../../packages/components/src/patterns/searchable-select'
import { connect as connectDialog } from '../../packages/components/src/components/dialog'
import { read, rootSignal } from '../../packages/components/test/_signal'
import { compileMenusOverlaysCatalog } from '../../packages/components/test/styles/menus-overlays-scenarios'
import { MENUS_OVERLAYS_DEFINITIONS } from '../../packages/components/test/styles/menus-overlays-scenarios'

const ROOT = resolve(import.meta.dirname, '../..')
const contract = ProductContractSchema.parse(
  (
    JSON.parse(readFileSync(resolve(ROOT, 'registry/registry.json'), 'utf8')) as {
      productContract: unknown
    }
  ).productContract,
)
// Compiling the catalog against the real contract is itself the "does not
// advertise a case ProductContract does not carry" guarantee this file used
// to state as a standalone test against `unsupportedCases` — a concept the
// new per-product `MENUS_OVERLAYS_DEFINITIONS` shape has no equivalent of,
// because a case that cannot be modeled (e.g. a retained command highlight)
// is simply absent from the typed input, not a documented exception. Kept
// here (rather than dropped) so this file still fails loudly if the family
// module and the real contract ever drift.
compileMenusOverlaysCatalog(contract)

describe('menus/overlays composed-pattern scenarios use their real machines', () => {
  it('drives every command-menu case through command filtering, dialog ARIA, and open state', () => {
    const command = MENUS_OVERLAYS_DEFINITIONS['pattern:command-menu']
    const signal = rootSignal<commandMenu.CommandMenuState>()
    const parts = commandMenu.connect(signal, () => {}, { id: 'scenario-command' })

    for (const scenarioCase of command.cases) {
      const { input } = scenarioCase
      let state = commandMenu.init({
        commands: input.commands.map((c) => ({ id: c.id, label: c.label })),
        open: input.open,
      })
      if (input.query !== '') {
        state = commandMenu.update(state, { type: 'setQuery', query: input.query })[0]
      }

      expect(state.open, scenarioCase.id).toBe(input.open)
      expect(read(parts.dialog.content['data-state'], state), scenarioCase.id).toBe(
        input.open ? 'open' : 'closed',
      )
      expect(parts.dialog.content.role, scenarioCase.id).toBe('dialog')
      expect(parts.dialog.content['aria-modal'], scenarioCase.id).toBe('true')
      const matched = input.commands.some((c) =>
        c.label.toLowerCase().includes(input.query.toLowerCase()),
      )
      expect(read(parts.empty['data-empty'], state), scenarioCase.id).toBe(
        input.query !== '' && !matched ? '' : undefined,
      )
    }
  })

  it('drives every confirm-dialog case through openWith and the composed alertdialog semantics', () => {
    const confirm = MENUS_OVERLAYS_DEFINITIONS['pattern:confirm-dialog']
    const signal = rootSignal<confirmDialog.ConfirmDialogState>()
    const dialogParts = connectDialog(
      signal.map((state) => ({ open: state.open })),
      () => {},
      { id: 'scenario-confirm', role: 'alertdialog' },
    )

    for (const scenarioCase of confirm.cases) {
      const { input } = scenarioCase
      let state = confirmDialog.init({
        title: input.title,
        description: input.description,
        destructive: input.destructive,
      })
      if (input.open) {
        state = confirmDialog.update(
          state,
          confirmDialog.confirmDialog.openWith(scenarioCase.id, {
            title: input.title,
            description: input.description,
            destructive: input.destructive,
          }),
        )[0]
      }

      expect(state, scenarioCase.id).toMatchObject({
        open: input.open,
        title: input.title,
        description: input.description,
        destructive: input.destructive,
      })
      expect(dialogParts.content.role, scenarioCase.id).toBe('alertdialog')
      expect(dialogParts.content['aria-modal'], scenarioCase.id).toBe('true')
      expect(read(dialogParts.content['data-state'], state), scenarioCase.id).toBe(
        input.open ? 'open' : 'closed',
      )
    }
  })

  it('drives every searchable-select case through selection, async status, and live ARIA machinery', () => {
    const searchable = MENUS_OVERLAYS_DEFINITIONS['pattern:searchable-select']
    const signal = rootSignal<searchableSelect.SearchableSelectState>()
    const parts = searchableSelect.connect(signal, () => {}, {
      id: 'scenario-searchable',
      emptyText: 'No scenario results',
    })

    for (const scenarioCase of searchable.cases) {
      const { input } = scenarioCase
      let state = searchableSelect.init({
        value: [...input.value],
        items: [...input.items],
        disabledItems: [...input.disabledItems],
      })
      state = {
        ...state,
        combobox: { ...state.combobox, status: input.status, inputValue: input.inputValue },
      }
      if (input.open) state = searchableSelect.update(state, { type: 'open' })[0]
      if (input.highlightedValue !== null) {
        state = {
          ...state,
          combobox: { ...state.combobox, highlightedValue: input.highlightedValue },
        }
      }

      expect(state.open, scenarioCase.id).toBe(input.open)
      expect(read(parts.trigger['aria-expanded'], state), scenarioCase.id).toBe(state.open)
      expect(read(parts.content['data-state'], state), scenarioCase.id).toBe(
        input.open ? 'open' : 'closed',
      )
      expect(read(parts.content['data-status'], state), scenarioCase.id).toBe(input.status)
      expect(read(parts.content['aria-busy'], state), scenarioCase.id).toBe(
        input.status === 'loading' ? 'true' : undefined,
      )
      // `empty` shows only for a SETTLED empty list: never while a fetch is in
      // flight or after one failed (#265 G4).
      const settled = input.status !== 'loading' && input.status !== 'error'
      expect(read(parts.empty.hidden, state), scenarioCase.id).toBe(
        !settled || input.items.length !== 0,
      )
      if (input.status === 'error') {
        expect(typeof read(parts.liveRegion.text, state)).toBe('string')
      }
      for (const value of input.value) {
        expect(
          read(parts.item(value).item['aria-selected'], state),
          `${scenarioCase.id}/${value}`,
        ).toBe(true)
      }
      if (input.highlightedValue !== null) {
        expect(
          read(parts.item(input.highlightedValue).item['data-highlighted'], state),
          scenarioCase.id,
        ).toBe('')
      }
      for (const value of input.disabledItems) {
        expect(
          read(parts.item(value).item['aria-disabled'], state),
          `${scenarioCase.id}/${value}`,
        ).toBe('true')
      }
      expect(state.combobox.items.length, scenarioCase.id).toBe(input.items.length)
    }
  })
})
