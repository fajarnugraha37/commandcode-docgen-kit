# Changelog

## 2.0.0 — Token-efficient semantic index

### Breaking

- Removed the v1 monolithic `docgen.mjs` engine.
- Removed discovery, analyze, semantics, enterprise-pass, enrichment, fix, update-impact, and full re-audit commands/prompts.
- Removed all custom pipeline agents and parent-to-subagent delegation.
- Removed legacy auto-enrich, auto-fix, and re-audit configuration.
- Requires Node.js 22.5+ for built-in `node:sqlite`.
- Existing v1 repositories must run `docgen migrate`.

### Added

- SQLite/FTS5 semantic index with incremental file hashing.
- Overlapping source chunks plus deterministic symbol/interface/config/SQL extraction.
- Bounded content-addressed context compiler.
- Hard provider call/input/output/per-call budgets.
- Provider telemetry and stage usage reports.
- Two-call model synthesis: core and enterprise.
- Deterministic catalog/reference rendering.
- Item-level page invalidation.
- Claim-level traceability generated in the same page invocation.
- Deterministic FACT/evidence validation.
- Selective, risk-scored, hash-cached LLM audit.
- Breaking v1-to-v2 migration with backup and docs/ignore preservation.
- Node.js 22/24 CI and semantic-index regression suite.

### Changed

- Planning defaults to at most 30 pages unless explicitly configured otherwise.
- Provider prompts are direct and context-only.
- Skills remain available for manual Command Code work but are not automatically loaded by the pipeline.
- Source inventory moved from `.docgen/state` to `.docgen/index`.
- Publishing and P3 workspace aggregation remain deterministic.

### Removed dead managed files during installation

The installer backs up and removes v1 executable, prompts, agents, and obsolete slash commands from global and project-local installations.

## 1.0.0

P3 system-of-systems workspace release built on the original provider-heavy repository pipeline.
