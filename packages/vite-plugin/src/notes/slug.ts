// Filename derivation for notes. The canonical, fs-free implementation
// lives in `@llui/devmode-annotate/note-format` so the server store and
// browser stores (indexedDbStore, export bundles) derive identical
// filenames. This module re-exports it for the server's existing call
// sites. The on-disk contract is 01-on-disk-format.md.

export { deriveSlug, deriveFilename, padId } from '@llui/devmode-annotate/note-format'
