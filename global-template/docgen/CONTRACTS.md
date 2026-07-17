# DocGen 2 contracts

DocGen 2 is a language-, framework-, and architecture-neutral documentation pipeline. It treats provider output as untrusted. Deterministic code owns source eligibility, indexing, retrieval, budgets, checkpoints, artifact validation, low-risk rendering, quality gates, and publishing. Providers receive bounded context packs rather than unrestricted repository access.

## Boundary matrix

| Boundary | Canonical artifact | Owner |
|---|---|---|
| source eligibility | `.docgen/index/inventory.json` | deterministic inventory |
| searchable knowledge | `.docgen/index/semantic.db` | deterministic indexer |
| provider input | `.docgen/context/<stage>/*.json` | bounded context compiler |
| core synthesis | `.docgen/model/{system,business,flows,catalogs}.json` | bounded provider call + orchestrator validation |
| enterprise synthesis | `.docgen/model/{security,operations,testing,data-governance,decisions,configuration,change-impact,ownership}.json` | bounded provider call + orchestrator validation |
| page plan | `.docgen/plan/manifest.json` | bounded planner + deterministic canonicalization |
| generated pages | `docs/**/*.md` | deterministic renderer or bounded writer |
| page claims | `.docgen/traceability/pages/<page-id>.json` | page generation + deterministic normalization |
| runtime checkpoints | `.docgen/state/state.json` | orchestrator |
| structural and grounding audit | `.docgen/audit/deterministic.json` | deterministic auditor |
| selective semantic-risk audit | `.docgen/audit/llm-risk.json` | hash-cached bounded provider call |
| quality summary | `.docgen/audit/quality-summary.json` | deterministic aggregator |
| publishing | `.docgen/publish/*.json`, `docs/llms*.txt` | deterministic publisher |
| provider usage | `.docgen/telemetry/provider-runs.jsonl`, `.docgen/budget/report.json` | orchestrator |
| provider diagnostics | `.docgen/runs/*.stdout.log`, `.docgen/runs/*.stderr.log` | orchestrator |

## Hard invariants

1. **Technology neutrality** — no language, framework, protocol, datastore, messaging system, deployment model, or repository shape is assumed. Applications, libraries, CLIs, jobs, plugins, infrastructure, data pipelines, embedded systems, monoliths, services, and mixed workspaces are all valid inputs.
2. **Canonical source boundary** — Git-aware discovery or filesystem fallback, `.gitignore`, `.docgenignore`, binary signatures, UTF-8 checks, and size limits are applied before indexing.
3. **One index phase per full run** — `docgen all` indexes once, then all later phases consume that inventory and semantic database.
4. **Context-only provider** — provider work is bounded by declared context packs and explicit output contracts; prompts must not perform broad repository scans.
5. **Bounded context** — every pack has a token budget and records omitted facts and model items.
6. **Content addressing** — contexts, stages, pages, traces, audits, and publishing are reusable only while their source, model, input, and artifact hashes remain current.
7. **Crash-safe page checkpoints** — page state records running, completed, and failed work. A failed generation batch preserves valid pages and retries only missing or invalid pages.
8. **Fresh-artifact recovery** — a provider non-zero exit may be recovered only when the current invocation produced artifacts that pass the complete output contract. Pre-existing stale artifacts are never accepted as recovery proof.
9. **Effective provider configuration** — every call records and prints the executable, model, effective `maxTurns`, timeout, context size, and log files. The supported minimum conversation-turn budget is 30.
10. **Hard provider budget** — a call is refused before execution when configured call, token, or per-call limits would be exceeded.
11. **Typed semantic claims** — model items and page claims use `FACT`, `INFERENCE`, `ASSUMPTION`, or `UNKNOWN`, with confidence, evidence, and stable qualified identity.
12. **Grounded facts** — a `FACT` requires repository-relative evidence inside the canonical inventory. By default it also requires valid line evidence whose source hash still matches the index.
13. **Context-bound generation** — generated claim evidence and model references must come from the page's supplied context unless explicitly disabled.
14. **Qualified model identity** — references use `<model>:<semantic-id>` to prevent collisions and permit deterministic validation.
15. **Deterministic references where possible** — generic components, interfaces, dependencies, data assets, automation, configuration, ownership, and change-impact catalogs can be rendered without provider calls.
16. **Quality before publishing** — publishing requires a current passing audit and revalidates source, model, page, trace, links, evidence, and audit hashes to reject stale output.
17. **Selective semantic-risk audit** — provider audit is limited to risk-scored pages after deterministic validation and is reused only while its inputs remain unchanged.
18. **No hidden repair loop** — there is no unbounded enrich/fix/re-audit cycle. Recovery is bounded and checkpointed.
19. **Mermaid only** — generated diagrams may not depend on PlantUML, Graphviz, or image-only formats.
20. **Breaking migration boundary** — legacy workflow artifacts are archived rather than interpreted as current checkpoints.

## Framework-neutral semantic surfaces

The shape is extensible. Technology-specific arrays are optional signals, not requirements.

- `system.json`: components, modules, packages, runtimes, deployment units, relationships, workflows, and unknowns.
- `business.json`: actors, capabilities, concepts, rules, decisions, branches, lifecycles, invariants, use cases, and unknowns.
- `flows.json`: execution, control, request, traffic, data, event, batch, and other evidenced flows.
- `catalogs.json`: interfaces, contracts, dependencies, data assets, automations, build artifacts, configuration surfaces, plus optional protocol-specific catalogs when present.
- enterprise models: security, operations, testing, data governance, decisions, configuration, change impact, and ownership.

The deterministic index always provides generic file artifacts and source chunks. It may additionally recognize common symbols, functions, imports/modules, manifests, configuration keys, runtime declarations, infrastructure resources, interfaces, data entities, scheduled automation, or security boundaries. Absence of a recognizer never makes a technology unsupported because bounded source chunks remain the fallback evidence surface.

## Runtime and resume contract

A full run is:

```text
index -> modelCore -> modelEnterprise -> plan -> generate -> audit -> publish
```

`docgen resume` runs the same state-aware pipeline. Completed stages and pages are reused only when their input hashes and required outputs remain valid. During generation:

1. each page is marked `running` with batch, context, and input identity;
2. provider output is validated page-by-page;
3. valid pages are checkpointed immediately;
4. failed or missing pages are marked with their error;
5. bounded recovery retries only the unresolved subset;
6. a page becomes `completed` only after Markdown and traceability validation succeeds.

## Model bundle recovery contract

Model synthesis treats provider output as an untrusted transport shape. The orchestrator:

1. extracts requested models from exact keys, normalized key variants, nested wrappers, descriptor arrays, JSON-string payloads, and direct singleton repair objects;
2. salvages every recognized object from a partial bundle without writing partial model state;
3. performs at most one batch repair for unresolved names, then at most one independent request per unresolved model;
4. commits the reconciled model set only after every requested name is resolved;
5. defaults unresolved names to an explicit `UNKNOWN` placeholder with no evidence and records them in `state.stages.<stage>.degradedModels`;
6. supports `execution.missingModelPolicy = "fail"` for environments that prefer a hard gate after bounded recovery.

A completed degraded stage is reusable on `docgen resume`, preventing an unbounded provider retry loop. `docgen status` exposes degraded model names in `summary.degradedModels`.

## Correctness gate

The deterministic audit validates, at minimum:

- source inventory membership, live-source hash, and evidence line ranges;
- model JSON validity, qualified identities, classifications, confidence, and FACT evidence;
- page frontmatter, H1, required sections, Mermaid policy, and local links;
- page/trace identity, page hash, input hash, and generation context identity;
- claim classification, confidence, evidence, context-bound grounding, and model references;
- missing, duplicate, conflicting, stale, orphaned, or substantially duplicated artifacts;
- model-reference coverage and configurable warning/failure policy.

The detailed report is `.docgen/audit/deterministic.json`. `.docgen/audit/quality-summary.json` is the publish gate and contains aggregate claim, evidence, model-reference, failure, warning, and selective-risk metrics.

## Page traceability

Each page sidecar contains:

```json
{
  "schemaVersion": "2.0",
  "pageId": "component-lifecycle",
  "pagePath": "docs/architecture/component-lifecycle.md",
  "pageHash": "...",
  "inputHash": "...",
  "contextId": "...",
  "claims": [
    {
      "id": "component-lifecycle:transition",
      "statement": "The component transitions from pending to active.",
      "classification": "FACT",
      "confidence": 1,
      "evidence": [{"path": "src/component.ext", "startLine": 120, "endLine": 146}],
      "sourceModelRefs": ["business:transition-pending-active"]
    }
  ]
}
```

The orchestrator normalizes and verifies page, input, and context hashes after generation.

## Workspace boundary

Cross-repository synthesis remains deterministic and requires explicit repository identity plus evidenced relationships, declared dependencies, shared producer/consumer contracts, or qualified model references. Ambiguous relationships remain unresolved instead of being inferred from a preferred stack.
