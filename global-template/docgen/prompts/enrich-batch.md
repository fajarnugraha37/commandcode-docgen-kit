You are running a targeted DocGen batched enrichment stage.

Only these pages failed deterministic local quality gates:
{{PAGES_JSON}}

Delegate to `doc-writer`. Improve each existing target in place. Add only evidence-supported depth needed to satisfy required sections, catalog completeness, flow steps/branches, Mermaid diagram intents, examples, invariants and failure behavior. Do not rewrite unrelated pages. Verify all targets before finishing.

Claim-level traceability contract:
- In the SAME run, write the companion JSON declared by `traceabilityPath` in the page contract.
- The sidecar must contain `claims[]`; each material repository-specific claim needs: `id`, `section`, `statement`, `classification`, confidence, optional `subject`/`predicate`/`object`/`polarity`, `evidence[]`, and `sourceModelRefs[]`.
- `FACT` claims require direct evidence. Do not manufacture source paths or symbols.
- Populate `coverage.evidenceRefsUsed` with declared evidence/model inputs actually used, and populate model/catalog/branch item refs with their stable IDs.
- Omit pageHash/inputHash if unknown; the orchestrator fills them after the page is written.
- Unknown or disputed behavior belongs in `unknowns[]`, not as a confident claim.
