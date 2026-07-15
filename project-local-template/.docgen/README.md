# `.docgen` workspace

This directory is the explicit machine-readable state of Command Code DocGen Kit.

## Flow

```text
source
  -> evidence/
  -> model/
  -> plan/manifest.json
  -> ../docs/**/*.md
  -> audit/
```

## Directories

- `config/` — project documentation policy, glossary, style, and Command Code runtime configuration.
- `schemas/` — JSON contracts for generated intermediate artifacts.
- `prompts/` — bounded stage prompts used by the orchestrator.
- `evidence/` — source-grounded facts and their index.
- `model/` — components, relationships, workflows, unknowns, and system model.
- `plan/` — documentation manifest and incremental update plan.
- `audit/` — per-page findings and aggregate audit index.
- `runs/` — metadata for each orchestrated Command Code headless invocation.
- `state/` — pipeline state, fingerprints, and compatibility report.

## Most important files

```text
config/documentation.json
config/style-guide.md
config/glossary.md
evidence/index.json
model/system.json
plan/manifest.json
audit/index.json
state/state.json
state/fingerprints.json
state/compatibility.json
```

Do not treat generated documentation as more authoritative than source evidence. The pipeline intentionally preserves FACT / INFERENCE / UNKNOWN boundaries.
