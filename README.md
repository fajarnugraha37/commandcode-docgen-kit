# Command Code DocGen Kit 2.0

**Token-efficient, evidence-grounded repository-to-Markdown documentation for Command Code CLI.**

DocGen 2 replaces the former provider-heavy eight-phase pipeline with a deterministic semantic index and bounded context compiler. Repository source is read once into local SQLite/FTS5. Every provider invocation receives only a content-addressed context pack selected for that stage or page.

> Version 2 is a breaking redesign. The legacy discovery/analyze/semantics/enterprise/enrich/fix/re-audit execution path is not included.

## Why version 2 exists

On large repositories, the previous design could repeatedly expose the same source, evidence, and broad model JSON to dozens of agentic calls. A documentation run could consume millions of tokens even when most work involved extracting catalogs or re-reading unchanged knowledge.

Version 2 changes the cost model:

```text
repository text source
        │
        ▼
deterministic inventory and binary guard
        │
        ▼
SQLite / FTS5 semantic index
  files, source chunks, symbols, endpoints,
  messages, SQL/config facts, model items
        │
        ▼
bounded context compiler
  relevance retrieval + deduplication + hard token cap
        │
        ├──────────────► deterministic reference renderer
        │
        └──────────────► selective provider reasoning/writing
                              │
                              ▼
                  deterministic traceability and risk audit
```

The pipeline no longer asks a parent session to delegate to custom agents. Provider prompts execute directly, cannot broadly scan source or model directories, and are constrained by read hooks.

## Requirements

- Node.js **22.5+** for `node:sqlite`;
- Git;
- Command Code CLI, authenticated for provider-backed stages;
- npm only for the global CLI link performed by the installer.

DocGen has no runtime npm dependencies. SQLite and FTS5 use Node's built-in `node:sqlite` module.

## Install

### Global-first

```bash
node install.mjs --force
```

The installer copies the modular engine to `~/.commandcode/docgen`, installs slash-command definitions and hooks, links the `docgen` executable, and removes backed-up managed v1 files.

Initialize a new repository:

```bash
cd /path/to/repository
docgen init
docgen doctor
docgen all
```

### Project-local

```bash
node install.mjs --project-local /path/to/repository --force
```

Project-local installation keeps the engine under `.commandcode/docgen` and preserves an existing `.docgenignore`.

## Migrate a v1 repository

```bash
node install.mjs --force
cd /path/to/existing/repository
docgen migrate
docgen doctor
docgen all
```

`docgen migrate`:

- preserves `docs/**`;
- preserves `.docgenignore`;
- preserves selected project name, Command Code runtime/model, and ignore settings;
- archives old `.docgen` workflow artifacts under `.docgen/migration-backup/<timestamp>/`;
- installs the v2 config and state contract.

It does not attempt to run v1 evidence/checkpoints through the v2 engine.

## Repository pipeline

```bash
docgen index
docgen model
docgen plan
docgen generate
docgen audit
docgen publish
```

Or:

```bash
docgen all
# content-hash resumable alias
docgen resume
```

### 1. Index

`docgen index` constructs:

```text
.docgen/index/
├── inventory.json
├── source-files.txt
└── semantic.db
```

The SQLite database contains:

- included files and content hashes;
- overlapping source chunks;
- discovered symbols/functions;
- JAX-RS and Spring HTTP annotations;
- Kafka/RabbitMQ channels and listeners;
- configuration keys;
- SQL table references;
- scheduled/security annotations;
- typed model items;
- content-addressed context metadata.

Indexing is incremental at file-hash granularity.

### 2. Model

`docgen model` uses two bounded provider calls:

1. core models: system, business, flows, catalogs;
2. enterprise models: security, operations, testing, data governance, decisions, configuration, change impact, ownership.

Core models are ingested into SQLite before enterprise synthesis, so the second call can retrieve relevant typed items without reading broad model files.

### 3. Plan

`docgen plan` receives one bounded context pack and creates `.docgen/plan/manifest.json`.

The default maximum is 30 pages. The planner is instructed to split by distinct user intent or ownership boundary, not to maximize page count. Increase `execution.maxPlannedPages` explicitly when a larger information architecture is justified.

### 4. Generate

`docgen generate` uses two paths:

- deterministic rendering for endpoint, message, dependency, data-store, scheduled-job, configuration, ownership, and change-impact references;
- bounded provider writing for narrative/business/architecture/runbook/migration pages.

Each narrative page receives its own `.docgen/context/generate/<page-id>.json`. Pages are regenerated only when their page contract or selected item hashes change.

Every page has a companion:

```text
.docgen/traceability/pages/<page-id>.json
```

Provider pages write the sidecar in the same invocation. Deterministic reference pages derive claims directly from typed items.

### 5. Audit

`docgen audit` always runs deterministic checks:

- Markdown/frontmatter/H1 validity;
- Mermaid-only diagrams;
- traceability identity and hashes;
- duplicate claim IDs;
- FACT claims without evidence;
- evidence paths outside the canonical inventory;
- unresolved placeholders and risky absolute wording.

Only pages above `audit.llmRiskThreshold` receive a bounded LLM semantic audit. The risk audit is content-hash cached and is not repeated when page/context inputs are unchanged. There is no automatic enrich/fix/re-audit loop.

### 6. Publish

`docgen publish` is deterministic and produces:

```text
docs/llms.txt
docs/llms-full.txt
.docgen/publish/navigation.json
.docgen/publish/search-index.json
.docgen/traceability/index.json
```

## Token budget and telemetry

Every provider run appends terminal telemetry to:

```text
.docgen/telemetry/provider-runs.jsonl
```

Inspect the budget:

```bash
docgen budget
```

Default limits:

```json
{
  "maxProviderCalls": 24,
  "maxEstimatedInputTokens": 2500000,
  "maxEstimatedOutputTokens": 500000,
  "maxContextTokensPerCall": 80000
}
```

DocGen stops before a provider call that would exceed a hard limit.

Compile and inspect a context without calling a provider:

```bash
docgen context generate "quote lifecycle submission rules" \
  --target quote-lifecycle \
  --max-tokens 30000
```

The result reports selected tokens plus omitted fact/model-item counts.

## Source and privacy boundary

DocGen applies, before indexing:

1. hard workflow exclusions such as `.git`, `.docgen`, `.commandcode`, `docs`, build outputs, and dependencies;
2. native Git ignore rules when inside a Git repository;
3. nested `.gitignore` fallback outside Git;
4. root `.docgenignore`;
5. binary extension and magic-signature detection;
6. NUL/invalid-UTF-8/control-character checks;
7. maximum text-file size.

Inspect the boundary:

```bash
docgen ignore
docgen ignore path/to/file
docgen source-list
docgen source-grep "@Path"
```

Provider sessions run with `DOCGEN_CONTEXT_ONLY=1`. Hooks allow only their declared context pack and stage output paths. They cannot read repository source, SQLite, broad model directories, unrelated pages, agents, or skill files.

## Configuration

Project configuration is stored in `.docgen/config/documentation.json`.

```json
{
  "schemaVersion": "2.0",
  "budget": {
    "maxProviderCalls": 24,
    "maxEstimatedInputTokens": 2500000,
    "maxContextTokensPerCall": 80000
  },
  "context": {
    "maxTokens": {
      "modelCore": 80000,
      "modelEnterprise": 80000,
      "plan": 50000,
      "generate": 30000,
      "audit": 18000
    }
  },
  "execution": {
    "generationBatchSize": 4,
    "maxPlannedPages": 30
  },
  "audit": {
    "llmEnabled": true,
    "llmRiskThreshold": 50
  }
}
```

Models can be routed by stage through `commandCode.stageModels`.

## Commands

```text
docgen init [directory]
docgen migrate
docgen doctor
docgen index [--force]
docgen model
docgen plan
docgen generate
docgen audit
docgen publish
docgen all
docgen resume
docgen status
docgen budget [report|reset]
docgen context <stage> [query] [--target ID] [--max-tokens N]
docgen ignore [path]
docgen source-list [substring]
docgen source-grep <text>
docgen stats
docgen workspace <command>
```

## Multi-repository workspace

P3 workspace support remains deterministic. It consumes validated repository models, hashes, catalogs, and ownership rather than rescanning source.

```bash
mkdir platform-docs && cd platform-docs
docgen workspace init . --name "Platform"
docgen workspace add ../catalog-service
docgen workspace add ../quote-service
docgen workspace add ../order-service
docgen workspace all
```

Workspace outputs include dependency graphs, shared contracts, capability maps, journeys, request/event/data flows, ownership, and transitive change impact.

## Skills

The repository still ships reusable documentation and technology knowledge skills for manual Command Code use. The v2 pipeline does **not** automatically load them into provider contexts. This prevents repeated skill text from consuming generation tokens.

## Development

```bash
cd global-template/docgen
npm run check
npm test
```

CI runs syntax and regression tests on Node.js 22 and 24, followed by installer dry-run validation.

## License

MIT.
