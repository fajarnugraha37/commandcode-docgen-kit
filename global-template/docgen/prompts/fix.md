You are running a bounded DocGen repair stage.

Page manifest entry:
{{PAGE_JSON}}

Audit file: `.docgen/audit/pages/{{PAGE_ID}}.json`

Delegate exactly this page to the `doc-writer` custom agent. Repair supported audit findings using evidence/models. Do not broaden scope or modify unrelated pages. The repaired page must remain source-grounded and structurally valid.

Claim-level traceability contract:
- In the SAME run, write the companion JSON declared by `traceabilityPath` in the page contract.
- The sidecar must contain `claims[]`; each material repository-specific claim needs: `id`, `section`, `statement`, `classification`, confidence, optional `subject`/`predicate`/`object`/`polarity`, `evidence[]`, and `sourceModelRefs[]`.
- `FACT` claims require direct evidence. Do not manufacture source paths or symbols.
- Populate `coverage.evidenceRefsUsed` with declared evidence/model inputs actually used, and populate model/catalog/branch item refs with their stable IDs.
- Omit pageHash/inputHash if unknown; the orchestrator fills them after the page is written.
- Unknown or disputed behavior belongs in `unknowns[]`, not as a confident claim.
