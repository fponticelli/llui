/**
 * Keep the item an `aria-activedescendant` names scrolled into view (#268).
 *
 * Every LLui list-like overlay — menu, select, combobox, searchable-select,
 * context menu, menubar — keeps DOM focus on its content (or input) and moves
 * a HIGHLIGHT through `aria-activedescendant`. Nothing scrolled the
 * highlighted item into view, so in a list taller than its popup the keyboard
 * highlight walked off the visible area: a keyboard user pressing End saw
 * nothing happen, and with a pointer out of the way there was no other cue.
 * (Native focus scrolls itself; an active descendant is not focus.)
 *
 * One observer per open overlay, filtered to the one attribute and disconnected
 * on teardown. It watches the whole document because the owner of the
 * attribute is not always inside the popup — a combobox's lives on its INPUT —
 * and acts only when the named item IS inside `container`, so a sibling
 * widget's highlight never scrolls this one.
 */
export function followActiveDescendant(container: HTMLElement): () => void {
  if (typeof MutationObserver === 'undefined') return () => {}
  const doc = container.ownerDocument
  const reveal = (owner: Node): void => {
    if (!(owner instanceof Element)) return
    const id = owner.getAttribute('aria-activedescendant')
    if (id === null || id === '') return
    const item = doc.getElementById(id)
    if (item === null || !container.contains(item)) return
    // jsdom has no layout and no `scrollIntoView`.
    if (typeof item.scrollIntoView === 'function') {
      item.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }
  const observer = new MutationObserver((records) => {
    for (const record of records) reveal(record.target)
  })
  observer.observe(doc.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-activedescendant'],
  })
  // A highlight seeded before the overlay mounted is revealed too.
  for (const owner of Array.from(doc.querySelectorAll('[aria-activedescendant]'))) reveal(owner)
  return () => observer.disconnect()
}
