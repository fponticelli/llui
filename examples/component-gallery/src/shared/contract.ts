/**
 * The canonical ProductContract (#261), read from the ONE file that owns it.
 *
 * The gallery has no inventory of its own: every entry, category, alias,
 * badge and path explanation it shows is derived from this value, and every
 * scenario from the family catalogs compiled against it (`catalogs.ts`).
 *
 * The JSON import is typed by inference (plain `string`s), so it is VALIDATED
 * into a `ProductContract` here, once, through the same authoritative schema
 * `llui` reads a registry's `productContract` with — never narrowed by a cast.
 * `@llui/cli/product-contract` is the CLI's browser-safe subpath (zod and the
 * structural types only; no Node module reaches a document's bundle, which
 * `test/build-graph.test.ts` asserts), so a malformed contract fails loudly at
 * load, naming the source and the path of every violation.
 */
import { parseProductContract, type ProductContract } from '@llui/cli/product-contract'
import { productContract } from '../../../../registry/registry.json'

export const GALLERY_CONTRACT_SOURCE = 'registry/registry.json#productContract'

/** Validate a contract value the way the gallery loads its own. */
export function loadGalleryContract(value: unknown): ProductContract {
  return parseProductContract(value, GALLERY_CONTRACT_SOURCE)
}

export const GALLERY_CONTRACT: ProductContract = loadGalleryContract(productContract)
