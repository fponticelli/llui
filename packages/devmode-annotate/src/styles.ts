// CSS strings for HUD elements. Kept as plain strings (not a CSS file
// or className lookup) so the package has zero CSS dependency and the
// styles can't be overridden accidentally by the host app's globals.
// Each rule uses very high specificity via direct style assignment.

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'

export const STYLES = {
  root: [
    'position: fixed',
    'right: 16px',
    'bottom: 16px',
    'z-index: 2147483646',
    `font: 13px/1.4 ${FONT}`,
    'color-scheme: light dark',
    // touch-action prevents Safari from interpreting drag gestures as
    // scroll while the user is repositioning the button.
    'touch-action: none',
  ].join('; '),

  button: [
    'width: 44px',
    'height: 44px',
    'border-radius: 50%',
    'border: 1px solid rgba(0,0,0,0.12)',
    // Distinctive gradient + soft glow makes the button visually
    // memorable — not just another floating emoji.
    'background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%)',
    'color: white',
    'box-shadow: 0 4px 16px rgba(99, 102, 241, 0.35), 0 1px 3px rgba(0,0,0,0.12)',
    'cursor: grab',
    'padding: 0',
    'display: flex',
    'align-items: center',
    'justify-content: center',
    'user-select: none',
    '-webkit-user-select: none',
    'transition: transform 120ms ease, box-shadow 120ms ease',
  ].join('; '),

  buttonActive: [
    'transform: scale(1.05)',
    'box-shadow: 0 6px 20px rgba(99, 102, 241, 0.5), 0 2px 4px rgba(0,0,0,0.16)',
  ].join('; '),

  buttonDragging: ['cursor: grabbing', 'transform: scale(1.1)'].join('; '),

  modal: [
    // Anchored to the floating button via the root container; bottom
    // 100% + small margin places it directly above. Switches to right-
    // anchor when the button is in the left half of the screen.
    'position: absolute',
    'right: 0',
    'bottom: 56px',
    'width: 360px',
    'background: white',
    'border: 1px solid rgba(0,0,0,0.12)',
    'border-radius: 8px',
    'box-shadow: 0 12px 32px rgba(0,0,0,0.18)',
    'padding: 12px',
    'display: none',
    // The modal must be HIGHER z-index than the drawing overlay so
    // the user can interact with it while the rect is highlighted.
    'z-index: 2147483647',
  ].join('; '),

  heading: 'font-weight: 600; margin-bottom: 8px; color: #111;',

  textarea: [
    'width: 100%',
    'box-sizing: border-box',
    'padding: 8px',
    'border: 1px solid rgba(0,0,0,0.16)',
    'border-radius: 6px',
    'font: inherit',
    'color: #111',
    'background: white',
    'resize: vertical',
  ].join('; '),

  status: 'margin-top: 8px; font-size: 12px; color: #555; min-height: 16px;',

  actions: 'display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px;',

  modeRow:
    'display: flex; gap: 4px; margin-bottom: 8px; padding: 2px; background: rgba(0,0,0,0.04); border-radius: 6px;',

  rectPreviewWrap:
    'margin-bottom: 8px; padding: 8px; background: rgba(0,0,0,0.04); border-radius: 6px; font-size: 12px; color: #444;',
}

export function btnStyle(primary: boolean): string {
  return [
    'padding: 6px 12px',
    'border-radius: 6px',
    'border: 1px solid ' + (primary ? '#0070f3' : 'rgba(0,0,0,0.16)'),
    'background: ' + (primary ? '#0070f3' : 'white'),
    'color: ' + (primary ? 'white' : '#111'),
    'cursor: pointer',
    'font: inherit',
  ].join('; ')
}

export function modeButtonStyle(active: boolean): string {
  return [
    'flex: 1',
    'padding: 4px 8px',
    'border-radius: 4px',
    'border: 1px solid ' + (active ? '#0070f3' : 'transparent'),
    'background: ' + (active ? 'white' : 'transparent'),
    'color: #111',
    'cursor: pointer',
    'font: inherit',
    'font-size: 12px',
  ].join('; ')
}
