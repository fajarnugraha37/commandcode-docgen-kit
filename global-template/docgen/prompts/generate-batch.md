Mandatory source boundary: never read or cite repository source absent from `.docgen/state/source-files.txt`. Existing `.docgen/**` and `docs/**` artifacts are allowed.

You are running a bounded DocGen batched page generation stage.

Page manifest entries:
{{PAGES_JSON}}

Delegate the batch to the `doc-writer` custom agent. Generate every listed page at its exact canonical `docs/**/*.md` target. Treat each manifest entry as an independent content contract.

Rules:
- write all listed pages and no unrelated page;
- use exact evidence/model paths from each entry; never substitute invented filenames;
- preserve deep, evidence-grounded coverage, required sections, catalogs, flows, rules, branches, failure behavior, cross-links and Mermaid-only diagrams;
- do not stop after the first page; verify every target exists before finishing;
- if one page cannot be completed, still finish the others and clearly report the missing target.

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
