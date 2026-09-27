/**
 * In-page cascade inventory for the isolation suite. Runs INSIDE a document
 * (passed to `page.evaluate` / `frame.evaluate`), so it may reference only
 * its own body and DOM globals.
 *
 * It walks every stylesheet the document actually applies — descending into
 * `@layer`, `@media`, `@supports` and `@import`ed sheets, which a flat
 * `cssRules` scan silently skips (docs/agents/styling.md: a walk that misses
 * `@import` returned ZERO pairs and "confirmed" a clean result) — and returns
 * one record per style rule. Callers assert on the records; a probe that
 * found no rules at all is itself a failure (`ruleCount`).
 */
export interface ProbedRule {
  readonly selector: string
  /** Names of the properties the rule declares (custom properties included). */
  readonly properties: readonly string[]
  /** Enclosing `@layer` names, outermost first. */
  readonly layers: readonly string[]
}

export interface CascadeInventory {
  readonly sheets: readonly (string | null)[]
  readonly rules: readonly ProbedRule[]
  readonly layerNames: readonly string[]
  readonly ruleCount: number
}

export function collectCascade(): CascadeInventory {
  const rules: ProbedRule[] = []
  const layerNames = new Set<string>()
  const visit = (list: CSSRuleList, layers: readonly string[]): void => {
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSImportRule) {
        if (rule.styleSheet !== null) visit(rule.styleSheet.cssRules, layers)
      } else if (rule instanceof CSSLayerBlockRule) {
        layerNames.add(rule.name)
        visit(rule.cssRules, [...layers, rule.name])
      } else if (rule instanceof CSSLayerStatementRule) {
        for (const name of rule.nameList) layerNames.add(name)
      } else if (rule instanceof CSSStyleRule) {
        const properties: string[] = []
        for (let index = 0; index < rule.style.length; index += 1) {
          properties.push(rule.style.item(index))
        }
        rules.push({ selector: rule.selectorText, properties, layers })
        if (rule.cssRules.length > 0) visit(rule.cssRules, layers)
      } else if ('cssRules' in rule) {
        visit((rule as CSSGroupingRule).cssRules, layers)
      }
    }
  }
  const sheets: (string | null)[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    sheets.push(sheet.href)
    visit(sheet.cssRules, [])
  }
  return { sheets, rules, layerNames: [...layerNames], ruleCount: rules.length }
}
