Mandatory source boundary: never read or cite repository source absent from `.docgen/state/source-files.txt`. Existing `.docgen/**` and `docs/**` artifacts are allowed.

You are running a bounded DocGen page generation stage.

Page manifest entry:
{{PAGE_JSON}}

Delegate exactly this page to the `doc-writer` custom agent.

This page is part of a deep multi-page system knowledge base. Treat the manifest as a content contract, not a suggestion.

Quality contract:
- cover every required section and every coverage tag relevant to this page;
- use all relevant declared evidence/model inputs, including business/flows/catalog models;
- begin with orientation and purpose, then progressively deepen into implementation and operational detail;
- explain boundaries, actors, inputs/outputs, ownership, lifecycle, invariants, rules, decisions, branch conditions and failure behavior when supported;
- for flow pages, enumerate steps and branches before or alongside the diagram;
- for reference pages, be exhaustive over the corresponding normalized catalog rather than sampling a few entries;
- endpoint pages must list all catalogued endpoints in scope and explain handler/security/validation/downstream effects when known;
- messaging pages must list all catalogued producers/consumers/listeners/processors/handlers in scope and explain channel, payload, delivery, retry/DLQ/idempotency/order behavior when known;
- integration pages must list all catalogued external/cloud/internal dependencies in scope and explain direction, protocol, data, auth and failure behavior when known;
- use tables for dense catalogs and decision matrices;
- include practical examples and implementation orientation when supported;
- include cross-links to related pages;
- include source-grounding notes where they materially help maintainers verify behavior;
- all diagrams MUST use fenced `mermaid`; never use PlantUML, Graphviz, ASCII-art diagrams, or image-only diagrams;
- never pad with generic textbook prose and never invent unsupported behavior.

Write exactly the manifest target path. Do not modify unrelated pages or application source. Validate Markdown structure before finishing.

Claim-level traceability contract:
- In the SAME run, write the companion JSON declared by `traceabilityPath` in the page contract.
- The sidecar must contain `claims[]`; each material repository-specific claim needs: `id`, `section`, `statement`, `classification`, confidence, optional `subject`/`predicate`/`object`/`polarity`, `evidence[]`, and `sourceModelRefs[]`.
- `FACT` claims require direct evidence. Do not manufacture source paths or symbols.
- Populate `coverage.evidenceRefsUsed` with declared evidence/model inputs actually used, and populate model/catalog/branch item refs with their stable IDs.
- Omit pageHash/inputHash if unknown; the orchestrator fills them after the page is written.
- Unknown or disputed behavior belongs in `unknowns[]`, not as a confident claim.

Traceability contradiction precision:
- Set `exclusivePredicate: true` only when the subject/predicate is single-valued and different objects would be mutually exclusive.
- Leave it false for multi-valued relations such as “has component”, “uses service”, or “emits event”.
