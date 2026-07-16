# DocGen project workspace

This `.docgen` directory holds repository-specific configuration, semantic indexes, bounded contexts, normalized models, execution checkpoints, provider logs, audits, traceability, and publishing metadata. The reusable engine is installed separately under `~/.commandcode/docgen/`.

Source code and explicitly supplied repository artifacts remain authoritative. Generated models and documentation are derived, validated artifacts—not a replacement for the source.

## Technology-neutral scope

DocGen does not require a particular language, framework, library, protocol, database, messaging system, or deployment architecture. It can document applications, packages, libraries, command-line tools, background jobs, plugins, infrastructure, data pipelines, embedded software, monoliths, services, or mixed repositories.

Technology-specific facts are emitted only when supported by indexed evidence. Generic file artifacts and source chunks provide the fallback for unfamiliar ecosystems.

## Important paths

| Path | Purpose |
|---|---|
| `config/documentation.json` | project policy, budgets, provider settings, execution, and audit gates |
| `index/inventory.json` | canonical included/excluded source boundary and file hashes |
| `index/source-files.txt` | human-readable included source list |
| `index/semantic.db` | incremental SQLite/FTS semantic index |
| `context/<stage>/*.json` | bounded provider inputs with omissions and input hashes |
| `model/*.json` | normalized core and enterprise semantic models |
| `plan/manifest.json` | canonical documentation page plan |
| `state/state.json` | stage and page checkpoints used by resume |
| `runs/*.stdout.log` / `*.stderr.log` | provider diagnostics per invocation |
| `telemetry/provider-runs.jsonl` | provider status, model, turns, timeout, tokens, and recovery |
| `budget/report.json` | provider call/token usage and remaining budget |
| `traceability/pages/*.json` | claim-level source and model mappings per page |
| `audit/deterministic.json` | detailed structural, grounding, freshness, link, and coverage findings |
| `audit/quality-summary.json` | current publish gate and aggregate quality metrics |
| `publish/navigation.json` | deterministic documentation navigation |
| `publish/search-index.json` | deterministic search metadata |
| `traceability/index.json` | published page trace summary |

## Normalized model surfaces

Core models:

- `model/system.json`
- `model/business.json`
- `model/flows.json`
- `model/catalogs.json`

Enterprise-depth models:

- `model/security.json`
- `model/operations.json`
- `model/testing.json`
- `model/data-governance.json`
- `model/decisions.json`
- `model/configuration.json`
- `model/change-impact.json`
- `model/ownership.json`

These are extensible, framework-neutral structures. Optional technology-specific catalogs may appear only when the repository provides evidence for them.

## Resume and recovery

`docgen all` and `docgen resume` use the same checkpoint-aware pipeline:

```text
index -> modelCore -> modelEnterprise -> plan -> generate -> audit -> publish
```

A full run indexes once. Completed work is reused only while source, model, context, output, and trace hashes are current. If a generation batch fails after producing some valid pages, those pages are checkpointed immediately and only unresolved pages are retried. A non-zero provider exit is recoverable only when the current invocation wrote fresh artifacts that pass their output contracts.

Use:

```text
docgen status
docgen budget
docgen resume
```

Provider progress shows the effective executable, model, maximum turns, timeout, context size, elapsed time, and log locations.

## Correctness and publishing

A `FACT` must be grounded in the canonical source inventory. By default, evidence also needs valid line locations, the live source must still match its indexed hash, and generated claims may only reference evidence/model items supplied in their bounded page context.

The deterministic audit checks model identities and evidence, page and trace hashes, required sections, local links, duplicate content, conflicting or duplicate claims, stale/orphan artifacts, and model-reference coverage. Selective provider audit is reserved for semantic risk that deterministic checks cannot prove.

`docgen publish` refuses to run unless the audit is passing and still current. It revalidates the source, models, pages, traces, and audit identity before creating navigation, search, trace indexes, `docs/llms.txt`, and `docs/llms-full.txt`.

## Source boundary

DocGen follows Git-aware source discovery when available and falls back to filesystem traversal otherwise. Repository `.gitignore`, root `.docgenignore`, binary signatures, invalid UTF-8, NUL-containing files, compiled artifacts, archives, database files, fonts, media, office documents, oversized text, and configured deny extensions are excluded before indexing.

Inspect the effective boundary with:

```text
docgen ignore
docgen source-list [substring]
docgen source-grep <text>
```

Ignored or stale files cannot be used as FACT evidence.
