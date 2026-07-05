/** The Basic catalog: display + layout + native form controls. */

import { defineCatalog, type Catalog } from '../catalog.js'
import { displayComponents } from './basic.js'
import { formControls } from './interactive.js'
import { headlessComponents } from './headless.js'
import { basicFunctions } from './functions.js'

/** Canonical id of the A2UI v0.9 Basic catalog. */
export const BASIC_CATALOG_ID = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json'

export const basicCatalog: Catalog = defineCatalog({
  id: BASIC_CATALOG_ID,
  // Headless (`@llui/components`) builders override native baselines by name.
  components: { ...displayComponents, ...formControls, ...headlessComponents },
  functions: basicFunctions,
})
