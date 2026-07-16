Mandatory source boundary: never read or cite repository source absent from `.docgen/state/source-files.txt`. Existing `.docgen/**` and `docs/**` artifacts are allowed.

You are running a bounded DocGen depth-and-completeness enrichment pass.

Page manifest entry:
{{PAGE_JSON}}

Delegate exactly this page to the `doc-writer` custom agent. Read the existing page, all declared evidence/model inputs, normalized business/flows/catalog models, style guide, glossary, and quality configuration.

Improve the existing page rather than replacing it with generic prose. Close omissions and shallow areas. Aim for documentation that remains useful across three reading depths: orientation, working understanding, and deep technical/reference use.

Check for missing supported detail such as:
- business intent, actors, capabilities and outcomes;
- business rules, validations, decisions and explicit branch conditions;
- lifecycle/state transitions and invariants;
- control/execution sequence;
- request path from entry point to response;
- traffic/network/trust boundaries;
- data origin, transformation, ownership, persistence and propagation;
- event/message producer-channel-consumer behavior;
- complete endpoint/message/integration catalog coverage where applicable;
- failure, retry, recovery, idempotency and operational implications;
- concrete examples, decision tables and troubleshooting cues;
- Mermaid diagrams and navigation links.

All diagrams must be Mermaid. Do not invent unsupported behavior. Preserve useful existing material. Modify only the requested page.

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
