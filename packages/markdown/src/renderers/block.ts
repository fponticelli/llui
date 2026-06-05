// Default block-level renderers: root, paragraph, heading, blockquote, list,
// listItem, code, thematicBreak, table (GFM), and footnote definitions/refs.

import {
  p,
  h1,
  h2,
  h3,
  h4,
  h5,
  h6,
  blockquote,
  ul,
  ol,
  li,
  pre,
  code,
  hr,
  input,
  table,
  thead,
  tbody,
  tr,
  th,
  td,
  a,
  text,
  el,
} from '@llui/dom'
import type { ChildNode, Mountable } from '@llui/dom'
import type {
  Root,
  Paragraph,
  Heading,
  Blockquote,
  List,
  ListItem,
  Code,
  ThematicBreak,
  Table,
  TableRow,
  TableCell,
  Definition,
  FootnoteDefinition,
  FootnoteReference,
} from 'mdast'
import type { NodeRenderer, RenderContext } from '../types.js'

/** The two element-helper call forms used here (`tag(children)` / `tag(props, children)`).
 * `@llui/dom` does not re-export its `ElementHelper` type, so we restate the subset. */
interface ElHelper {
  (children: readonly ChildNode[]): Mountable
  (props: Record<string, string>, children: readonly ChildNode[]): Mountable
}

function tag(name: string) {
  return (props: Record<string, string>, children: readonly ChildNode[] = []): Mountable =>
    el(name, props, children)
}
const sup = tag('sup')
const section = tag('section')

const HEADINGS: readonly ElHelper[] = [h1, h2, h3, h4, h5, h6]

const renderRoot: NodeRenderer<Root> = (node, ctx) => ctx.renderChildren(node)

const renderParagraph: NodeRenderer<Paragraph> = (node, ctx) => [p(ctx.renderChildren(node))]

const renderHeading: NodeRenderer<Heading> = (node, ctx) => {
  const helper = HEADINGS[Math.min(Math.max(node.depth, 1), 6) - 1] ?? h6
  return [helper(ctx.renderChildren(node))]
}

const renderBlockquote: NodeRenderer<Blockquote> = (node, ctx) => [
  blockquote(ctx.renderChildren(node)),
]

// In a TIGHT list (`list.spread === false`), mdast still wraps each item's text in
// a `paragraph`, but CommonMark renders it inline (no `<p>`). We unwrap top-level
// paragraphs to their inline content so tight lists — and GFM task lists — sit on
// one line; LOOSE lists keep their `<p>` blocks (and the spacing they imply).
function renderItem(node: ListItem, ctx: RenderContext, loose: boolean): Mountable {
  const children: ChildNode[] = loose
    ? [...ctx.renderChildren(node)]
    : node.children.flatMap((child) =>
        child.type === 'paragraph' ? [...ctx.renderChildren(child)] : [...ctx.render(child)],
      )
  // GFM task list item: `checked` is a boolean (null for ordinary items).
  if (typeof node.checked === 'boolean') {
    const box = input({ type: 'checkbox', checked: node.checked, disabled: true })
    return li({ class: 'task-list-item' }, [box, ...children])
  }
  return li(children)
}

const renderList: NodeRenderer<List> = (node, ctx) => {
  const loose = node.spread === true
  const items = node.children.map((item) => renderItem(item, ctx, loose))
  if (node.ordered) {
    const props: Record<string, string> = {}
    if (node.start != null && node.start !== 1) props.start = String(node.start)
    return [ol(props, items)]
  }
  return [ul(items)]
}

// Standalone dispatch (an item rendered outside its list): fall back to the item's
// own `spread` for looseness.
const renderListItem: NodeRenderer<ListItem> = (node, ctx) => [
  renderItem(node, ctx, node.spread === true),
]

const renderCode: NodeRenderer<Code> = (node) => {
  const codeProps = node.lang ? { class: `language-${node.lang}` } : {}
  return [pre([code(codeProps, [text(node.value)])])]
}

const renderThematicBreak: NodeRenderer<ThematicBreak> = () => [hr([])]

const ALIGN: Record<string, string> = { left: 'left', right: 'right', center: 'center' }

const renderTable: NodeRenderer<Table> = (node, ctx) => {
  const rows = node.children
  const aligns = node.align ?? []
  const cell = (c: TableCell, i: number, cellTag: ElHelper): Mountable => {
    const align = aligns[i]
    const props: Record<string, string> =
      align && ALIGN[align] ? { style: `text-align:${ALIGN[align]}` } : {}
    return cellTag(props, ctx.renderChildren(c))
  }
  const row = (r: TableRow, cellTag: ElHelper): Mountable =>
    tr(r.children.map((c, i) => cell(c, i, cellTag)))

  const [head, ...body] = rows
  const sections: Mountable[] = []
  if (head) sections.push(thead([row(head, th)]))
  if (body.length) sections.push(tbody(body.map((r) => row(r, td))))
  return [table(sections)]
}

const renderTableRow: NodeRenderer<TableRow> = (node, ctx) => [tr(ctx.renderChildren(node))]
const renderTableCell: NodeRenderer<TableCell> = (node, ctx) => [td(ctx.renderChildren(node))]

// Reference definitions produce no visible output (resolved via ctx.definitions).
const renderDefinition: NodeRenderer<Definition> = () => []

const renderFootnoteDefinition: NodeRenderer<FootnoteDefinition> = (node, ctx) => [
  section({ class: 'footnote-definition', id: `fn-${node.identifier}` }, ctx.renderChildren(node)),
]

const renderFootnoteReference: NodeRenderer<FootnoteReference> = (node) => [
  sup({ class: 'footnote-ref' }, [
    a({ href: `#fn-${node.identifier}`, id: `fnref-${node.identifier}` }, [
      text(node.label ?? node.identifier),
    ]),
  ]),
]

export const blockRenderers = {
  root: renderRoot,
  paragraph: renderParagraph,
  heading: renderHeading,
  blockquote: renderBlockquote,
  list: renderList,
  listItem: renderListItem,
  code: renderCode,
  thematicBreak: renderThematicBreak,
  table: renderTable,
  tableRow: renderTableRow,
  tableCell: renderTableCell,
  definition: renderDefinition,
  footnoteDefinition: renderFootnoteDefinition,
  footnoteReference: renderFootnoteReference,
}
