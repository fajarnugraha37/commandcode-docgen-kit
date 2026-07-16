# DocGen Project Workspace

This directory contains repository-specific DocGen configuration, generated evidence, models, plans, audits, run metadata, and state.

The reusable DocGen engine is installed globally under `~/.commandcode/docgen/`.

Do not treat generated evidence or model artifacts as higher authority than source code.


## v0.4 knowledge models

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
