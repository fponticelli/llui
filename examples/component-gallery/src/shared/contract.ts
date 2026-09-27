/**
 * The canonical ProductContract (#261), read from the ONE file that owns it.
 *
 * The gallery has no inventory of its own: every entry, category, alias,
 * badge and path explanation it shows is derived from this value, and every
 * scenario from the family catalogs compiled against it (`catalogs.ts`).
 *
 * The JSON import is typed by inference (plain `string`s), so it is narrowed
 * to `ProductContract` here, once. That narrowing is not trusted blindly:
 * `test/contract.test.ts` parses this exact file through the authoritative
 * zod schema, and `compileScenarioFamily` re-checks the family join below.
 */
import type { ProductContract } from '@llui/cli'
import { productContract } from '../../../../registry/registry.json'

export const GALLERY_CONTRACT = productContract as ProductContract
