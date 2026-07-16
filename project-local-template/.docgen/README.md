# `.docgen` workspace — v2

This directory stores the machine-readable state of the token-efficient DocGen pipeline.

## Flow

```text
included text source
  -> index/inventory.json
  -> index/semantic.db
  -> context/** bounded packs
  -> model/** typed knowledge
  -> plan/manifest.json
  -> ../docs/**/*.md + traceability/pages/*.json
  -> audit/**
  -> publish/**
```

## Directories

- `config/` — runtime, budget, context, ignore, audit, and publishing policy.
- `index/` — canonical inventory plus SQLite/FTS5 files, facts, source chunks, model items, and context metadata.
- `context/` — content-addressed bounded inputs supplied to provider runs.
- `model/` — core and enterprise typed semantic models.
- `plan/` — the bounded page manifest.
- `traceability/` — claim-level page sidecars and aggregate index.
- `audit/` — deterministic checks, selective high-risk LLM audit, and quality summary.
- `telemetry/` — provider-run JSONL telemetry.
- `budget/` — current call/token budget report.
- `runs/` — stdout/stderr logs for provider calls.
- `publish/` — deterministic navigation and search metadata.
- `state/` — content-hash stage and page checkpoints.
- `migration-backup/` — archived v1 artifacts created by `docgen migrate`.

## Important files

```text
config/documentation.json
index/inventory.json
index/source-files.txt
index/semantic.db
state/state.json
plan/manifest.json
traceability/index.json
audit/quality-summary.json
budget/report.json
publish/navigation.json
publish/search-index.json
```

## Provider boundary

Provider sessions may read only their declared `.docgen/context/**` pack and stage output paths. They may not scan repository source, query SQLite, load broad model directories, inspect unrelated pages, or delegate to installed agents. This boundary is enforced by hooks as well as prompts.

## Models

Core:

- `model/system.json`
- `model/business.json`
- `model/flows.json`
- `model/catalogs.json`

Enterprise:

- `model/security.json`
- `model/operations.json`
- `model/testing.json`
- `model/data-governance.json`
- `model/decisions.json`
- `model/configuration.json`
- `model/change-impact.json`
- `model/ownership.json`

All material items and page claims preserve `FACT`, `INFERENCE`, and `UNKNOWN`. FACT requires evidence from `index/inventory.json`.

## Commands

```bash
docgen migrate       # v1 repositories only
docgen index         # deterministic and incremental
docgen model         # two bounded synthesis calls
docgen plan
docgen generate      # deterministic references + bounded narratives
docgen audit         # deterministic + selective risk audit
docgen publish       # no provider call
docgen budget
docgen status
```

`docgen all` and `docgen resume` run the full content-hash-resumable flow.

## Ignore and binary boundary

`.gitignore`, `.docgenignore`, hard exclusions, binary signatures, invalid UTF-8, NUL bytes, and oversized text are applied before indexing. Use `docgen ignore`, `docgen source-list`, and `docgen source-grep` to inspect the effective source boundary.

## Multi-repository workspace

Register this repository into a parent workspace only after its models are current:

```bash
docgen workspace add /path/to/this-repository
docgen workspace all
```

Workspace aggregation consumes validated repository models and hashes; it does not rescan source.
