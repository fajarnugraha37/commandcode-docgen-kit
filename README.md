# Command Code DocGen Kit

**Global-first, evidence-grounded repository-to-Markdown documentation generation for Command Code CLI.**

Command Code DocGen Kit turns Command Code into a reusable documentation engineering runtime that can be installed once and used across many repositories.

The default installation model is intentionally split into two scopes:

```text
GLOBAL USER SCOPE
~/.commandcode/
├── agents/                 reusable specialized agents
├── skills/                 reusable procedures and technology/domain knowledge
├── commands/               global /docgen-* commands
├── settings.json           conditional DocGen hooks merged with existing settings
└── docgen/                 reusable engine
    ├── bin/
    ├── hooks/
    ├── prompts/
    ├── schemas/
    └── project-template/

PROJECT SCOPE
<repository>/
├── .docgen/                repository-specific config, evidence, models, plans, audit, state
├── docs/                   generated Markdown + Mermaid
└── .commandcode/           optional project overrides only; not created by default
```

The key boundary is:

```text
GLOBAL = how DocGen works
PROJECT = what this repository contains
```

Install the engine once. Initialize any number of repositories independently.

---

## What's new in v0.7.0

v0.7.0 is the **P0 Documentation Trustworthiness release**. It keeps the v0.6 contract firewall and adds the controls required to determine whether generated documentation is actually supported by repository evidence rather than merely long and plausible.

The P0 scope is intentionally limited to:

1. strongly typed semantic model items;
2. claim-level source traceability;
3. evidence-centric quality metrics;
4. cross-page contradiction and duplicate detection;
5. source commit/fingerprint freshness metadata;
6. advisory word-count targets instead of prose-length hard gates.

The central quality model is now:

```text
source evidence
      │
      ▼
typed semantic items
      │
      ▼
page claims + source/model references
      │
      ▼
deterministic coverage and consistency metrics
      │
      ▼
quality gate
```

A page is not considered trustworthy merely because it contains many words, headings, or diagrams.

### Strongly typed semantic items

Every normalized model item is committed as an object with a stable identity and epistemic contract:

```json
{
  "id": "rule-submit-draft-only",
  "kind": "business-rule",
  "name": "Draft-only submission",
  "statement": "A quote can be submitted only from DRAFT",
  "classification": "FACT",
  "confidence": 1,
  "evidence": [
    {
      "id": "quote-service-submit",
      "path": "src/main/java/example/QuoteService.java",
      "symbol": "QuoteService#submit",
      "startLine": 120,
      "endLine": 146,
      "note": null
    }
  ],
  "sourceModelRefs": [],
  "unknowns": [],
  "tags": []
}
```

Typed contracts apply to components, relationships, workflows, actors, capabilities, concepts, rules, decisions, branches, lifecycles, use cases, six flow types, endpoints, message handlers, dependencies, data stores, and scheduled jobs.

`FACT` items without resolvable direct evidence are rejected before downstream generation. Unsupported statements must be classified as `INFERENCE` or `UNKNOWN`.

### Claim-level page traceability

Every generated page now has a companion artifact:

```text
.docgen/traceability/pages/<page-id>.json
```

The sidecar records material claims, their page section, epistemic classification, source evidence, normalized model/catalog references, and coverage information:

```json
{
  "pageId": "quote-lifecycle",
  "pagePath": "docs/business/quote-lifecycle.md",
  "claims": [
    {
      "id": "quote-lifecycle-claim-1",
      "kind": "claim",
      "section": "Submission",
      "statement": "Only DRAFT quotes may be submitted",
      "classification": "FACT",
      "confidence": 1,
      "subject": "quote",
      "predicate": "submission-allowed-from",
      "object": "DRAFT",
      "polarity": "positive",
      "evidence": [
        {
          "path": "src/main/java/example/QuoteService.java",
          "symbol": "QuoteService#submit",
          "startLine": 120,
          "endLine": 146
        }
      ],
      "sourceModelRefs": ["rule-submit-draft-only"],
      "intentionalDuplicate": false
    }
  ],
  "coverage": {
    "evidenceRefsUsed": ["quote-service"],
    "modelItemRefs": ["rule-submit-draft-only"],
    "catalogItemRefs": [],
    "branchItemRefs": ["branch-submit-status"]
  }
}
```

Writers create the Markdown page and traceability sidecar in the same bounded Command Code run. The orchestrator fills page/input hashes after generation.

### Evidence-centric quality gates

`docgen quality` now prioritizes:

- claim grounding ratio;
- declared evidence coverage ratio;
- model-item coverage;
- exhaustive catalog coverage;
- decision/branch coverage;
- unsupported claim count;
- stale page/input/source fingerprints;
- cross-page contradictions;
- audit severity.

Default P0 thresholds:

```json
{
  "semanticMetrics": {
    "minStructuredClaimRatio": 0.7,
    "minClaimGroundingRatio": 0.9,
    "minEvidenceCoverageRatio": 0.8,
    "minModelCoverageRatio": 0.9,
    "minCatalogCoverageRatio": 1.0,
    "minBranchCoverageRatio": 0.9,
    "minEvidenceClaimsPer1000Words": 1.5,
    "evidenceClaimDensityGate": "hard",
    "maxUnsupportedClaims": 0,
    "maxContradictions": 0,
    "maxClaimIdCollisions": 0,
    "maxStalePages": 0,
    "duplicateClaimsAsWarning": true
  }
}
```

Word count remains visible but is advisory. A short grounded reference page can pass; a long generic page with unsupported claims fails.

### Cross-page consistency index

Run without consuming LLM tokens:

```powershell
docgen traceability
```

It creates:

```text
.docgen/traceability/index.json
.docgen/traceability/contradictions.json
.docgen/traceability/duplicates.json
.docgen/traceability/freshness.json
```

Contradictions are detected when grounded claims use the same normalized subject/predicate but disagree on value or polarity. Exact semantic duplicates are grouped separately; claims explicitly marked `intentionalDuplicate` are excluded from duplicate failures.

### Source freshness

Traceability artifacts capture:

```text
git commit
branch
dirty state
repository source fingerprint
page hash
evidence/model input hash
```

A page becomes stale when its Markdown changes, declared evidence/model content changes, or the repository source fingerprint changes without regeneration/revalidation.

### Upgrade from v0.6.0

```powershell
# Install the global v0.7.0 engine
.\install.ps1 -Force

cd C:\path	o
epository

docgen migrate
docgen contract-test
docgen validate
docgen resume
```

Existing valid Markdown is preserved. Pages without a v0.7 traceability sidecar are treated as legacy-unmapped and receive targeted enrichment rather than full regeneration.

### P0 commands

```powershell
docgen traceability   # rebuild claim, contradiction, duplicate and freshness indexes
docgen quality        # run semantic/evidence quality gates
docgen contract-test  # zero-token contract regression suite
docgen validate       # contract + static + generated artifact validation
```

## Contract firewall retained from v0.6.0

v0.7.0 is the **contract-firewall release**. It addresses the root class behind both expensive failures reported in earlier versions:

```text
LLM producer emits a reasonable representation
        │
        ▼
orchestrator assumes a different literal representation
        │
        ▼
failure appears only after a costly stage has completed
```

The two observed examples were:

- discovery wrote an evidence index using `files[]`, while the validator required `artifacts[]`;
- planning/writing used `orientation/overview` versus `docs/orientation/overview.md`.

Those are no longer handled as isolated special cases. Every LLM-output boundary now passes through the same protocol:

```text
snapshot previous canonical artifact
        │
        ▼
run bounded Command Code stage
        │
        ▼
accept known semantic aliases
        │
        ▼
normalize to one canonical representation
        │
        ▼
validate identity, paths, references and invariants
        │
        ├── PASS → atomically commit canonical artifact
        │
        └── FAIL → quarantine raw output + restore previous artifact + stop
```

### Contract-firewall coverage

| LLM stage | Canonical committed artifact | Examples of accepted variants |
|---|---|---|
| Discovery | `.docgen/evidence/index.json` with `artifacts[]` | `files`, `entries`, `documents`, `items` |
| Architecture analysis | `.docgen/model/system.json` | `services→components`, `dependencies→relationships`, `processes→workflows` |
| Business semantics | `.docgen/model/business.json` | `roles→actors`, `rules→businessRules`, `conditions→branchConditions` |
| Flow semantics | `.docgen/model/flows.json` | generic typed `flows`, `httpFlows`, `networkFlows`, `messageFlows` |
| Catalog semantics | `.docgen/model/catalogs.json` | `routes→endpoints`, producers/consumers/listeners→`messageHandlers`, integrations→`externalDependencies` |
| Planning | `.docgen/plan/manifest.json` | `documents→pages`, `categories→navigation`, `outputPath→path` |
| Page writing | `docs/**/*.md` | missing `docs/`, missing `.md`, uniquely reconcilable misplaced page |
| Audit | `.docgen/audit/pages/<id>.json` | `issues→findings`, `id→pageId`, `path→pagePath`, `hash→pageHash` |
| Incremental update | `.docgen/plan/update-plan.json` | `changedFiles`, `scopes`, `models`, `pages`, `reasons` |

Canonical writeback removes ambiguous aliases after normalization. Downstream agents therefore never receive both `outputPath` and `path`, or both `files` and `artifacts`, as competing sources of truth.

### New zero-token regression command

```powershell
docgen contract-test
```

This does not call an LLM provider. It tests:

- alias normalization;
- canonical page paths;
- normalizer idempotence: `normalize(normalize(x)) == normalize(x)`;
- catalog losslessness across producers, consumers and listeners;
- audit identity normalization;
- evidence-path safety;
- canonical update-plan normalization.

The result is stored in:

```text
.docgen/state/contract-report.json
```

`docgen doctor` and `docgen validate` run the same contract suite automatically.

### Transactional stage recovery

Discovery, analysis, semantics, planning and incremental-impact analysis are transactional. If Command Code exits unsuccessfully or exits successfully with malformed/incompatible output:

1. partial output is copied to `.docgen/quarantine/<timestamp>-<stage>/`;
2. the last valid canonical artifact is restored;
3. downstream stages are not started;
4. the terminal reports the quarantine path and exact contract cause.

Before an automatic provider retry, stage output is reset to the original snapshot. A second attempt cannot inherit half-written JSON from the first attempt.

### Dependency-aware resume

A completed status is no longer enough to skip a stage. DocGen normalizes and validates the checkpoint before reuse. If an upstream checkpoint must rerun, all dependent semantic/planning stages rerun as well.

Generated pages now record a hash of:

```text
page manifest contract
+ declared evidence content
+ declared model content
```

A page is skipped only while that input fingerprint remains current. Existing valid pages from v0.4/v0.5 are adopted once without regeneration, preserving already-spent tokens; future evidence/model changes invalidate only affected page checkpoints. Audit reuse additionally requires both the current page hash and the current input fingerprint.

### Safe recovery from the reported failure

```powershell
# From the extracted v0.7.0 package
.\install.ps1 -Force

cd C:\path\to\your\repository

docgen migrate
docgen contract-test
docgen validate
docgen resume
```

Do not delete `.docgen` or `docs`. A page already generated as `docs/orientation/overview.md` is canonicalized/adopted and will not be regenerated solely because an older manifest omitted `docs/` or `.md`.

## Table of contents

1. [What DocGen is](#what-docgen-is)
2. [Why the global-first architecture matters](#why-the-global-first-architecture-matters)
3. [Capabilities](#capabilities)
4. [Requirements](#requirements)
5. [Install globally](#install-globally)
6. [Initialize a repository](#initialize-a-repository)
7. [Quick start](#quick-start)
8. [Live progress, heartbeat, logs, and error visibility](#live-progress-heartbeat-logs-and-error-visibility)
9. [Comprehensive quality profile](#comprehensive-quality-profile)
10. [P0 trustworthiness and traceability](#p0-trustworthiness-and-traceability)
10. [How it works](#how-it-works)
9. [Execution flow](#execution-flow)
10. [State machine](#state-machine)
11. [Global versus project-local files](#global-versus-project-local-files)
12. [Agents](#agents)
13. [Skills](#skills)
14. [Global slash commands](#global-slash-commands)
15. [CLI command reference](#cli-command-reference)
16. [Fail-fast preflight and canonical paths](#fail-fast-preflight-and-canonical-paths)
17. [Contract firewall and transactional artifacts](#contract-firewall-and-transactional-artifacts)
17. [Resumability, batching, and checkpoints](#resumability-batching-and-checkpoints)
18. [Rate limits, retries, and provider failures](#rate-limits-retries-and-provider-failures)
16. [Evidence model](#evidence-model)
17. [FACT, INFERENCE, and UNKNOWN](#fact-inference-and-unknown)
18. [Documentation manifest and bounded generation](#documentation-manifest-and-bounded-generation)
19. [Audit and repair](#audit-and-repair)
20. [Incremental regeneration](#incremental-regeneration)
21. [Configuration](#configuration)
22. [Model and turn-budget configuration](#model-and-turn-budget-configuration)
23. [Safety model and hooks](#safety-model-and-hooks)
24. [Project overrides and precedence](#project-overrides-and-precedence)
25. [Large repositories and monorepos](#large-repositories-and-monorepos)
26. [Git and team workflow](#git-and-team-workflow)
27. [Upgrade](#upgrade)
28. [Uninstall](#uninstall)
29. [Self-contained project-local installation](#self-contained-project-local-installation)
30. [Troubleshooting](#troubleshooting)
31. [Extending DocGen](#extending-docgen)
32. [Included technology and domain coverage](#included-technology-and-domain-coverage)
33. [Known limitations](#known-limitations)
34. [Compatibility notes](#compatibility-notes)

---

# What DocGen is

DocGen is a documentation compiler workflow built around Command Code.

It does **not** treat the LLM as the source of truth. The repository remains authoritative.

The intended transformation is:

```text
source repository
      │
      ▼
source-grounded evidence
      │
      ▼
normalized technical architecture
      │
      ▼
business + flow + catalog semantics
      │
      ▼
documentation information architecture
      │
      ▼
bounded page generation
      │
      ▼
independent audit
      │
      ▼
Markdown + Mermaid
```

The primary output is plain files under:

```text
docs/
```

Those files can be rendered by any Markdown-capable system, for example:

- Mintlify
- Docusaurus
- VitePress
- MkDocs
- GitHub
- GitLab
- an internal documentation portal

DocGen does not require a particular renderer.

---

# Why the global-first architecture matters

Earlier versions of the kit copied the entire engine into every target repository. That model is useful for a fully self-contained team-owned repository, but it is inefficient when one user wants to use the same documentation system across many repositories.

The default architecture in v0.7.0 is therefore:

```text
install once globally
        │
        ├──────────────► repository A ──► .docgen/ + docs/
        │
        ├──────────────► repository B ──► .docgen/ + docs/
        │
        └──────────────► repository C ──► .docgen/ + docs/
```

Benefits:

- one engine installation;
- one place to upgrade agents, skills, hooks, prompts, and schemas;
- independent repository state;
- smaller repository footprint;
- project-specific overrides remain possible;
- normal Command Code use remains unaffected because DocGen hooks are conditional.

The global installation uses the Command Code user-level extension locations:

```text
~/.commandcode/agents/
~/.commandcode/skills/
~/.commandcode/commands/
~/.commandcode/settings.json
```

The engine itself is stored under:

```text
~/.commandcode/docgen/
```

On native Windows, `~` means the current user's home directory, typically:

```text
C:\Users\<username>
```

So the default engine path becomes:

```text
C:\Users\<username>\.commandcode\docgen
```

---

# Capabilities

The kit currently provides:

- **6 specialized custom agents**
- **28 reusable skills**
- **15 global slash commands**
- **conditional global hooks**
- **12 JSON artifact schemas**
- **12 bounded stage prompts**
- **a global cross-platform Node.js orchestrator**
- **per-repository state and configuration**
- **runtime compatibility diagnostics**
- **batched bounded generation with per-page validation and fallback**
- **independent factual audit**
- **audit-backed repair**
- **source fingerprinting**
- **incremental impact analysis and regeneration**
- **Markdown + Mermaid output**
- **optional project-level overrides**
- **optional self-contained project-local installation mode**

The core design goals are:

1. source code and explicit source evidence are authoritative;
2. discovery and writing are separate stages;
3. important conclusions preserve epistemic classification;
4. generation is bounded rather than one giant repository prompt;
5. state is explicit on disk;
6. audit is separated from writing;
7. the reusable engine is separate from repository-specific knowledge.

---

# Requirements

## Required

- Node.js 20 or newer recommended;
- Command Code CLI installed;
- Command Code authenticated before LLM-backed stages are executed.

Install Command Code:

```bash
npm i -g command-code@latest
```

Authenticate:

```bash
cmd login
```

On native Windows, Command Code may use `cmdc`:

```powershell
cmdc login
```

Verify:

```bash
cmd --version
```

or:

```powershell
cmdc --version
```

## Recommended

- Git repository;
- a clean working tree before the first large generation;
- review of generated documentation diffs before commit.

---

# Install globally

Extract the release ZIP first.

## Windows PowerShell

```powershell
Expand-Archive `
  .\commandcode-docgen-kit-0.7.0.zip `
  -DestinationPath .\commandcode-docgen-kit

cd .\commandcode-docgen-kit\commandcode-docgen-kit-0.7.0

.\install.ps1
```

## macOS / Linux

```bash
unzip commandcode-docgen-kit-0.7.0.zip
cd commandcode-docgen-kit-0.7.0
./install.sh
```

## Cross-platform Node.js

```bash
node install.mjs
```

The default target is:

```text
~/.commandcode/
```

The installer places reusable components at:

```text
~/.commandcode/
├── agents/
├── skills/
├── commands/
├── settings.json
└── docgen/
```

The installer attempts to expose the global `docgen` CLI through:

```bash
npm link
```

The package contains no runtime npm dependencies; the link is only used to make the `docgen` executable available on PATH.

To skip that step:

```bash
node install.mjs --no-link-cli
```

Then invoke the engine directly:

```bash
node ~/.commandcode/docgen/bin/docgen.mjs
```

On native Windows:

```powershell
node "$env:USERPROFILE\.commandcode\docgen\bin\docgen.mjs"
```

## Installer options

```text
--force
    overwrite conflicting DocGen-owned global files after backing them up

--dry-run
    print the installation plan without writing

--no-hooks
    install the engine without merging conditional DocGen hooks

--no-link-cli
    do not run npm link

--commandcode-home <path>
    use a non-default Command Code home; useful for testing

--project-local <repository>
    use the optional self-contained installation model instead of global-first
```

Examples:

```bash
node install.mjs --dry-run
node install.mjs --force
node install.mjs --no-link-cli
node install.mjs --commandcode-home /tmp/test-commandcode-home
```

## What global installation changes

The installer:

1. installs five user-level custom agents;
2. installs twenty-two user-level skills;
3. installs thirteen user-level `/docgen-*` commands;
4. installs the reusable engine under `~/.commandcode/docgen/`;
5. merges conditional DocGen hooks into the existing user `settings.json`;
6. preserves unrelated settings and hooks;
7. records the installation under `~/.commandcode/docgen/installation.json`;
8. optionally exposes the `docgen` executable through `npm link`.

The installer does **not** initialize any repository by default.

---

# Initialize a repository

After the global engine is installed, enter any repository:

```bash
cd /path/to/repository
```

Initialize it:

```bash
docgen init
```

Or explicitly:

```bash
docgen init /path/to/repository
```

Without the linked CLI:

```bash
node ~/.commandcode/docgen/bin/docgen.mjs init
```

The default init creates only repository-specific state:

```text
repository/
├── .docgen/
│   ├── project.json
│   ├── README.md
│   ├── config/
│   │   ├── documentation.json
│   │   ├── glossary.md
│   │   └── style-guide.md
│   ├── evidence/
│   ├── model/
│   │   ├── components/
│   │   ├── relationships/
│   │   ├── workflows/
│   │   └── unknowns/
│   ├── plan/
│   ├── audit/
│   │   └── pages/
│   ├── state/
│   └── runs/
└── docs/
```

Default init does **not** copy the global engine into the project and does **not** create `.commandcode/`.

That keeps the repository clean and makes the engine reusable.

Init is designed to be idempotent. Existing project configuration is preserved unless `--force` is explicitly used:

```bash
docgen init --force
```

Use `--force` carefully because it can replace project-template-owned files such as default configuration.

---

# Quick start

## One-time machine setup

```bash
npm i -g command-code@latest
cmd login

# Extract DocGen release, then:
node install.mjs
```

## Per repository

```bash
cd /path/to/repository

docgen init
docgen doctor
docgen all
```

The first full run executes:

```text
discover
   ↓
analyze technical architecture
   ↓
semantics: business + six flow types + catalogs
   ↓
plan category-rich multi-page knowledge base
   ↓
generate each planned page
   ↓
audit each generated page
   ↓
snapshot source fingerprints
```

For a large repository, prefer an explicit staged workflow:

```bash
docgen discover src/main/java
docgen analyze
docgen semantics
docgen plan
docgen generate --all
docgen audit --all
docgen snapshot
```

---

# Live progress, heartbeat, logs, and error visibility

DocGen v0.7.0 does not run Command Code as a silent blocking child process. Every LLM-backed stage is monitored as a live asynchronous process.

A run now looks like:

```text
Phase 1/7 — evidence discovery

==> discover: . | phase 1/7
    cmdc -p --trust --skip-onboarding --yolo --max-turns 30 --verbose
    logs: .docgen/runs/<run>.stdout.log | .docgen/runs/<run>.stderr.log

session: <command-code-session-id>

[docgen] discover:. RUNNING | elapsed 0m 10s | pid 18420 | changed artifacts 2
[docgen] discover:. RUNNING | elapsed 0m 20s | pid 18420 | changed artifacts 5
...
[docgen] discover:. COMPLETED | 2m 14s | exit 0 (success)
```

For page collections, DocGen also prints page-level progress:

```text
[========................]  33% generate 4/12 — quote-lifecycle
```

## What the heartbeat means

Command Code headless mode may remain quiet while the model is reasoning or executing tools. DocGen therefore prints a heartbeat even when Command Code has not emitted new stdout/stderr.

The heartbeat reports:

- current stage and target;
- elapsed time;
- child process PID;
- number of `.docgen/**` or `docs/**` artifacts changed since the run started;
- how long the Command Code process has been quiet.

A quiet heartbeat is **not** treated as failure. It means the process is still alive.

Default configuration:

```json
{
  "progress": {
    "heartbeatSeconds": 10,
    "noOutputWarningSeconds": 45,
    "showCommandOutput": true,
    "verboseCommandCode": true
  }
}
```

You can make the heartbeat more frequent:

```json
{
  "progress": {
    "heartbeatSeconds": 5
  }
}
```

## Per-run logs

Every LLM-backed run writes three files under `.docgen/runs/`:

```text
<run-id>.json
<run-id>.stdout.log
<run-id>.stderr.log
```

The metadata JSON records:

- stage;
- target;
- start and finish timestamps;
- elapsed duration;
- PID;
- exact Command Code arguments;
- exit code;
- signal when interrupted;
- normalized error classification;
- stdout/stderr log paths.

This means a failed run is diagnosable after the terminal session ends.

## API and runtime error classification

DocGen maps Command Code's documented headless exit codes into explicit categories:

| Exit | Classification | Meaning |
|---:|---|---|
| `0` | `success` | completed |
| `1` | `general-error` | generic Command Code failure |
| `3` | `not-authenticated` | login required |
| `4` | `permission-denied` | permission/hook denial |
| `5` | `rate-limited` | provider/API rate limit |
| `6` | `network-failure` | network/provider connectivity failure |
| `7` | `api-server-error` | provider/API 5xx |
| `8` | `max-turns` | configured headless turn limit reached |
| `130` | `interrupted` | SIGINT/SIGTERM |

On failure, DocGen prints the classification, a remediation hint, and the tail of stderr. Full stderr remains in `.docgen/runs/*.stderr.log`.

This is especially useful for distinguishing:

```text
model is still working
```

from:

```text
provider rate limited the request
```

or:

```text
network/API server failed
```

or:

```text
Command Code reached --max-turns
```

---

# Comprehensive quality profile

The default v0.7.0 profile is:

```json
{
  "quality": {
    "profile": "comprehensive"
  }
}
```

The goal is not merely to produce valid Markdown. The goal is to produce a curated developer-documentation set with the depth expected from a high-quality developer portal while remaining grounded in repository evidence.

No orchestration layer can guarantee frontier-model reasoning from a weak model. DocGen instead improves cheap-model reliability through decomposition, explicit contracts, deterministic quality gates, and multiple bounded passes.

## Comprehensive pipeline

```text
repository
   │
   ▼
discovery
   │
   ▼
normalized architecture/workflow model
   │
   ▼
coverage-driven documentation manifest
   │
   ▼
page generation
   │
   ▼
depth/completeness enrichment
   │
   ▼
independent audit
   │
   ▼
automatic repair when findings exist
   │
   ▼
re-audit repaired pages
   │
   ▼
local quality gate + audit severity gate
```

The important design choice is that a cheap model is **not** asked to understand an entire repository and produce perfect documentation in one response.

## Coverage-driven planning

The planner must consider whether evidence supports documentation for:

- overview and architecture at a glance;
- components/modules and ownership boundaries;
- domain concepts and terminology;
- important request/event/workflow/state lifecycles;
- API, messaging, persistence, configuration, security, and external integrations;
- local development and common engineering tasks;
- operations, observability, failure modes, recovery, and troubleshooting.

The planner must not invent a category with no evidence, but it also must not omit a material system surface simply because that surface is complex.

Each manifest page now declares:

```json
{
  "id": "quote-lifecycle",
  "path": "docs/concepts/quote-lifecycle.md",
  "title": "Quote Lifecycle",
  "type": "concept",
  "purpose": "Explain the lifecycle and invariants of a quote",
  "audience": ["engineer", "architect"],
  "evidence": ["..."],
  "models": ["..."],
  "requiredSections": [
    "Purpose and Scope",
    "Mental Model",
    "Lifecycle",
    "Invariants",
    "Failure Behavior"
  ],
  "diagramIntents": ["state lifecycle", "submission sequence"],
  "relatedPages": ["pricing", "order-conversion"],
  "qualityHints": ["explain optimistic locking if evidenced"]
}
```

The manifest is therefore a **content contract**, not merely a filename list.

## Automatic enrichment

With `quality.profile = "comprehensive"` and `quality.autoEnrich = true`, every generated page receives a second bounded writer pass.

The enrichment pass looks specifically for shallow areas and strengthens supported detail such as:

- mental models and scope boundaries;
- end-to-end flows;
- state transitions;
- invariants and assumptions;
- dependency and data-ownership implications;
- failure modes and recovery behavior;
- operational/troubleshooting guidance;
- practical examples and decision tables;
- planned Mermaid diagrams;
- navigation to related pages.

It preserves useful material rather than replacing the page with generic prose.

## Quality gates

Default local gates:

```json
{
  "quality": {
    "profile": "comprehensive",
    "autoEnrich": true,
    "autoFix": true,
    "reAuditAfterFix": true,
    "minWordsByType": {
      "overview": 900,
      "architecture": 1200,
      "concept": 900,
      "guide": 1000,
      "reference": 700,
      "operations": 1000
    },
    "minHeadings": 4,
    "requireDeclaredSections": true,
    "requirePlannedDiagrams": true,
    "maxCriticalFindings": 0,
    "maxHighFindings": 0
  }
}
```

Word counts are **minimum anti-shallowness signals**, not a target to pad prose. The writer is explicitly instructed not to add generic filler.

Run the gate directly:

```bash
docgen quality
```

Example:

```text
PASS overview                           1840 words | 8 headings | 2 mermaid
PASS quote-lifecycle                    2315 words | 11 headings | 3 mermaid
PASS configuration-reference           1460 words | 9 headings | 0 mermaid

Quality profile: comprehensive
Local gate failures: 0
Audit findings: {"critical":0,"high":0,"medium":2,"low":3}
Quality gate: PASS
```

The machine-readable summary is written to:

```text
.docgen/audit/quality-summary.json
```

## `docgen all` in comprehensive mode

The full pipeline now performs:

```text
Phase 1/6  discover
Phase 2/6  analyze
Phase 3/6  plan
Phase 4/6  generate + enrich each page
Phase 5/6  audit all pages
           fix pages with findings
           re-audit repaired pages
Phase 7/7  quality summary + source snapshot
```

For faster or cheaper operation, set another profile and disable automatic passes:

```json
{
  "quality": {
    "profile": "balanced",
    "autoEnrich": false,
    "autoFix": false,
    "reAuditAfterFix": false
  }
}
```

---

# How it works

DocGen separates responsibilities rather than asking one LLM run to understand and document everything at once.

```text
┌──────────────────────────┐
│      SOURCE REPOSITORY   │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│      DISCOVERY STAGE     │
│      doc-discoverer      │
└────────────┬─────────────┘
             │
             ▼
      .docgen/evidence/**
             │
             ▼
┌──────────────────────────┐
│      ANALYSIS STAGE      │
│      doc-architect       │
└────────────┬─────────────┘
             │
             ▼
        .docgen/model/**
             │
             ▼
┌──────────────────────────┐
│       PLANNING STAGE     │
│       doc-planner        │
└────────────┬─────────────┘
             │
             ▼
 .docgen/plan/manifest.json
             │
             ▼
      one page per run
             │
             ▼
┌──────────────────────────┐
│      GENERATION STAGE    │
│      doc-writer          │
└────────────┬─────────────┘
             │
             ▼
           docs/**
             │
             ▼
┌──────────────────────────┐
│        AUDIT STAGE       │
│        doc-auditor       │
└────────────┬─────────────┘
             │
             ▼
       .docgen/audit/**
```

The LLM is used as a bounded reasoning component inside this workflow.

The orchestrator controls:

- stage ordering;
- current repository root;
- global versus project asset resolution;
- Command Code headless arguments;
- `DOCGEN_MODE` activation;
- per-stage turn budgets;
- run metadata;
- validation;
- state updates;
- page-by-page generation;
- page-by-page audit.

---

# Execution flow

A typical full run is:

```text
User
 │
 │ docgen all
 ▼
Global DocGen Orchestrator
 │
 ├─ resolves initialized project root
 ├─ loads project config
 ├─ loads global prompts/schemas
 ├─ starts Command Code headless run
 │      DOCGEN_MODE=1
 │      DOCGEN_STAGE=discover
 │
 ▼
Command Code
 │
 ├─ global SessionStart hook injects DocGen context
 ├─ global write guard becomes active
 ├─ global shell guard becomes active
 └─ prompt delegates to global custom agent
        │
        ▼
    doc-discoverer
        │
        ├─ uses global core skills
        ├─ uses relevant technology skills
        └─ writes project-local evidence

... subsequent stages repeat with different bounded roles ...
```

All LLM-backed runs execute with the current repository as the working directory.

Global reusable assets remain outside the repository.

---

# State machine

Conceptually:

```text
UNINITIALIZED
      │
      │ docgen init
      ▼
INITIALIZED
      │
      │ discover
      ▼
DISCOVERED
      │
      │ analyze
      ▼
MODELLED
      │
      │ plan
      ▼
PLANNED
      │
      │ generate
      ▼
GENERATED
      │
      │ audit
      ▼
AUDITED
      │
      ├─────────────► VERIFIED
      │
      └─────────────► NEEDS_FIX ──► fix ──► audit
```

Current stage state is recorded under:

```text
.docgen/state/state.json
```

Every headless run also creates metadata under:

```text
.docgen/runs/
```

---

# Global versus project-local files

## Global reusable engine

```text
~/.commandcode/
├── agents/
│   ├── doc-discoverer.md
│   ├── doc-architect.md
│   ├── doc-planner.md
│   ├── doc-writer.md
│   └── doc-auditor.md
│
├── skills/
│   ├── doc-*/
│   ├── tech-*/
│   └── domain-*/
│
├── commands/
│   └── docgen-*.md
│
├── settings.json
│
└── docgen/
    ├── VERSION
    ├── package.json
    ├── installation.json
    ├── bin/
    │   └── docgen.mjs
    ├── hooks/
    ├── prompts/
    ├── schemas/
    └── project-template/
```

## Project-specific workspace

```text
<repo>/.docgen/
├── project.json
├── config/
├── evidence/
├── model/
├── plan/
├── audit/
├── state/
└── runs/
```

Published output:

```text
<repo>/docs/
```

## Optional project overrides

A project may intentionally add:

```text
<repo>/.commandcode/
├── agents/
├── skills/
└── commands/
```

or project-specific prompt/schema overrides:

```text
<repo>/.docgen/prompts/
<repo>/.docgen/schemas/
```

Those override or supplement global behavior without copying the complete engine.

---

# Agents

## `doc-discoverer`

Purpose:

```text
source → evidence
```

Responsibilities include identifying:

- repository structure;
- build system;
- modules;
- application entry points;
- HTTP endpoints;
- persistence access;
- database objects when visible in source;
- messaging producers and consumers;
- external integrations;
- configuration;
- scheduled/background jobs;
- security boundaries.

It should not produce polished user-facing documentation.

Primary output:

```text
.docgen/evidence/**
```

## `doc-architect`

Purpose:

```text
evidence → normalized system model
```

Responsibilities:

- components;
- responsibilities;
- relationships;
- dependencies;
- data ownership;
- workflows;
- state transitions;
- failure boundaries;
- unresolved behavior.

Primary output:

```text
.docgen/model/**
```

## `doc-domain-analyst`

Purpose:

```text
technical evidence + architecture → business semantics + flows + catalogs
```

Responsibilities:

- actors and business capabilities;
- domain concepts;
- business rules and validations;
- decisions and branch conditions;
- lifecycles and invariants;
- business, control, request, traffic, data and event flows;
- complete endpoint inventory;
- Kafka/RabbitMQ/queue/stream handler and producer inventory;
- external/internal/cloud service and dependency inventory;
- data stores and scheduled jobs.

Primary outputs:

```text
.docgen/model/business.json
.docgen/model/flows.json
.docgen/model/catalogs.json
```

## `doc-planner`

Purpose:

```text
system model → documentation information architecture
```

It decides:

- which pages should exist;
- page type;
- target audience;
- stable page IDs;
- page paths;
- evidence/model inputs;
- required sections;
- useful diagrams.

Primary output:

```text
.docgen/plan/manifest.json
```

## `doc-writer`

Purpose:

```text
one manifest entry + bounded evidence → one page
```

The writer is intentionally scoped to exactly one page per generation run.

Primary output:

```text
docs/**/*.md
```

It is also used by the repair stage, where its scope is constrained by audit findings.

## `doc-auditor`

Purpose:

```text
document claims → evidence verification
```

It checks for:

- unsupported claims;
- incorrect claims;
- inference presented as fact;
- stale or broken references;
- terminology inconsistencies;
- contradictions;
- missing caveats;
- misleading diagrams.

Primary output:

```text
.docgen/audit/**
```

---

# Skills

Skills encode repeatable procedures and technology/domain knowledge.

The intended relationship is:

```text
AGENT = who performs a role
SKILL = how a capability should be performed
ORCHESTRATOR = when and in what order work runs
```

## Core documentation skills

```text
doc-evidence-contract
doc-repository-discovery
doc-architecture-analysis
doc-workflow-analysis
doc-business-analysis
doc-flow-analysis
doc-data-model-analysis
doc-api-catalog
doc-messaging-catalog
doc-integration-catalog
doc-page-planning
doc-concept-writing
doc-guide-writing
doc-reference-writing
doc-mermaid
doc-claim-verification
```

## Technology skills

```text
tech-java
tech-maven
tech-jakarta-rest-jersey
tech-hk2
tech-mybatis
tech-jpa
tech-postgresql
tech-kafka
tech-rabbitmq
tech-camunda
tech-kubernetes
```

## Domain skill

```text
domain-cpq-order
```

Technology and domain skills are interpretation aids, not replacement sources of truth.

For example, a domain skill may recognize that several states resemble a quote lifecycle, but it must not claim an industry-standard lifecycle exists unless repository evidence supports that conclusion.

---

# Global slash commands

The global installer provides:

```text
/docgen-init
/docgen-doctor
/docgen-discover
/docgen-analyze
/docgen-semantics
/docgen-plan
/docgen-generate
/docgen-audit
/docgen-fix
/docgen-update
/docgen-status
```

These commands are wrappers around the global `docgen` orchestrator.

That is deliberate.

Interactive commands should not bypass:

- the workflow state machine;
- `DOCGEN_MODE`;
- conditional hooks;
- configured turn budgets;
- run metadata;
- validation;
- bounded generation.

Examples:

```text
/docgen-init
```

```text
/docgen-discover src/main/java
```

```text
/docgen-analyze
```

```text
/docgen-semantics
```

```text
/docgen-plan
```

```text
/docgen-preflight
```

```text
/docgen-resume
```

```text
/docgen-generate quote-lifecycle
```

```text
/docgen-audit quote-lifecycle
```

```text
/docgen-fix quote-lifecycle
```

```text
/docgen-update src/main/java/com/example/QuoteService.java
```

```text
/docgen-status
```

For deterministic automation and CI, use the `docgen` CLI directly.

---

# CLI command reference

## `docgen init [repository]`

Initialize project-local DocGen state.

```bash
docgen init
```

```bash
docgen init /path/to/repository
```

Optional:

```bash
docgen init --force
```

## `docgen doctor`

Check:

- project initialization;
- global engine structure;
- Command Code executable discovery;
- Command Code version invocation;
- required headless flags;
- global DocGen skill loading;
- authentication readiness.

```bash
docgen doctor
```

Machine-readable report:

```text
.docgen/state/compatibility.json
```

## `docgen doctor --global`

Check global engine installation without requiring an initialized repository.

```bash
docgen doctor --global
```

## `docgen version`

```bash
docgen version
```

## `docgen where`

Print:

- engine home;
- Command Code home;
- detected project root.

```bash
docgen where
```

## `docgen status`

Show stage state, generated page counts, and audit summary when available.

```bash
docgen status
```

## `docgen migrate`

Add newly introduced default configuration keys while preserving existing project-specific values. This is useful after upgrading the global engine.

```bash
docgen migrate
```

## `docgen validate`

Validate global/project structure and generated artifacts available in the current repository.

```bash
docgen validate
```

## `docgen discover [scope]`

Extract source-grounded evidence.

```bash
docgen discover
```

```bash
docgen discover src/main/java
```

```bash
docgen discover "quote and pricing modules"
```

Output:

```text
.docgen/evidence/**
```

## `docgen analyze [scope]`

Build or reconcile the normalized system model.

```bash
docgen analyze
```

```bash
docgen analyze "quote lifecycle"
```

Output:

```text
.docgen/model/system.json
```

## `docgen semantics`

Extract repository-specific business semantics, distinct flow models, and exhaustive interface/dependency catalogs.

```bash
docgen semantics
```

Outputs:

```text
.docgen/model/business.json
.docgen/model/flows.json
.docgen/model/catalogs.json
```

`business.json` contains actors, capabilities, concepts, business rules, decisions, branch conditions, lifecycles, invariants and use cases.

`flows.json` separates business, control, request, traffic, data and event flows.

`catalogs.json` inventories endpoints, message handlers/producers/consumers, external dependencies, data stores and scheduled jobs.

## `docgen plan`

Create or reconcile the documentation manifest.

```bash
docgen plan
```

Output:

```text
.docgen/plan/manifest.json
```

## `docgen preflight`

Normalize and validate the entire manifest before page generation:

```powershell
docgen preflight
```

This is the recommended command immediately after `docgen plan` when running stages manually.

## `docgen resume`

Continue a failed or interrupted full pipeline from existing checkpoints:

```powershell
docgen resume
```

It skips completed stages, valid pages, and current audits.

## `docgen generate <page-id>`

Generate exactly one page.

```bash
docgen generate quote-lifecycle
```

## `docgen generate --all`

Generate all pages using bounded batches. Every page is validated independently, and only missing/invalid pages fall back to individual generation.

```bash
docgen generate --all
```


## `docgen enrich <page-id>`

Run the explicit depth-and-completeness pass for one existing generated page.

```bash
docgen enrich quote-lifecycle
```

This is normally automatic only for pages that fail deterministic local quality gates under the `comprehensive` profile.

## `docgen enrich --all`

Run targeted enrichment across all manifest pages that currently fail local quality gates, using bounded batches.

```bash
docgen enrich --all
```

## `docgen quality`

Evaluate generated pages against local structural/depth gates and the configured audit severity thresholds.

```bash
docgen quality
```

The command also writes:

```text
.docgen/audit/quality-summary.json
```


## `docgen audit <page-id>`

Audit exactly one page.

```bash
docgen audit quote-lifecycle
```

## `docgen audit --all`

Audit all generated pages in bounded batches while preserving one independent report per page. Current reports are skipped when their `pageHash` matches.

```bash
docgen audit --all
```

## `docgen fix <page-id>`

Repair one page from its current audit findings.

```bash
docgen fix quote-lifecycle
```

Recommended sequence:

```bash
docgen audit quote-lifecycle
docgen fix quote-lifecycle
docgen audit quote-lifecycle
```

## `docgen snapshot`

Create source fingerprints for incremental update detection.

```bash
docgen snapshot
```

## `docgen changed`

List paths changed since the last snapshot.

```bash
docgen changed
```

## `docgen update [paths...]`

Perform impact analysis and bounded regeneration.

Automatic changed-path detection:

```bash
docgen update
```

Explicit paths:

```bash
docgen update src/main/java/com/acme/quote/QuoteService.java
```

## `docgen all [--fresh]`

The default is resumable. Use `--fresh` only to deliberately regenerate all stage/page outputs.


Run the complete initial pipeline:

```bash
docgen all
```

Equivalent conceptually to:

```text
discover → analyze → semantics → preflight → batched generation → targeted enrichment → batched audit → repair/re-audit → quality → snapshot
```

---

# Fail-fast preflight and canonical paths

`docgen preflight` validates the complete documentation plan before any page-generation LLM request is sent.

It performs these deterministic checks:

- canonicalizes every target to `docs/**/*.md`;
- adds a missing `docs/` prefix;
- adds a missing `.md` extension;
- rejects traversal and targets outside `docs/`;
- resolves evidence artifact IDs through `.docgen/evidence/index.json`;
- resolves normalized model names such as `system` to `.docgen/model/system.json`;
- verifies every evidence/model input exists;
- detects duplicate page ids and output paths;
- verifies navigation and related-page references;
- evaluates conditional coverage requirements.

The result is written to:

```text
.docgen/plan/preflight.json
```

A failed preflight stops immediately. It does not begin page 1 of 59 and discover a path/input mismatch hours later.

Example normalization:

```text
manifest input:  orientation/overview
canonical path: docs/orientation/overview.md
```

Run it explicitly after planning:

```powershell
docgen plan
docgen preflight
docgen generate --all
```

`docgen all` and `docgen resume` invoke the same preflight automatically.

# Contract firewall and transactional artifacts

Prompt instructions are soft constraints. v0.7.0 therefore does not trust an LLM to reproduce an exact JSON spelling or output-path notation.

## Single representation principle

LLM output may contain aliases during the uncommitted stage, but the committed artifact contains only canonical fields. Examples:

```text
UNCOMMITTED                COMMITTED
files[]                    artifacts[]
services[]                 components[]
rules[]                    businessRules[]
handlers/consumers         messageHandlers[]
outputPath                 path
issues[]                   findings[]
```

This prevents a downstream cheap model from choosing a stale alias over the authoritative value.

## Idempotence invariant

Every normalizer must satisfy:

```text
normalize(normalize(x)) == normalize(x)
```

Without this invariant, repeatedly validating a flow model could duplicate request/data/event flows. The built-in contract suite tests this behavior.

## Stage transaction

The following stages use snapshot/normalize/validate/commit semantics:

- `discover`;
- `analyze`;
- `semantics`;
- `plan` and coverage repair;
- `update-impact`.

Provider failure, malformed JSON and incompatible semantic shapes all follow the same rollback path.

## Quarantine

Rejected raw or partial output is retained for diagnosis:

```text
.docgen/quarantine/
└── <timestamp>-<stage>/
    ├── <captured-artifact>
    └── error.json
```

The previous valid artifact is restored before the command exits.

## Checkpoint validation and dependency invalidation

`docgen resume` performs real artifact validation, not only status inspection. If `system.json` is invalid, analysis reruns and forces semantics and planning to rerun. It does not continue with stale downstream models.

## Page input fingerprints

`.docgen/state/pages.json` records `generateInputHash` for each page. The hash covers the normalized page contract and every declared evidence/model file. A structurally valid Markdown file is not considered current when its inputs have changed.

For migration, a valid page without an old input hash is adopted once. This avoids repaying the generation cost merely to create the new checkpoint metadata.

## Audit input fingerprints

An audit report is current only when both are equal:

```text
report.pageHash  == current Markdown hash
report.inputHash == current page/evidence/model input hash
```

Thus a page whose text is unchanged but whose underlying architecture model changed is audited again.

## Contract commands

```powershell
docgen contract-test   # zero-token deterministic regression suite
docgen validate        # contract suite + static/generated artifact validation
docgen doctor          # runtime compatibility + contract suite
```

# Resumability, batching, and checkpoints

v0.7.0 is resumable by default.

```powershell
docgen resume
```

is equivalent to continuing the full pipeline while reusing valid checkpoints. `docgen all` uses the same behavior unless `--fresh` is supplied.

The orchestrator reuses:

- completed evidence discovery when `index.json` exists;
- completed technical analysis when `system.json` exists;
- completed semantics when `business.json`, `flows.json`, and `catalogs.json` exist;
- a completed plan when manifest preflight passes;
- generated Markdown pages that pass structural validation;
- audit reports whose `pageHash` matches the current page content.

Per-page state is stored in:

```text
.docgen/state/pages.json
```

A provider failure in generation batch 7 does not invalidate batches 1-6. Rerunning `docgen resume` skips their valid pages.

## Batched request strategy

Defaults:

```json
{
  "execution": {
    "generateBatchSize": 4,
    "enrichBatchSize": 4,
    "auditBatchSize": 6,
    "resumeByDefault": true,
    "skipValidPages": true
  }
}
```

For a 59-page plan, the base request count changes approximately from:

```text
v0.4.x worst-case baseline
59 generate + 59 enrich + 59 audit = 177 LLM runs
```

into:

```text
v0.7.0 default baseline
ceil(59 / 4) generation batches = 15
ceil(59 / 6) audit batches      = 10
enrichment                      = only pages failing local quality gates
```

A batch that produces only three of four pages does not restart all four. DocGen validates every target and retries only the missing/invalid page individually.

Use a clean rerun only when intentionally discarding checkpoints:

```powershell
docgen all --fresh
```

# Rate limits, retries, and provider failures

Command Code documents rate-limit failures as exit code `5`; connection failures use `6`, API 5xx failures use `7`, and max-turn exhaustion uses `8`. v0.7.0 handles `5`, `6`, and `7` as retryable by default. It also detects common provider text such as `429`, `rate limit exceeded`, `too many requests`, and `quota exceeded` when a provider reports a generic exit code.

Default policy:

```json
{
  "retry": {
    "enabled": true,
    "maxAttempts": 4,
    "retryableExitCodes": [5, 6, 7],
    "initialDelaySeconds": 15,
    "rateLimitDelaySeconds": 30,
    "maxDelaySeconds": 120,
    "multiplier": 2,
    "jitterRatio": 0.2,
    "countdownSeconds": 10,
    "interRequestDelaySeconds": 3
  }
}
```

During cooldown the terminal remains explicit:

```text
[docgen] retryable rate-limited on generate:overview; retry 2/4 after ~30s.
[docgen] retry cooldown (rate-limited): 30s remaining
[docgen] retry cooldown (rate-limited): 20s remaining
[docgen] retry cooldown (rate-limited): 10s remaining
```

Each attempt has separate metadata, stdout, and stderr logs under `.docgen/runs/`.

DocGen remains serial by default. This aligns with Command Code guidance to reduce concurrent sessions when rate limited. Batching reduces request count without introducing parallel provider pressure.

Max-turn exhaustion (`8`) is not blindly retried because a fresh retry may duplicate partial writes. Increase the stage turn budget or resume after inspecting the generated artifacts.

## Stage timeouts

A living child process is not allowed to run forever. Default timeouts are configurable:

```json
{
  "execution": {
    "stageTimeoutMinutes": {
      "default": 20,
      "discover": 35,
      "analyze": 35,
      "semantics": 35,
      "plan": 25,
      "generate": 20,
      "enrich": 15,
      "audit": 15,
      "fix": 15
    }
  }
}
```

A timeout terminates the child process, records exit classification `stage-timeout`, preserves completed files/checkpoints, and allows `docgen resume`.

# Evidence model

The evidence stage exists to prevent polished prose from becoming detached from source reality.

A useful evidence artifact records:

- stable fact identifier;
- fact kind;
- classification;
- source path;
- source symbol when available;
- source location when available;
- structured data;
- confidence or uncertainty.

Conceptual example:

```json
{
  "factId": "http.quote.create",
  "kind": "http_endpoint",
  "classification": "FACT",
  "source": {
    "path": "src/main/java/com/acme/quote/QuoteResource.java",
    "symbol": "QuoteResource#createQuote"
  },
  "data": {
    "method": "POST",
    "path": "/quotes"
  }
}
```

Published documentation should be synthesized from evidence and model artifacts, not from memory alone.

---

# FACT, INFERENCE, and UNKNOWN

DocGen uses three epistemic categories.

## FACT

Directly supported by source evidence.

Example:

```text
POST /quotes is declared by a Jakarta REST resource.
```

## INFERENCE

A reasonable architectural interpretation derived from multiple facts but not explicitly declared as a formal rule.

Example:

```text
The Quote component appears to own quote lifecycle coordination.
```

An inference should retain supporting evidence.

## UNKNOWN

Evidence is insufficient.

Example:

```text
It is unknown whether submitted quotes are immutable because no enforcement rule was found in the inspected scope.
```

The important invariant is:

```text
UNKNOWN must not be converted into a confident claim merely to make documentation sound complete.
```

---

# Documentation manifest and bounded generation

The planner writes:

```text
.docgen/plan/manifest.json
```

A manifest entry defines a page contract, conceptually:

```json
{
  "id": "quote-lifecycle",
  "path": "docs/concepts/quote-lifecycle.md",
  "type": "concept",
  "inputs": {
    "evidence": [
      ".docgen/evidence/quote/**"
    ],
    "models": [
      ".docgen/model/workflows/quote-lifecycle.json"
    ]
  }
}
```

Generation is page-bounded:

```text
manifest page A → Command Code run A → docs/page-a.md
manifest page B → Command Code run B → docs/page-b.md
manifest page C → Command Code run C → docs/page-c.md
```

This improves:

- context focus;
- failure isolation;
- reproducibility;
- auditability;
- incremental regeneration;
- review quality.

---

# Audit and repair

The writer is not assumed to be correct merely because it produced fluent documentation.

Audit is a separate stage:

```text
page
  │
  ▼
claims
  │
  ▼
evidence/model verification
  │
  ├─ supported
  ├─ unsupported
  ├─ contradicted
  ├─ overstated inference
  └─ unresolved
```

Per-page audit files are stored under:

```text
.docgen/audit/pages/
```

The repair flow is:

```text
audit
  ↓
findings
  ↓
fix exact page
  ↓
re-audit
```

Audit should not silently modify the page it is evaluating.

---

# Incremental regeneration

After a stable generation:

```bash
docgen snapshot
```

Later:

```bash
docgen changed
```

Then:

```bash
docgen update
```

Flow:

```text
source changes
      │
      ▼
fingerprint comparison
      │
      ▼
changed paths
      │
      ▼
impact analysis
      │
      ▼
.docgen/plan/update-plan.json
      │
      ├─ affected evidence scopes
      ├─ affected models
      └─ affected page IDs
               │
               ▼
      bounded rediscovery
               │
               ▼
         model reconciliation
               │
               ▼
          plan reconciliation
               │
               ▼
     regenerate affected pages
               │
               ▼
            re-audit
               │
               ▼
          new snapshot
```

Incremental update is intentionally impact-driven rather than regenerating every page after every source change.

---

# Configuration

Project configuration is stored at:

```text
.docgen/config/documentation.json
```

This is repository-specific.

Typical concerns include:

- project name;
- documentation audience;
- output root;
- preferred page categories;
- Command Code executable override;
- trust behavior;
- onboarding behavior;
- permission mode;
- max turns per stage;
- global/default model;
- per-stage models.

The repository also owns:

```text
.docgen/config/glossary.md
.docgen/config/style-guide.md
```

Use the glossary for project/domain terminology that should not be assumed globally.

Use the style guide for project-specific output conventions.

---

# Model and turn-budget configuration

The orchestrator invokes Command Code headlessly.

Default effective arguments are built from project config and typically include:

```text
-p
--trust
--skip-onboarding
--yolo
--max-turns <stage-specific-value>
```

A typical configuration is:

```json
{
  "commandCode": {
    "trust": true,
    "skipOnboarding": true,
    "yolo": true,
    "maxTurns": {
      "default": 20,
      "discover": 30,
      "analyze": 30,
      "plan": 20,
      "generate": 20,
      "audit": 20,
      "fix": 20,
      "update-impact": 20
    }
  }
}
```

## Global model for all stages

```json
{
  "commandCode": {
    "model": "provider/model-id"
  }
}
```

## Per-stage models

```json
{
  "commandCode": {
    "stageModels": {
      "discover": "provider/model-a",
      "analyze": "provider/model-b",
      "generate": "provider/model-c",
      "audit": "provider/model-d"
    }
  }
}
```

## Environment overrides

Executable:

```bash
DOCGEN_COMMAND_CODE_BIN=/custom/path/to/cmd docgen doctor
```

Model:

```bash
DOCGEN_MODEL=provider/model-id docgen generate quote-lifecycle
```

Turn budget:

```bash
DOCGEN_MAX_TURNS=50 docgen analyze
```

Environment overrides are useful for temporary execution changes without editing repository config.

---

# Safety model and hooks

DocGen installs hooks globally but they are intentionally inert during normal Command Code use.

The activation condition is:

```text
DOCGEN_MODE=1
```

Normal Command Code session:

```text
DOCGEN_MODE absent
      │
      ▼
DocGen hooks do nothing
```

Orchestrated DocGen stage:

```text
docgen command
      │
      ▼
orchestrator starts Command Code
      │
      ├─ DOCGEN_MODE=1
      ├─ DOCGEN_STAGE=<stage>
      └─ DOCGEN_TARGET=<target>
      │
      ▼
conditional global hooks activate
```

## Write guard

During DocGen mode, writes are allowed only under:

```text
docs/**
.docgen/**
```

Writes to application source or unrelated repository files are denied.

## Shell guard

During DocGen mode, shell use is conservative and inspection-oriented.

Examples of expected read-only usage include:

```text
rg
grep
find
fd
ls
dir
tree
cat
head
tail
git status
git log
git show
git diff
git rev-parse
git ls-files
java -version
mvn -version
node --version
```

Known mutating commands and shell chaining/redirection are blocked in DocGen mode.

## Artifact validation hook

After writes, basic validation checks include:

- JSON parse validity;
- non-empty Markdown;
- balanced Markdown code fences;
- H1 presence for published pages.

These checks are structural, not a replacement for semantic audit.

---

# Project overrides and precedence

The default installation is global, but Command Code supports project-level extensions.

This is useful when one repository needs special behavior.

## Skill override

Global:

```text
~/.commandcode/skills/tech-mybatis/
```

Project-specific override:

```text
<repo>/.commandcode/skills/tech-mybatis/
```

A project-level skill can encode repository-specific conventions such as:

- custom mapper locations;
- internal base mapper patterns;
- tenant interceptors;
- stored procedure conventions.

## Custom project skill

```text
<repo>/.commandcode/skills/domain-company-order/
└── SKILL.md
```

## Project agent override

```text
<repo>/.commandcode/agents/doc-architect.md
```

Use this only when the project genuinely needs a different role definition.

## Prompt override

Global default:

```text
~/.commandcode/docgen/prompts/generate.md
```

Project override:

```text
<repo>/.docgen/prompts/generate.md
```

The orchestrator resolves the project override first when it exists.

## Schema override

Global default:

```text
~/.commandcode/docgen/schemas/manifest.schema.json
```

Project override:

```text
<repo>/.docgen/schemas/manifest.schema.json
```

Schema overrides should be used carefully because they can change engine contracts.

## Configuration precedence

Conceptually:

```text
engine defaults
      │
      ▼
project .docgen/config
      │
      ▼
environment overrides
```

For Command Code user/project extension files, Command Code's own scope precedence applies.

---

# Large repositories and monorepos

Do not immediately run the broadest possible discovery on a very large repository.

Prefer bounded scopes:

```bash
docgen discover services/quote-service
docgen discover services/pricing-service
docgen discover libs/contracts
```

Then reconcile:

```bash
docgen analyze "quote and pricing domain"
docgen plan
```

For very large systems, use hierarchical documentation:

```text
repository/module evidence
        │
        ▼
service models
        │
        ▼
domain synthesis
        │
        ▼
system-level documentation
```

A useful repository hierarchy is:

```text
docs/
├── system/
├── domains/
├── services/
├── integrations/
├── concepts/
├── guides/
├── operations/
└── reference/
```

The planner should derive the useful information architecture from the actual system rather than mechanically generating one page per file or class.

---

# Git and team workflow

There are several valid choices for `.docgen/` artifacts.

## Option A: commit everything

Useful when evidence and model artifacts are part of an auditable engineering process.

```text
commit:
.docgen/config/**
.docgen/evidence/**
.docgen/model/**
.docgen/plan/**
.docgen/audit/**
docs/**
```

## Option B: commit config, manifest, audit, and docs

Treat evidence/model as rebuildable intermediate artifacts.

## Option C: commit only docs and project configuration

Best when intermediate artifacts are too noisy or large.

The reusable engine itself is global and is not copied into the repository by default.

For a team that needs exact engine reproducibility inside the repository, use the explicit self-contained project-local mode described later.

---


## Automatic additive migration from v0.3.x project config

When v0.7.0 runs inside a repository initialized by an older global-first release, it additively merges new defaults into `.docgen/config/documentation.json`. Existing custom scalar values and existing array entries are preserved; new page types, audiences, semantics turn-budget defaults, Mermaid-only quality settings, and knowledge-base settings are added. The project marker is updated to the current kit version.

You can run the migration explicitly:

```bash
docgen migrate
```

This avoids `docgen init --force`, which could overwrite project-owned configuration.

# Upgrade

## Migrating from v0.1.x project-local installs

Version 0.1.x installed the complete engine inside each repository. Version 0.6.0 defaults to a global engine.

Recommended migration:

```bash
# 1. Install v0.7.0 globally once
node install.mjs --force

# 2. Enter an existing v0.1.x repository
cd /path/to/repository

# 3. Add the v0.7.0 project marker/template without replacing existing config
docgen init

# 4. Verify the global runtime
docgen doctor
```

The old project-local `.commandcode/`, `.docgen/prompts/`, `.docgen/schemas/`, and `scripts/docgen.*` files are not automatically deleted because they may contain local modifications. After verification, remove or archive the old copied engine files deliberately if you want the repository to use only the global engine.

Be aware that project-level Command Code agents/skills/commands can override user-level global definitions. Therefore, leaving old v0.1.x `.commandcode/` copies in place may intentionally or unintentionally keep the old behavior for that repository.

### Clean global-first target after migration

Usually keep:

```text
.docgen/config/**
.docgen/evidence/**
.docgen/model/**
.docgen/plan/**
.docgen/audit/**
.docgen/state/**
.docgen/runs/**
docs/**
```

Usually remove only after review if they are unmodified v0.1.x engine copies:

```text
.commandcode/agents/doc-*
.commandcode/skills/doc-*
.commandcode/skills/tech-*
.commandcode/skills/domain-*
.commandcode/commands/docgen-*
.commandcode/hooks/docgen-*
.docgen/prompts/**
.docgen/schemas/**
scripts/docgen.*
```

Do not blindly delete project `.commandcode/` content that belongs to the repository rather than DocGen.

## Upgrade the global engine

Extract a newer release and run:

```bash
node install.mjs --force
```

This updates the global reusable components.

Conflicting global files are backed up under:

```text
~/.commandcode/docgen-backup/<timestamp>/
```

Then verify:

```bash
docgen doctor --global
```

For each important repository:

```bash
cd /path/to/repository
docgen init
```

Running `init` again adds missing project-template files without replacing existing project configuration by default.

Then:

```bash
docgen doctor
```

## Why upgrade is now simpler

Global-first:

```text
one global engine upgrade
        │
        ├─ repo A keeps its state
        ├─ repo B keeps its state
        └─ repo C keeps its state
```

The reusable engine changes once; repository evidence and documentation state remain independent.

---

# Uninstall

Remove the global engine and DocGen-owned global extension files:

```bash
node uninstall.mjs
```

Dry run:

```bash
node uninstall.mjs --dry-run
```

The uninstaller removes:

- DocGen global agents;
- DocGen global commands;
- installed DocGen skill directories;
- DocGen hook entries from global `settings.json`;
- `~/.commandcode/docgen/`.

It does **not** delete repository-local:

```text
.docgen/
docs/
```

That is intentional because those directories contain repository-specific state and generated artifacts.

The uninstaller also attempts `npm unlink -g commandcode-docgen-kit` unless `--no-unlink-cli` is supplied. It removes only files recorded by the DocGen installation record and does not delete unrelated user skills merely because they share a naming prefix.

---

# Self-contained project-local installation

Global-first is the default and recommended mode for one user working across many repositories.

A fully self-contained repository mode is still available:

```bash
node install.mjs --project-local /path/to/repository
```

PowerShell:

```powershell
.\install.ps1 -ProjectLocal "C:\path\to\repository"
```

This mode copies:

```text
AGENTS.md
.commandcode/
.docgen/
scripts/
docs/
```

into the target repository.

Use project-local mode when:

- the repository must carry its exact DocGen engine configuration;
- the whole team should get identical agents/skills/hooks from Git;
- a CI environment cannot rely on a preinstalled global engine;
- reproducibility is more important than repository footprint.

Use global-first mode when:

- one user runs DocGen across many repositories;
- you want centralized upgrades;
- you want project repositories to contain only state/config/output;
- you want global reusable technology/domain skills.

Do not mix both modes casually in the same repository because duplicate global and project-level names can create precedence differences.

---

# Troubleshooting

## Writer created the page but DocGen says `Missing generated page`

This was a v0.4.x manifest-path normalization defect. A manifest target such as `orientation/overview` was validated literally even though the writer correctly created `docs/orientation/overview.md`.

Upgrade and resume:

```powershell
.\install.ps1 -Force
cd C:\path\to\repository
docgen migrate
docgen preflight
docgen resume
```

Do not delete the generated page or rerun discovery. The canonical path is repaired in the manifest and the existing valid page is skipped.

## Provider rate limit or HTTP 429

v0.7.0 retries automatically with visible exponential backoff. Review the attempt logs in `.docgen/runs/`. Reduce other concurrent Command Code sessions and lower batch sizes only when the provider still rejects batched requests.

To make the policy more conservative:

```json
{
  "execution": {
    "generateBatchSize": 2,
    "auditBatchSize": 3
  },
  "retry": {
    "rateLimitDelaySeconds": 60,
    "maxAttempts": 5,
    "interRequestDelaySeconds": 5
  }
}
```



## `docgen all` appears to hang or stays quiet

v0.7.0 prints a heartbeat while every Command Code child process is alive. You should see output similar to:

```text
[docgen] discover:. RUNNING | elapsed 1m 20s | pid 18420 | changed artifacts 7
```

Check the live run metadata and logs:

```text
.docgen/runs/<run-id>.json
.docgen/runs/<run-id>.stdout.log
.docgen/runs/<run-id>.stderr.log
```

A process that remains alive but emits no Command Code output will trigger a warning after `progress.noOutputWarningSeconds`. This warning is informational; headless model/tool execution can legitimately be quiet.

To increase heartbeat frequency:

```json
{
  "progress": {
    "heartbeatSeconds": 5,
    "noOutputWarningSeconds": 30
  }
}
```

When the child exits, DocGen reports a normalized classification such as `rate-limited`, `network-failure`, `api-server-error`, or `max-turns`.


## `docgen: command not found`

The installer could not create or expose the npm link, or your global npm bin directory is not on PATH.

Use the direct engine:

```bash
node ~/.commandcode/docgen/bin/docgen.mjs version
```

Windows:

```powershell
node "$env:USERPROFILE\.commandcode\docgen\bin\docgen.mjs" version
```

Or reinstall without hiding npm output and check `npm link`:

```bash
node install.mjs --force
```

## Repository not initialized

Error conceptually:

```text
This repository is not initialized for DocGen.
```

Run:

```bash
docgen init
```

## Command Code executable not found

Verify:

```bash
cmd --version
```

Native Windows:

```powershell
cmdc --version
```

Or configure:

```json
{
  "commandCode": {
    "executable": "/custom/path/to/cmd"
  }
}
```

Temporary override:

```bash
DOCGEN_COMMAND_CODE_BIN=/custom/path/to/cmd docgen doctor
```

## Not authenticated

Run:

```bash
cmd login
```

or:

```powershell
cmdc login
```

Then:

```bash
docgen doctor
```

## Skill loading failure

Run:

```bash
cmd skills list --debug
```

DocGen doctor also checks that expected global DocGen skills are visible.

## Max-turn exhaustion

Increase the relevant stage budget:

```json
{
  "commandCode": {
    "maxTurns": {
      "analyze": 50
    }
  }
}
```

Or temporarily:

```bash
DOCGEN_MAX_TURNS=50 docgen analyze
```

## Hooks affect normal coding

DocGen hooks are designed to be inert unless:

```text
DOCGEN_MODE=1
```

If a custom modification accidentally removed that condition, restore the official hook files or reinstall the kit.

## A project needs a different technology convention

Create a project-level skill override under:

```text
.commandcode/skills/<same-skill-name>/SKILL.md
```

or create a new project-specific skill with a unique name.

## Generated docs contain unsupported claims

Run:

```bash
docgen audit --all
```

Then inspect:

```text
.docgen/audit/
```

Repair specific pages:

```bash
docgen fix <page-id>
docgen audit <page-id>
```

---

# Extending DocGen

## Add a global skill

Create:

```text
~/.commandcode/skills/my-docgen-skill/
└── SKILL.md
```

A skill should have required frontmatter:

```markdown
---
name: my-docgen-skill
description: Explain what this capability does and when it should be used.
---
```

Keep skills focused.

Good examples:

```text
tech-grpc
tech-opentelemetry
tech-liquibase
tech-flyway
tech-redis
domain-billing
```

## Add a project-only skill

Create:

```text
<repo>/.commandcode/skills/company-order-conventions/
└── SKILL.md
```

This is appropriate for internal conventions that should not apply to every repository.

## Add a global custom agent

Create:

```text
~/.commandcode/agents/<agent-name>.md
```

Use a new agent only when there is a genuinely separate role with a distinct context/tool boundary.

Avoid creating one agent per trivial task.

## Add a custom page type

Typical steps:

1. add or refine a writing skill;
2. update planner guidance;
3. optionally add a project-specific prompt override;
4. ensure the manifest can describe the required inputs;
5. keep generation page-bounded;
6. audit the new page type.

## Add a technology pack

A technology pack may contain one or more skills:

```text
tech-grpc
tech-protobuf
tech-openapi
tech-opentelemetry
```

The discovery and architecture agents can then use those skills when repository evidence indicates the technology is present.

## Add a domain pack

Domain packs should help interpretation without becoming a false source of truth.

For example:

```text
domain-product-catalog
domain-quote
domain-order
domain-pricing
domain-fulfillment
```

Domain knowledge may suggest questions and relationships to inspect. It must not invent system behavior.

---

# Included technology and domain coverage

The initial kit includes focused knowledge for:

## Java and build

```text
Java
Maven
```

## Jakarta/Jersey application structure

```text
Jakarta REST
Jersey
HK2
```

## Persistence and data

```text
MyBatis
JPA
PostgreSQL
```

## Messaging and workflow

```text
Kafka
RabbitMQ
Camunda 7/8 concepts
```

## Platform

```text
Kubernetes
```

## Domain

```text
CPQ / Quote / Order interpretation
```

The engine is not limited to these technologies. Missing technologies can be added as skills without changing the core workflow.

---

# Known limitations

## LLM correctness is not guaranteed

The evidence/audit architecture reduces risk but cannot guarantee perfect documentation.

Human review remains appropriate for:

- critical architecture claims;
- security behavior;
- regulatory or compliance assertions;
- business rules;
- operational runbooks;
- irreversible decisions.

## Static source inspection may not reveal runtime reality

Examples:

- dynamic configuration;
- reflection;
- runtime dependency injection;
- generated code;
- environment-specific routing;
- external infrastructure behavior;
- database-side logic not present in the repository.

Such gaps should remain UNKNOWN unless additional evidence is supplied.

## Incremental impact analysis is heuristic

A source change can have indirect impact that is not obvious from path-level fingerprinting.

For high-risk changes, run broader discovery/analyze/audit stages.

## Global upgrade can change future behavior

Because the engine is global, upgrading it affects subsequent runs across all repositories.

For a repository that requires an exact frozen engine version, use the self-contained project-local installation mode or version the release artifact externally.

---

# Compatibility notes

The v0.7.0 architecture intentionally aligns with Command Code user-level and project-level extension scopes:

```text
User-level reusable components:
~/.commandcode/agents/
~/.commandcode/skills/
~/.commandcode/commands/
~/.commandcode/settings.json

Project-level optional overrides:
.commandcode/agents/
.commandcode/skills/
.commandcode/commands/
.commandcode/settings.json
```

The engine uses Command Code headless mode for automated stages.

`docgen doctor` checks the currently installed Command Code executable rather than assuming a forever-stable CLI version.

The intended compatibility states are:

```text
GLOBAL ENGINE STRUCTURE
        │
        ├─ fail → DocGen installation problem
        │
        ▼
COMMAND CODE EXECUTABLE
        │
        ├─ fail → CLI installation/path problem
        │
        ▼
REQUIRED HEADLESS FLAGS
        │
        ├─ fail → CLI compatibility problem
        │
        ▼
GLOBAL DOCGEN SKILLS LOAD
        │
        ├─ fail → skill format/discovery problem
        │
        ▼
AUTHENTICATION
        │
        ├─ not ready → login required
        │
        ▼
PROJECT INITIALIZATION
        │
        ├─ missing → run docgen init
        │
        ▼
READY
```

For current runtime truth on your machine, run:

```bash
docgen doctor --global
```

then inside an initialized repository:

```bash
docgen doctor
```

---

# Recommended first adoption sequence

For a real repository, do not begin by generating everything and accepting it blindly.

Recommended:

```bash
# 1. install once
node install.mjs

# 2. initialize repository
cd /path/to/repository
docgen init

# 3. verify runtime
docgen doctor

# 4. tune repository-specific terminology
edit .docgen/config/glossary.md
edit .docgen/config/style-guide.md
edit .docgen/config/documentation.json

# 5. bounded discovery
docgen discover src/main/java

# 6. inspect evidence
review .docgen/evidence/

# 7. synthesize architecture
docgen analyze

# 8. inspect model
review .docgen/model/

# 9. create documentation plan
docgen plan

# 10. inspect manifest
review .docgen/plan/manifest.json

# 11. generate pages
docgen generate --all

# 12. audit
docgen audit --all

# 13. repair important findings
docgen fix <page-id>
docgen audit <page-id>

# 14. baseline incremental tracking
docgen snapshot
```

This workflow preserves the most important principle of the system:

> Documentation quality comes from evidence preservation, bounded synthesis, explicit contracts, and independent verification—not from one very large prompt.


# Deep system knowledge-base target

DocGen v0.7.0 does **not** treat the two benchmark home pages as the complete target. A Mintlify-style site is a hierarchy of categories, pages, and deep sections. DocGen therefore optimizes for **breadth × depth**:

```text
Repository
  │
  ├─ Orientation / Getting Started
  ├─ Business & Domain
  │   ├─ actors and capabilities
  │   ├─ concepts and glossary
  │   ├─ business rules and validations
  │   ├─ decisions and branch conditions
  │   └─ lifecycles and invariants
  ├─ Architecture
  │   ├─ system context
  │   ├─ components/modules
  │   ├─ dependencies
  │   └─ deployment/runtime
  ├─ Flows
  │   ├─ business flows
  │   ├─ control/execution flows
  │   ├─ request flows
  │   ├─ traffic flows
  │   ├─ data flows
  │   └─ event/message flows
  ├─ Interfaces & Integrations
  │   ├─ endpoint catalog
  │   ├─ endpoint deep dives
  │   ├─ message-handler catalog
  │   └─ external/cloud/internal dependencies
  ├─ Data & Persistence
  ├─ Security & Configuration
  ├─ Development Guides
  ├─ Operations & Observability
  └─ Troubleshooting / Reference
```

The planner creates only evidence-backed categories, but it is explicitly allowed to produce many focused pages. There is no fixed small page-count target. Complex repositories should produce substantially richer navigation than simple libraries.

## Business and logic extraction

The semantics stage writes `.docgen/model/business.json` containing actors, capabilities, concepts, business rules, decisions, branch conditions, lifecycles, invariants, use cases and unresolved unknowns. A source-level branch is promoted to a business rule only when it changes a domain outcome, eligibility, state, monetary result, permission, obligation or externally visible behavior.

## Six separate flow models

`.docgen/model/flows.json` keeps these views separate:

| Flow | Answers |
|---|---|
| Business flow | What business goal, decisions and outcomes occur? |
| Control flow | What code/components execute, branch, loop or retry? |
| Request flow | How does an inbound request travel from entry point to response? |
| Traffic flow | What network/protocol/trust-boundary hops occur? |
| Data flow | Where does data originate, transform, persist and propagate? |
| Event flow | How do producers, channels and consumers interact asynchronously? |

## Exhaustive catalogs

`.docgen/model/catalogs.json` contains:

- `endpoints`: all evidenced HTTP/RPC endpoints;
- `messageHandlers`: Kafka/RabbitMQ/queue/stream producers, consumers, listeners, processors, retry and DLQ handlers;
- `externalDependencies`: internal services, third-party APIs, cloud services, identity systems, storage, databases, brokers, caches and other integrations;
- `dataStores`;
- `scheduledJobs`.

When these arrays are non-empty, the manifest quality gate requires pages with matching coverage tags such as `endpoint-catalog`, `message-handler-catalog`, and `external-dependency-catalog`.

## Mermaid-only diagrams

Every generated diagram must be a fenced `mermaid` block. PlantUML, Graphviz/DOT and other diagram fences fail validation. Use focused Mermaid views rather than one unreadable mega-diagram.

## Evidence-index compatibility fix

The discovery contract requires:

```json
{
  "schemaVersion": "1.0",
  "generatedAt": "...",
  "artifacts": []
}
```

However, cheap models can still emit semantically equivalent shapes such as `files` or `entries`. v0.7.0 normalizes these variants after discovery. If no list exists, it scans `.docgen/evidence/**` and constructs canonical `artifacts[]` deterministically. The exact v0.3.0 failure:

```text
Error: .docgen/evidence/index.json missing required key: artifacts
```

is therefore handled by the orchestrator before validation.

