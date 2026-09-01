import type {
  MenusOverlaysCaseInput,
  MenusOverlaysScenario,
  MenusOverlaysScenarioCase,
  MenusOverlaysScenarioId,
} from '../../scripts/lib/menus-overlays-scenarios'

type BaselineRenderer = (
  scenario: MenusOverlaysScenario,
  scenarioCase: MenusOverlaysScenarioCase,
) => string

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

function presence(input: MenusOverlaysCaseInput): 'opening' | 'open' | 'closing' | 'closed' {
  if (input.presence === undefined) {
    throw new Error('Renderer requested presence for a case without it.')
  }
  return input.presence
}

const part = (scope: string, partName: string, id: string, content: string, attrs = ''): string =>
  `<div id="${id}" data-scope="${scope}" data-part="${partName}" ${attrs}>${content}</div>`

function semanticCopy(input: MenusOverlaysCaseInput): string {
  const overflow = input.overflow
  const overflowToken = `${input.content.label.replaceAll(' ', '-')}-unbroken-`.repeat(40)
  const stress =
    overflow === undefined
      ? ''
      : `<div data-overflow-stress><div data-overflow-token>${escapeHtml(overflowToken)}</div>${Array.from(
          { length: overflow.itemCount },
          (_, index) =>
            `<div data-overflow-item="${index}">${escapeHtml(input.content.label)} overflow item ${index + 1}</div>`,
        ).join('')}</div>`
  return `<div data-scenario-copy aria-label="${escapeHtml(input.content.detail)}"><div data-scenario-label>${escapeHtml(input.content.label)}</div><div data-scenario-detail>${escapeHtml(input.content.detail)}</div>${stress}</div>`
}

const stateLabel = (input: MenusOverlaysCaseInput, state: string): string =>
  `${input.content.label} ${state}`

function asyncFeedback(input: MenusOverlaysCaseInput, prefix: string): string {
  switch (input.asyncStatus) {
    case undefined:
      return ''
    case 'loading':
      return `<div id="${prefix}-loading" role="status" aria-live="polite" aria-busy="true">${escapeHtml(input.content.detail)} Loading.</div>`
    case 'empty':
      return `<div id="${prefix}-empty" role="status" aria-live="polite">${escapeHtml(input.content.detail)} No results.</div>`
    case 'error':
      return `<div id="${prefix}-error" role="alert" aria-live="assertive">${escapeHtml(input.content.detail)} Loading failed.</div>`
  }
}

function menuItems(input: MenusOverlaysCaseInput, scope: string, prefix: string): string {
  const { content, items = {} } = input
  return [
    part(scope, 'item', `${prefix}-item`, escapeHtml(content.label)),
    items.highlighted
      ? part(
          scope,
          'item',
          `${prefix}-highlighted`,
          escapeHtml(stateLabel(input, 'highlighted')),
          'data-highlighted',
        )
      : '',
    items.selected
      ? part(
          scope,
          'item',
          `${prefix}-selected`,
          escapeHtml(stateLabel(input, 'selected')),
          'data-state="selected" aria-selected="true"',
        )
      : '',
    items.checked
      ? part(
          scope,
          'item',
          `${prefix}-checked`,
          escapeHtml(stateLabel(input, 'checked')),
          'aria-checked="true"',
        )
      : '',
    items.disabled
      ? part(
          scope,
          'item',
          `${prefix}-disabled`,
          escapeHtml(stateLabel(input, 'disabled')),
          'data-disabled',
        )
      : '',
    items.destructive
      ? `<div id="${prefix}-destructive" class="menu-item-destructive" data-scope="${scope}" data-part="item">${escapeHtml(stateLabel(input, 'destructive'))}</div>`
      : '',
    part(scope, 'separator', `${prefix}-separator`, ''),
    asyncFeedback(input, prefix),
  ].join('')
}

function menuSurface(input: MenusOverlaysCaseInput, scope: string, prefix: string): string {
  const state = presence(input)
  const nested = input.items?.nested
    ? part(
        scope,
        'subtrigger',
        `${prefix}-subtrigger`,
        escapeHtml(stateLabel(input, 'nested')),
        'data-highlighted role="menuitem" aria-haspopup="menu"',
      ) +
      part(
        scope,
        'subcontent',
        `${prefix}-subcontent`,
        escapeHtml(input.content.detail),
        `role="menu" data-state="${state}" data-side="${input.side ?? 'bottom'}"`,
      )
    : ''
  return `<div id="${prefix}-positioner" data-scope="${scope}" data-part="positioner"><div id="${prefix}-content" data-scope="${scope}" data-part="content" data-state="${state}" data-side="${input.side ?? 'bottom'}"${state === 'closed' ? ' hidden' : ''}>${semanticCopy(input)}${menuItems(input, scope, prefix)}${nested}</div></div>`
}

function selectionSurface(
  input: MenusOverlaysCaseInput,
  scope: 'select' | 'combobox' | 'searchable-select',
): string {
  const busy = input.asyncStatus === 'loading' ? 'aria-busy="true"' : ''
  const status = input.asyncStatus ?? 'idle'
  const state = presence(input)
  return `<div id="baseline-${scope}-positioner" data-scope="${scope}" data-part="positioner"><div id="baseline-${scope}-content" data-scope="${scope}" data-part="content" data-state="${state}" data-side="${input.side ?? 'bottom'}" data-status="${status}" ${busy}${state === 'closed' ? ' hidden' : ''}>${semanticCopy(input)}${menuItems(input, scope, `baseline-${scope}`)}</div></div>`
}

function modalSurface(
  input: MenusOverlaysCaseInput,
  scope: 'dialog' | 'drawer',
  id: string,
): string {
  const sideAttr = input.edge === undefined ? '' : `data-side="${input.edge}"`
  const state = presence(input)
  const modal = input.modal === undefined ? 'true' : String(input.modal)
  return `<div id="${id}-positioner" data-scope="${scope}" data-part="positioner"><div id="${id}-backdrop" data-scope="${scope}" data-part="backdrop" data-state="${state}"></div><div id="${id}" data-scope="${scope}" data-part="content" role="${scope === 'dialog' ? 'dialog' : 'dialog'}" aria-modal="${modal}" data-state="${state}" ${sideAttr}${state === 'closed' ? ' hidden' : ''}>${semanticCopy(input)}</div></div>`
}

function floatingSurface(
  input: MenusOverlaysCaseInput,
  scope: 'popover' | 'hover-card' | 'tooltip',
): string {
  const state = presence(input)
  return `<div id="baseline-${scope}-positioner" data-scope="${scope}" data-part="positioner"><div id="baseline-${scope}" data-scope="${scope}" data-part="content" data-state="${state}" data-side="${input.side ?? 'bottom'}"${state === 'closed' ? ' hidden' : ''}>${semanticCopy(input)}${part(scope, 'arrow', `baseline-${scope}-arrow`, '')}</div></div>`
}

/** Baseline-only adapters; keys are exact canonical scenario identities. */
export const baselineMenusOverlaysRenderers = {
  'component:alert-dialog': (_scenario, scenarioCase) =>
    modalSurface(scenarioCase.input, 'dialog', 'baseline-alert-dialog'),
  'component:combobox': (_scenario, scenarioCase) =>
    selectionSurface(scenarioCase.input, 'combobox'),
  'component:context-menu': (_scenario, scenarioCase) =>
    menuSurface(scenarioCase.input, 'context-menu', 'baseline-context-menu'),
  'component:dialog': (_scenario, scenarioCase) =>
    modalSurface(scenarioCase.input, 'dialog', 'baseline-dialog'),
  'component:drawer': (_scenario, scenarioCase) =>
    modalSurface(scenarioCase.input, 'drawer', 'baseline-drawer'),
  'component:hover-card': (_scenario, scenarioCase) =>
    floatingSurface(scenarioCase.input, 'hover-card'),
  'component:menu': (_scenario, scenarioCase) =>
    menuSurface(scenarioCase.input, 'menu', 'baseline-menu'),
  'component:menubar': (_scenario, scenarioCase) =>
    `<div id="baseline-menubar" data-scope="menubar" data-part="root">${menuSurface(scenarioCase.input, 'menu', 'baseline-menubar')}</div>`,
  'component:navigation-menu': (_scenario, scenarioCase) =>
    `<nav id="baseline-navigation-menu" aria-label="${escapeHtml(scenarioCase.input.content.label)}" data-scope="navigation-menu" data-part="root"><button id="baseline-navigation-trigger" data-scope="navigation-menu" data-part="trigger" aria-controls="baseline-navigation-content" data-state="${presence(scenarioCase.input)}">${escapeHtml(scenarioCase.input.content.label)}</button><div id="baseline-navigation-content" data-scope="navigation-menu" data-part="content" aria-labelledby="baseline-navigation-trigger" data-state="${presence(scenarioCase.input)}"${presence(scenarioCase.input) === 'closed' ? ' hidden' : ''}>${semanticCopy(scenarioCase.input)}${scenarioCase.input.items?.selected ? part('navigation-menu', 'link', 'baseline-navigation-link', escapeHtml(stateLabel(scenarioCase.input, 'selected')), 'data-active="true"') : ''}${scenarioCase.input.items?.nested ? `<a id="baseline-navigation-nested" data-scope="navigation-menu" data-part="link" href="#">${escapeHtml(stateLabel(scenarioCase.input, 'nested'))}</a>` : ''}</div><div id="baseline-nav-indicator-track" data-scope="navigation-menu" data-part="indicator" data-state="${presence(scenarioCase.input) === 'open' ? 'visible' : 'hidden'}"></div></nav>`,
  'component:popover': (_scenario, scenarioCase) => floatingSurface(scenarioCase.input, 'popover'),
  'component:select': (_scenario, scenarioCase) => selectionSurface(scenarioCase.input, 'select'),
  'component:toast': (_scenario, scenarioCase) => {
    const variant = scenarioCase.input.toastType
    const placement = scenarioCase.input.toastPlacement
    if (variant === undefined || placement === undefined) {
      throw new Error('Toast case requires toastType and toastPlacement.')
    }
    const assertive = variant === 'error'
    return `<div id="baseline-toast-region" role="region" aria-label="${escapeHtml(scenarioCase.input.content.label)}" data-scope="toast" data-part="region" data-placement="${placement}"><div id="baseline-toast-${variant}" role="${assertive ? 'alert' : 'status'}" aria-live="${assertive ? 'assertive' : 'polite'}" data-scope="toast" data-part="root" data-type="${variant}" data-state="${presence(scenarioCase.input)}">${semanticCopy(scenarioCase.input)}<div data-scope="toast" data-part="description">${escapeHtml(scenarioCase.input.content.detail)}</div></div></div>`
  },
  'component:toolbar': (_scenario, scenarioCase) =>
    `<div id="baseline-toolbar" data-scope="toolbar" data-part="root" data-orientation="${scenarioCase.input.orientation}">${semanticCopy(scenarioCase.input)}${scenarioCase.input.items?.disabled ? part('toolbar', 'item', 'baseline-toolbar-disabled', escapeHtml(stateLabel(scenarioCase.input, 'disabled')), 'data-disabled') : ''}</div>`,
  'component:tooltip': (_scenario, scenarioCase) => floatingSurface(scenarioCase.input, 'tooltip'),
  'pattern:command-menu': (_scenario, scenarioCase) =>
    `<div id="baseline-command-surface" class="command-menu" role="dialog" aria-modal="${scenarioCase.input.modal}" data-state="${presence(scenarioCase.input)}">${menuSurface(scenarioCase.input, 'menu', 'baseline-command')}</div>`,
  'pattern:confirm-dialog': (_scenario, scenarioCase) =>
    `<div id="baseline-confirm-dialog" class="confirm-dialog" role="alertdialog" aria-modal="${scenarioCase.input.modal}" data-state="${presence(scenarioCase.input)}"${presence(scenarioCase.input) === 'closed' ? ' hidden' : ''}>${semanticCopy(scenarioCase.input)}${scenarioCase.input.items?.destructive ? `<button id="baseline-confirm-dialog-destructive" class="btn btn-danger">${escapeHtml(stateLabel(scenarioCase.input, 'destructive'))}</button>` : ''}</div>`,
  'pattern:searchable-select': (_scenario, scenarioCase) =>
    selectionSurface(scenarioCase.input, 'searchable-select'),
} satisfies Record<MenusOverlaysScenarioId, BaselineRenderer>

function namespaceIds(html: string, suffix: string): string {
  const template = document.createElement('template')
  template.innerHTML = html
  const replacements = new Map<string, string>()
  for (const element of template.content.querySelectorAll<HTMLElement>('[id]')) {
    const prior = element.id
    const next = `${prior}--${suffix}`
    replacements.set(prior, next)
    element.id = next
  }
  for (const attribute of [
    'for',
    'aria-controls',
    'aria-labelledby',
    'aria-describedby',
    'aria-activedescendant',
  ]) {
    for (const element of template.content.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
      const value = element.getAttribute(attribute)!
      element.setAttribute(
        attribute,
        value
          .split(' ')
          .map((token) => replacements.get(token) ?? token)
          .join(' '),
      )
    }
  }
  return template.innerHTML
}

export function renderBaselineMenusOverlays(scenarios: readonly MenusOverlaysScenario[]): {
  html: string
  renderedProductIds: string[]
  renderedCaseKeys: string[]
} {
  const renderedProductIds: string[] = []
  const renderedCaseKeys: string[] = []
  const html = scenarios
    .map((scenario) => {
      const renderer = baselineMenusOverlaysRenderers[scenario.scenarioId]
      renderedProductIds.push(scenario.productId)
      return scenario.cases
        .map((scenarioCase) => {
          const isDefault = scenarioCase.id === scenario.defaultCaseId
          const rendered = renderer(scenario, scenarioCase)
          const caseKey = `${scenario.scenarioId}:${scenarioCase.id}`
          renderedCaseKeys.push(caseKey)
          return `<section data-baseline-product="${scenario.productId}" data-scenario-id="${scenario.scenarioId}" data-case-id="${scenarioCase.id}" data-default-case="${isDefault}" data-environment-axes="${scenarioCase.environmentAxes.join(' ')}">${isDefault ? rendered : namespaceIds(rendered, scenarioCase.id)}</section>`
        })
        .join('')
    })
    .join('')
  return { html, renderedProductIds, renderedCaseKeys }
}
