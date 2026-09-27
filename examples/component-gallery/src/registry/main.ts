/**
 * The Registry skins path document: the component source `llui add` copied
 * into `examples/registry-demo`, styled by Tailwind v4 over
 * `@llui/components/styles/tokens.css` — and never the baseline `theme.css`.
 * Consumers of this path run `llui add <name>`, own the copied files, and
 * keep importing the state machines from `@llui/components`.
 *
 * Each family's renderer is its own chunk, loaded only for a scenario of
 * that family.
 */
import './registry.css'
import { installFrozenIconify } from '../../../../registry/test/specialized-tools-frozen-icons'
import { bootGalleryDocument } from '../shared/document'
import { REGISTRY_ADAPTER_LOADERS } from './adapters'

const root = document.getElementById('gallery-document')
if (root === null) throw new Error('Missing #gallery-document')

// Icons resolve from a frozen local source: a scenario must render the same
// glyphs every time, with no network.
installFrozenIconify()

bootGalleryDocument({
  path: 'registryTailwind',
  root,
  adapters: REGISTRY_ADAPTER_LOADERS,
})
