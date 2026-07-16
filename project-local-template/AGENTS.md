<!-- COMMANDCODE-DOCGEN:START -->
# DocGen 2 Documentation Engineering

This repository uses a token-efficient, evidence-grounded documentation pipeline. Repository source is indexed once into `.docgen/index/semantic.db`; provider runs receive bounded `.docgen/context/**` packs rather than broad source access.

## Authority order

1. application source and executable behavior;
2. configuration, API/message contracts, schemas, migrations, and deployment manifests;
3. deterministic facts/source chunks in the semantic index;
4. typed `.docgen/model/**` items;
5. generated documentation.

Existing prose is not authoritative over contradictory source evidence.

## Epistemic rules

Material statements are `FACT`, `INFERENCE`, or `UNKNOWN`.

- `FACT` requires direct repository-relative evidence present in the canonical source inventory.
- `INFERENCE` must identify supporting facts/model items.
- `UNKNOWN` preserves missing or disputed information without guessing.

Never invent endpoints, rules, states, integrations, ownership, security behavior, retry behavior, failure semantics, or operational guarantees.

## Workflow

```text
index -> model -> plan -> generate -> audit -> publish
```

Use `docgen all` or `docgen resume` for the complete content-hash-resumable pipeline. For a v1 project, run `docgen migrate` first.

## Token boundary

- source inventory: `.docgen/index/inventory.json` and `.docgen/index/source-files.txt`;
- semantic index: `.docgen/index/semantic.db`;
- bounded provider inputs: `.docgen/context/**`;
- provider telemetry/budget: `.docgen/telemetry/**` and `.docgen/budget/report.json`;
- typed models: `.docgen/model/**`;
- page plan: `.docgen/plan/manifest.json`;
- traceability: `.docgen/traceability/**`;
- audit results: `.docgen/audit/**`;
- published documentation: `docs/**`.

Provider runs are context-only: they must not read repository source, the SQLite database, broad model directories, unrelated pages, agents, or skills. Deterministic index/render/audit code owns those boundaries.

## Writing standard

Write for engineers who do not yet know the codebase. Prefer purpose, mental models, boundaries, interactions, lifecycles, branches, failure behavior, and actionable guidance over file-by-file narration. Use standard Markdown and Mermaid only. Keep claims precise and traceable.

## Enterprise and workspace depth

When evidence supports it, model security, operations, testing, data governance, decisions, configuration, change impact, and ownership. Multi-repository workspace analysis consumes validated repository models and must preserve unresolved edges rather than inventing cross-service links.

DocGen workflows may write only under `.docgen/**` and `docs/**`; they must not modify application source, build files, migrations, infrastructure, or tests.
<!-- COMMANDCODE-DOCGEN:END -->
