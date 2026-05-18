# LLui v2 Compiler Architecture — moved

This proposal has been split into a folder to support per-phase execution by fresh-context agents.

**New location: [`docs/proposals/v2-compiler/`](./v2-compiler/)**

Start with [`v2-compiler/README.md`](./v2-compiler/README.md) for the sub-proposal map, sequencing rationale, and reading order.

## File map

```
docs/proposals/v2-compiler/
├── README.md      vision, sub-proposal map, sequencing rationale, reading order
├── shared.md      principles, architecture, data flow, resilience, testing, versioning, DoD, gaps
├── v2a.md         compiler extraction: scope, content, sequenced implementation roadmap, exit gates
├── v2b.md         cross-file analysis: scope, content (schema, walker, runtime contract), sequenced roadmap, exit gates
└── v2c.md         module system: scope, content, sequenced roadmap, exit gates
```

The split was motivated by a fresh-context-agent review: the integrated single-file document had the design substance but lacked operational structure (sequenced steps, spike-vs-production separation, failure paths, per-phase exit checklists). Each phase file now contains its own implementation roadmap with those pieces explicit.
