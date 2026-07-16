<!-- COMMANDCODE-DOCGEN:START -->
# Documentation Engineering System

This repository contains an evidence-grounded documentation workflow under `.docgen/**` with published Markdown under `docs/**`.

## Authority Order

When documentation claims conflict, use this authority order:

1. application source code and executable behavior
2. configuration, contracts, schemas, migrations, and deployment manifests
3. generated evidence artifacts in `.docgen/evidence/**`
4. normalized models in `.docgen/model/**`
5. existing documentation

Existing prose is never authoritative over contradictory source evidence.

## Epistemic Rules

Important technical statements must be treated as one of:

- `FACT`: directly supported by source evidence
- `INFERENCE`: derived from multiple facts; the supporting evidence must be recorded
- `UNKNOWN`: insufficient evidence; do not invent a conclusion

Never invent endpoints, business rules, state transitions, integrations, data ownership, security behavior, retry behavior, failure semantics, or operational guarantees.

## Documentation Workflow

Use this order:

```text
discover -> analyze -> plan -> generate -> audit -> fix as needed
```

Do not skip directly from source code to broad user-facing documentation for non-trivial systems.

## Artifact Boundaries

- evidence: `.docgen/evidence/**`
- architecture/workflow model: `.docgen/model/**`
- documentation plan: `.docgen/plan/**`
- audit findings: `.docgen/audit/**`
- generated documentation: `docs/**`

DocGen workflows must not modify application source, build files, migrations, infrastructure, or tests.

## Writing Standard

Write for engineers who do not yet know the codebase. Prefer purpose, mental model, responsibilities, boundaries, interactions, workflows, state transitions, failure behavior, and actionable guides. Avoid file-by-file or class-by-class narration.

Use standard Markdown and Mermaid. Keep claims precise and traceable to evidence. Mark genuine uncertainty instead of smoothing it over.
<!-- COMMANDCODE-DOCGEN:END -->


## Source Inventory and Ignore Boundary

During DocGen workflows, repository source access must follow `.docgen/state/source-files.txt`. Do not read, search, cite, fingerprint, or use as FACT evidence any file excluded by `.gitignore`, `.docgenignore`, DocGen hard exclusions, or project `config.exclude`. Use explicit included paths or `docgen source-grep` instead of broad wildcard reads.

## P1 Enterprise Depth

When supported by evidence, build typed models for security, operations, testing, data governance, decisions, configuration, change impact, and ownership. Keep policy, business semantics, implementation behavior, operational guarantees, and inferred rationale epistemically distinct. Do not invent SLOs, permissions, owners, retention periods, recovery guarantees, or architectural rationale.

## P3 system-of-systems workspace

For multi-repository documentation, use `docgen workspace ...` from a parent workspace. Workspace analysis must consume validated `.docgen/model/**` artifacts from member repositories rather than bypassing repository ignore, binary, traceability, and contract boundaries. Cross-repository relationships require explicit contract/dependency evidence. All system diagrams use Mermaid.
