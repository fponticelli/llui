/**
 * The Baseline theme path document: `@llui/components/styles/theme.css`
 * (plain CSS, no Tailwind anywhere in this document) styling the baseline
 * scenario renderers' machine markup. Consumers of this path install
 * `@llui/components`, import `theme.css` once, and spread the part bags.
 *
 * Each family's renderer is its own chunk, loaded only for a scenario of
 * that family.
 */
import './baseline.css'
import { bootGalleryDocument } from '../shared/document'
import { BASELINE_ADAPTER_LOADERS } from './adapters'

const root = document.getElementById('gallery-document')
if (root === null) throw new Error('Missing #gallery-document')

bootGalleryDocument({
  path: 'baseline',
  root,
  adapters: BASELINE_ADAPTER_LOADERS,
})
