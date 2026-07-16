# DocGen Project Workspace

This directory contains repository-specific DocGen configuration, generated evidence, models, plans, audits, run metadata, and state.

The reusable DocGen engine is installed globally under `~/.commandcode/docgen/`.

Do not treat generated evidence or model artifacts as higher authority than source code.


## Core knowledge models

In addition to technical architecture, DocGen generates repository-local normalized models for business semantics, distinct flow types, and exhaustive interface/dependency catalogs:

- `model/business.json`
- `model/flows.json`
- `model/catalogs.json`

Published diagrams are Mermaid-only.

## P0 trustworthiness artifacts

- `traceability/pages/*.json`: claim-level source mappings per page.
- `traceability/index.json`: aggregated claims and source snapshot.
- `traceability/contradictions.json`: conflicting subject/predicate claims.
- `traceability/duplicates.json`: unintentional repeated claims.
- `traceability/freshness.json`: page/input/source staleness status.
- `audit/quality-summary.json`: evidence-centric quality metrics.


## P1 enterprise-depth models

The enterprise stage produces repository-local typed models:

- `model/security.json`
- `model/operations.json`
- `model/testing.json`
- `model/data-governance.json`
- `model/decisions.json`
- `model/configuration.json`
- `model/change-impact.json`
- `model/ownership.json`

These models cover trust boundaries, AuthN/AuthZ, ownership/RACI, operational health and recovery, test strategy, data correctness/governance, environment configuration, architectural rationale, and change blast radius.

## Ignore-aware source inventory

DocGen follows repository `.gitignore` and root `.docgenignore`. The effective included source set is written to:

- `state/source-inventory.json`
- `state/source-files.txt`
- `state/ignore-report.json`

Ignored files are excluded from discovery, fingerprints, change detection, traceability, and FACT evidence. Use `docgen ignore`, `docgen source-list`, and `docgen source-grep` to inspect or search the effective source boundary.

## v0.9 P2 documentation experience

Published pages are classified by user intent: `tutorial`, `how-to`, `explanation`, `reference`, `runbook`, `decision-record`, `migration-guide`, or `troubleshooting`. DocGen deterministically produces:

- Markdown frontmatter;
- `docs/llms.txt` and bounded `docs/llms-full.txt`;
- `publish/navigation.json` and `publish/search-index.json`;
- backlinks, aliases/redirects, orphan-page and examples indexes;
- version, status, deprecation, replacement, and migration metadata.

Run `docgen publish` to rebuild these assets without an LLM call.

## Binary and non-text token boundary

Known images, audio/video, PDFs and office documents, archives, compiled artifacts, fonts, database files, keystores, invalid UTF-8, NUL-containing files, and oversized text are excluded from the canonical source inventory. The exclusion applies to reads, grep, fingerprints, change detection, freshness, and evidence validation. Configure the boundary under `ignore.binary` in `config/documentation.json`.
