---
status: accepted
---

# Use named, typed route locations

LLui routing uses a keyed registry of named route definitions and represents a matched location as its serializable name plus normalized, URL-identifying parameters. Route codecs pair synchronous Standard Schema validation with canonical formatting so matching and URL generation are bidirectional and validation-library-neutral. This replaces arbitrary application route objects and heuristic definition selection: page data remains application state, while route identity is explicit, type-safe, and canonical.

## Consequences

The previous builder and manual formatting interface is removed rather than retained as a compatibility path. Router construction rejects equal-specificity ambiguous definitions under order-independent static-over-parameter-over-rest precedence. Generated destinations are typed by route name, unmatched URLs remain explicit, and the connected router replaces an accepted noncanonical URL only after matching and guards succeed. Applications migrate loading state, drafts, and other non-URL fields out of route locations.

## Considered option

Adding a serializable tag to the existing arbitrary route objects would remove definition-selection inference, but it would retain manual builders, non-URL page state in route identity, and an interface that cannot infer exact parameters from a route name. The keyed registry is the broader breaking change, chosen because it makes matching, generation, validation, and identity one coherent contract.
