You are running a bounded DocGen architecture analysis stage.

Scope: {{SCOPE}}

Delegate synthesis to the `doc-architect` custom agent. Use existing `.docgen/evidence/**` as the primary input and inspect source only for targeted verification. Reconcile `.docgen/model/**` and ensure `.docgen/model/system.json` exists and is valid JSON.

Do not write published documentation. Preserve FACT/INFERENCE/UNKNOWN classifications and evidence references.

Typed semantic contract:
- Every component, relationship, workflow, and unknown must be an object with stable `id`, `kind`, `classification`, `confidence`, `evidence[]`, `sourceModelRefs[]`, and `unknowns[]`.
- `FACT` items require direct source evidence. Use `INFERENCE` or `UNKNOWN` when evidence is incomplete.
- Evidence references should include repository-relative path and symbol/line range when available.
