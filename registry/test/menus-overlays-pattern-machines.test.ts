import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ProductContractSchema } from '../../packages/cli/src/product-contract'
import * as commandMenu from '../../packages/components/src/patterns/command-menu'
import * as confirmDialog from '../../packages/components/src/patterns/confirm-dialog'
import * as searchableSelect from '../../packages/components/src/patterns/searchable-select'
import { connect as connectDialog } from '../../packages/components/src/components/dialog'
import { read, rootSignal } from '../../packages/components/test/_signal'
import {
  menusOverlaysScenarios,
  type MenusOverlaysScenario,
  type MenusOverlaysScenarioId,
} from '../../packages/components/test/styles/menus-overlays-scenarios'

const ROOT = resolve(import.meta.dirname, '../..')
const contract = ProductContractSchema.parse(
  (
    JSON.parse(readFileSync(resolve(ROOT, 'registry/registry.json'), 'utf8')) as {
      productContract: unknown
    }
  ).productContract,
)
const scenarioSet = menusOverlaysScenarios(contract)

function scenario(id: MenusOverlaysScenarioId): MenusOverlaysScenario {
  return scenarioSet.byScenarioId[id]
}

describe('menus/overlays composed-pattern scenarios use their real machines', () => {
  it('does not advertise a command highlight state the composed machine cannot retain', () => {
    const command = scenario('pattern:command-menu')
    expect(command.cases.some(({ input }) => input.items?.highlighted !== undefined)).toBe(false)
    expect(command.unsupportedCases).toContainEqual({
      id: 'highlighted-command',
      rationale: expect.stringContaining('does not retain'),
    })
  })

  it('drives every command-menu case through command filtering, disabled state, dialog ARIA, and presence', () => {
    const command = scenario('pattern:command-menu')
    const signal = rootSignal<commandMenu.CommandMenuState>()
    const parts = commandMenu.connect(signal, () => {}, { id: 'scenario-command' })

    for (const scenarioCase of command.cases) {
      const { input } = scenarioCase
      const count = input.overflow?.itemCount ?? 1
      const commands: commandMenu.Command[] = Array.from({ length: count }, (_, index) => ({
        id: index === 0 ? 'primary' : `command-${index}`,
        label: index === 0 ? input.content.label : `${input.content.detail} ${index}`,
      }))
      if (input.items?.disabled) {
        commands.push({ id: 'disabled', label: input.content.detail, disabled: true })
      }
      let state = commandMenu.init({ commands })
      if (input.presence === 'open') state = commandMenu.update(state, { type: 'open' })[0]
      if (input.asyncStatus === 'empty') {
        state = commandMenu.update(state, { type: 'setQuery', query: '__no_match__' })[0]
      }

      expect(state.open, scenarioCase.id).toBe(input.presence === 'open')
      expect(read(parts.dialog.content['data-state'], state), scenarioCase.id).toBe(input.presence)
      expect(parts.dialog.content.role, scenarioCase.id).toBe('dialog')
      expect(parts.dialog.content['aria-modal'], scenarioCase.id).toBe('true')
      expect(read(parts.empty['data-empty'], state), scenarioCase.id).toBe(
        input.asyncStatus === 'empty' ? '' : undefined,
      )
      expect(state.commands[0]?.label, scenarioCase.id).toBe(input.content.label)
      expect(state.commands.length, scenarioCase.id).toBe(count + (input.items?.disabled ? 1 : 0))
      if (input.items?.disabled) {
        expect(read(parts.combobox.item('disabled').item['data-disabled'], state)).toBe('')
        expect(commandMenu.update(state, { type: 'execute', commandId: 'disabled' })[0]).toBe(state)
      }
    }
  })

  it('drives every confirm-dialog case through openWith and the composed alertdialog semantics', () => {
    const confirm = scenario('pattern:confirm-dialog')
    const signal = rootSignal<confirmDialog.ConfirmDialogState>()
    const dialogParts = connectDialog(
      signal.map((state) => ({ open: state.open })),
      () => {},
      { id: 'scenario-confirm', role: 'alertdialog' },
    )

    for (const scenarioCase of confirm.cases) {
      const { input } = scenarioCase
      let state = confirmDialog.init({
        title: input.content.label,
        description: input.content.detail,
        destructive: input.items?.destructive,
      })
      if (input.presence === 'open') {
        state = confirmDialog.update(state, {
          type: 'openWith',
          tag: scenarioCase.id,
          title: input.content.label,
          description: input.content.detail,
          destructive: input.items?.destructive,
        })[0]
      }

      expect(state, scenarioCase.id).toMatchObject({
        open: input.presence === 'open',
        title: input.content.label,
        description: input.content.detail,
        destructive: input.items?.destructive ?? false,
      })
      expect(dialogParts.content.role, scenarioCase.id).toBe('alertdialog')
      expect(dialogParts.content['aria-modal'], scenarioCase.id).toBe('true')
      expect(read(dialogParts.content['data-state'], state), scenarioCase.id).toBe(input.presence)
    }
  })

  it('drives every searchable-select case through selection, async request, and live ARIA machinery', () => {
    const searchable = scenario('pattern:searchable-select')
    const signal = rootSignal<searchableSelect.SearchableSelectState>()
    const parts = searchableSelect.connect(signal, () => {}, {
      id: 'scenario-searchable',
      emptyText: 'No scenario results',
    })

    for (const scenarioCase of searchable.cases) {
      const { input } = scenarioCase
      const count = input.overflow?.itemCount ?? 3
      const items = Array.from({ length: count }, (_, index) =>
        index === 0 ? input.content.label : `${input.content.detail} ${index}`,
      )
      const disabledValue = items[1]
      let state = searchableSelect.init({
        items,
        value: input.items?.selected ? [items[0]!] : undefined,
        disabledItems: input.items?.disabled && disabledValue ? [disabledValue] : undefined,
        placeholder: input.content.label,
      })
      if (input.presence === 'open') state = searchableSelect.update(state, { type: 'open' })[0]
      if (input.items?.highlighted) {
        state = searchableSelect.update(state, { type: 'highlight', value: items[0]! })[0]
      }
      if (input.asyncStatus === 'loading') {
        state = searchableSelect.update(state, { type: 'loadStart', requestId: 1 })[0]
      } else if (input.asyncStatus === 'empty') {
        state = searchableSelect.update(state, { type: 'setItems', items: [] })[0]
      } else if (input.asyncStatus === 'error') {
        state = searchableSelect.update(state, { type: 'loadStart', requestId: 1 })[0]
        state = searchableSelect.update(state, {
          type: 'loadError',
          requestId: 1,
          error: input.content.detail,
        })[0]
      }

      expect(state.open, scenarioCase.id).toBe(input.presence === 'open')
      expect(read(parts.trigger['aria-expanded'], state), scenarioCase.id).toBe(state.open)
      expect(read(parts.content['data-state'], state), scenarioCase.id).toBe(input.presence)
      expect(read(parts.content['data-status'], state), scenarioCase.id).toBe(
        input.asyncStatus === 'loading'
          ? 'loading'
          : input.asyncStatus === 'error'
            ? 'error'
            : 'idle',
      )
      expect(read(parts.content['aria-busy'], state), scenarioCase.id).toBe(
        input.asyncStatus === 'loading' ? 'true' : undefined,
      )
      expect(read(parts.empty.hidden, state), scenarioCase.id).toBe(input.asyncStatus !== 'empty')
      if (input.asyncStatus === 'error') {
        expect(read(parts.liveRegion.text, state), scenarioCase.id).toBe(input.content.detail)
      }
      if (input.items?.selected) {
        expect(read(parts.item(items[0]!).item['aria-selected'], state)).toBe(true)
      }
      if (input.items?.highlighted) {
        expect(read(parts.item(items[0]!).item['data-highlighted'], state)).toBe('')
      }
      if (input.items?.disabled && disabledValue) {
        expect(read(parts.item(disabledValue).item['aria-disabled'], state)).toBe('true')
      }
      expect(state.combobox.items.length, scenarioCase.id).toBe(
        input.asyncStatus === 'empty' ? 0 : count,
      )
    }
  })
})
