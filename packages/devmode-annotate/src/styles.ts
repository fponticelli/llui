// CSS strings for HUD elements. Kept as plain strings (not a CSS file
// or className lookup) so the package has zero CSS dependency and the
// styles can't be overridden accidentally by the host app's globals.
// Each rule uses very high specificity via direct style assignment.
//
// Theme colors come from CSS custom properties defined on the root
// container (see `THEME_STYLESHEET` below). Inline styles reference
// them via `var(--hud-*)` so dark mode just works without re-applying
// every inline declaration.

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'

/**
 * Injected once at mount under a `<style>` tag. Defines the theme
 * variables on the HUD root and flips them via prefers-color-scheme.
 * Scoped to `#llui-devmode-annotate-root` so host pages can't leak
 * styles in or out.
 */
export const THEME_STYLESHEET = `
#llui-devmode-annotate-root,
#llui-devmode-annotate-toasts {
  --hud-bg: #ffffff;
  --hud-fg: #111111;
  --hud-fg-muted: #555555;
  --hud-fg-subtle: #888888;
  --hud-surface: rgba(0, 0, 0, 0.04);
  --hud-surface-strong: rgba(0, 0, 0, 0.08);
  --hud-border: rgba(0, 0, 0, 0.12);
  --hud-border-strong: rgba(0, 0, 0, 0.16);
  --hud-input-bg: #ffffff;
  --hud-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  --hud-primary: #0070f3;
  --hud-primary-fg: #ffffff;
  --hud-secondary-bg: #f5f5f7;
  --hud-accent-bg: rgba(99, 102, 241, 0.12);
  --hud-accent-fg: #4338ca;
  --hud-success-bg: rgba(22, 163, 74, 0.12);
  --hud-success-fg: #15803d;
  --hud-toast-shadow: 0 8px 24px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.06);
  --hud-toast-border-ok: #16a34a;
  --hud-toast-border-fail: #ef4444;
  --hud-toast-border-info: #6366f1;
  --hud-kbd-bg: rgba(0, 0, 0, 0.06);
  --hud-kbd-fg: #555555;
}

@media (prefers-color-scheme: dark) {
  #llui-devmode-annotate-root,
  #llui-devmode-annotate-toasts {
    --hud-bg: #1f2025;
    --hud-fg: #e7e7ea;
    --hud-fg-muted: #a8a8b0;
    --hud-fg-subtle: #75757d;
    --hud-surface: rgba(255, 255, 255, 0.06);
    --hud-surface-strong: rgba(255, 255, 255, 0.10);
    --hud-border: rgba(255, 255, 255, 0.10);
    --hud-border-strong: rgba(255, 255, 255, 0.16);
    --hud-input-bg: #15161a;
    --hud-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
    --hud-primary: #3b82f6;
    --hud-primary-fg: #ffffff;
    --hud-secondary-bg: rgba(255, 255, 255, 0.08);
    --hud-accent-bg: rgba(99, 102, 241, 0.25);
    --hud-accent-fg: #c7d2fe;
    --hud-success-bg: rgba(22, 163, 74, 0.25);
    --hud-success-fg: #86efac;
    --hud-toast-shadow: 0 8px 24px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08);
    --hud-kbd-bg: rgba(255, 255, 255, 0.10);
    --hud-kbd-fg: #c8c8d0;
  }
}
`

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
    'flex-direction: column',
    'align-items: center',
    'justify-content: center',
    'line-height: 1.05',
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    'font-size: 11px',
    'font-weight: 700',
    'letter-spacing: -0.2px',
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
    'background: var(--hud-bg)',
    'color: var(--hud-fg)',
    'border: 1px solid var(--hud-border)',
    'border-radius: 8px',
    'box-shadow: var(--hud-shadow)',
    'padding: 12px',
    'display: none',
    // The modal must be HIGHER z-index than the drawing overlay so
    // the user can interact with it while the rect is highlighted.
    'z-index: 2147483647',
  ].join('; '),

  heading: 'font-weight: 600; margin-bottom: 4px; color: var(--hud-fg);',

  // Context subhead — route · primary component · viewport. Subtle so
  // it sits below the heading without competing.
  contextSubhead: [
    'font-size: 11px',
    'color: var(--hud-fg-muted)',
    'margin-bottom: 6px',
    'overflow: hidden',
    'text-overflow: ellipsis',
    'white-space: nowrap',
  ].join('; '),

  textarea: [
    'width: 100%',
    'box-sizing: border-box',
    'padding: 8px',
    'border: 1px solid var(--hud-border-strong)',
    'border-radius: 6px',
    'font: inherit',
    'color: var(--hud-fg)',
    'background: var(--hud-input-bg)',
    'resize: vertical',
  ].join('; '),

  // Tiny markdown hint that sits below the textarea.
  markdownHint: ['margin-top: 4px', 'font-size: 11px', 'color: var(--hud-fg-subtle)'].join('; '),

  status: 'margin-top: 4px; font-size: 12px; color: var(--hud-fg-muted); min-height: 0;',

  actions: 'display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px;',

  // Inline action buttons next to/above the textarea (e.g. "Add region").
  inlineActionBtn: [
    'display: inline-flex',
    'align-items: center',
    'gap: 4px',
    'padding: 4px 10px',
    'border-radius: 999px',
    'border: 1px dashed var(--hud-border-strong)',
    'background: transparent',
    'color: var(--hud-fg-muted)',
    'cursor: pointer',
    'font: inherit',
    'font-size: 12px',
  ].join('; '),

  // Chip-style preview shown when a region annotation is attached.
  regionChip: [
    'display: inline-flex',
    'align-items: center',
    'gap: 6px',
    'padding: 4px 4px 4px 10px',
    'border-radius: 999px',
    'background: var(--hud-accent-bg)',
    'color: var(--hud-accent-fg)',
    'font-size: 12px',
    'font-weight: 500',
  ].join('; '),

  regionChipClose: [
    'display: inline-flex',
    'align-items: center',
    'justify-content: center',
    'width: 18px',
    'height: 18px',
    'border-radius: 50%',
    'border: 0',
    'background: transparent',
    'color: inherit',
    'cursor: pointer',
    'font-size: 14px',
    'line-height: 1',
    'padding: 0',
  ].join('; '),

  toolbar: [
    'display: flex',
    'gap: 4px',
    'margin-bottom: 4px',
    'padding: 4px',
    'background: var(--hud-surface)',
    'border-radius: 6px',
  ].join('; '),

  toolbarBtn: [
    'min-width: 28px',
    'height: 24px',
    'padding: 0 6px',
    'border-radius: 4px',
    'border: 1px solid transparent',
    'background: transparent',
    'color: var(--hud-fg)',
    'cursor: pointer',
    'font: inherit',
    'font-size: 12px',
    'display: inline-flex',
    'align-items: center',
    'justify-content: center',
  ].join('; '),

  // Row above the textarea holding the "Add region" button and any
  // attached region chip.
  attachmentRow: [
    'display: flex',
    'align-items: center',
    'gap: 8px',
    'margin-bottom: 6px',
    'flex-wrap: wrap',
  ].join('; '),

  // "More options" expander — clickable summary above the actions row.
  moreOptionsToggle: [
    'display: inline-flex',
    'align-items: center',
    'gap: 4px',
    'margin-top: 8px',
    'font-size: 11px',
    'color: var(--hud-fg-muted)',
    'cursor: pointer',
    'user-select: none',
    'background: transparent',
    'border: 0',
    'padding: 2px 0',
  ].join('; '),

  moreOptionsBody: [
    'margin-top: 6px',
    'padding: 8px',
    'background: var(--hud-surface)',
    'border-radius: 6px',
    'font-size: 12px',
    'color: var(--hud-fg-muted)',
    'display: none',
  ].join('; '),

  moreOptionsRow: ['display: flex', 'align-items: center', 'gap: 8px'].join('; '),

  // Footer keyboard-shortcut hint.
  kbdHint: [
    'margin-top: 8px',
    'font-size: 10px',
    'color: var(--hud-fg-subtle)',
    'display: flex',
    'gap: 8px',
    'flex-wrap: wrap',
  ].join('; '),

  kbd: [
    'display: inline-block',
    'padding: 1px 5px',
    'border-radius: 3px',
    'background: var(--hud-kbd-bg)',
    'color: var(--hud-kbd-fg)',
    'font-family: ui-monospace, SFMono-Regular, monospace',
    'font-size: 10px',
    'line-height: 1.4',
  ].join('; '),

  queueBadge: [
    'display: inline-block',
    'padding: 1px 8px',
    'border-radius: 999px',
    'background: var(--hud-accent-bg)',
    'color: var(--hud-accent-fg)',
    'font-weight: 500',
    'font-size: 11px',
  ].join('; '),

  queueBadgeReady: [
    'display: inline-block',
    'padding: 1px 8px',
    'border-radius: 999px',
    'background: var(--hud-success-bg)',
    'color: var(--hud-success-fg)',
    'font-weight: 500',
    'font-size: 11px',
  ].join('; '),

  toastContainer: [
    'position: fixed',
    'top: 16px',
    'right: 16px',
    'z-index: 2147483647',
    'display: flex',
    'flex-direction: column',
    'gap: 8px',
    'pointer-events: none',
  ].join('; '),

  toast: [
    'min-width: 240px',
    'max-width: 360px',
    'padding: 10px 12px',
    'border-radius: 8px',
    'background: var(--hud-bg)',
    'box-shadow: var(--hud-toast-shadow)',
    'pointer-events: auto',
    `font: 13px ${FONT}`,
    'color: var(--hud-fg)',
    'transition: opacity 200ms ease, transform 200ms ease',
    'cursor: pointer',
    'display: flex',
    'gap: 8px',
    'align-items: flex-start',
  ].join('; '),

  toastBorderOk: 'border-left: 3px solid var(--hud-toast-border-ok);',
  toastBorderFail: 'border-left: 3px solid var(--hud-toast-border-fail);',
  toastBorderInfo: 'border-left: 3px solid var(--hud-toast-border-info);',
}

/**
 * Split-button styles — the "Solve" action paired with a caret that
 * opens the resume-mode menu. Three pieces: the wrapping container,
 * the main click target, and the caret. All share the primary
 * palette so they read as one control.
 */
export const SPLIT_BTN_STYLES = {
  container: [
    'display: inline-flex',
    'align-items: stretch',
    'border-radius: 6px',
    // No `overflow: hidden` here — it would clip the absolutely-
    // positioned dropdown menu that sits above the container. The
    // inner buttons have transparent backgrounds so the container's
    // rounded background fills the visible shape; rounded corners
    // already look correct without clipping.
    'border: 1px solid var(--hud-primary)',
    'background: var(--hud-primary)',
    'color: var(--hud-primary-fg)',
    'position: relative',
  ].join('; '),

  main: [
    'padding: 6px 12px',
    'background: transparent',
    'color: inherit',
    'border: 0',
    'cursor: pointer',
    'font: inherit',
    'display: inline-flex',
    'align-items: center',
    'gap: 6px',
  ].join('; '),

  caret: [
    'padding: 6px 8px',
    'background: transparent',
    'color: inherit',
    // The divider between main and caret. Using a left border on the
    // caret button keeps the visual seam crisp without an extra
    // element.
    'border: 0',
    'border-left: 1px solid rgba(255, 255, 255, 0.25)',
    'cursor: pointer',
    'font: inherit',
    'font-size: 11px',
    'display: inline-flex',
    'align-items: center',
  ].join('; '),

  menu: [
    'position: absolute',
    'bottom: calc(100% + 4px)',
    'right: 0',
    'min-width: 200px',
    'background: var(--hud-bg)',
    'color: var(--hud-fg)',
    'border: 1px solid var(--hud-border-strong)',
    'border-radius: 6px',
    'box-shadow: var(--hud-shadow)',
    'padding: 4px',
    'z-index: 1',
    'display: none',
    'flex-direction: column',
    'gap: 2px',
    'font-size: 12px',
  ].join('; '),

  menuItem: [
    'display: flex',
    'align-items: center',
    'gap: 6px',
    'padding: 6px 8px',
    'border-radius: 4px',
    'border: 0',
    'background: transparent',
    'color: inherit',
    'cursor: pointer',
    'font: inherit',
    'text-align: left',
    'width: 100%',
  ].join('; '),
}

/**
 * The "resume" glyph shown inside the main Solve label when resume
 * mode is on. Returned as a span style; the host inserts/removes the
 * span based on state. Kept separate from button styles so we don't
 * recreate the whole button on toggle.
 */
export const RESUME_GLYPH_STYLE = [
  'display: inline-flex',
  'align-items: center',
  'justify-content: center',
  'width: 16px',
  'height: 16px',
  'border-radius: 50%',
  'background: rgba(255, 255, 255, 0.18)',
  'font-size: 10px',
  'line-height: 1',
].join('; ')

export type BtnVariant = 'primary' | 'secondary' | 'ghost' | boolean

export function btnStyle(variant: BtnVariant): string {
  // Boolean overload for back-compat: true = primary, false = ghost.
  const v: 'primary' | 'secondary' | 'ghost' =
    variant === true ? 'primary' : variant === false ? 'ghost' : variant
  // Each variant references theme vars so dark mode flips
  // automatically. Primary stays a saturated blue in both themes —
  // it's the call-to-action and contrast against the modal surface
  // is what matters.
  const declarations =
    v === 'primary'
      ? [
          'border: 1px solid var(--hud-primary)',
          'background: var(--hud-primary)',
          'color: var(--hud-primary-fg)',
        ]
      : v === 'secondary'
        ? [
            'border: 1px solid var(--hud-border-strong)',
            'background: var(--hud-secondary-bg)',
            'color: var(--hud-fg)',
          ]
        : [
            'border: 1px solid var(--hud-border-strong)',
            'background: var(--hud-bg)',
            'color: var(--hud-fg)',
          ]
  return [
    'padding: 6px 12px',
    'border-radius: 6px',
    ...declarations,
    'cursor: pointer',
    'font: inherit',
  ].join('; ')
}
