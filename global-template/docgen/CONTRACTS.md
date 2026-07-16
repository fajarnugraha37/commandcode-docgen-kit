# DocGen 2 contracts

DocGen 2 treats provider output as untrusted and prevents providers from becoming repository scanners. Deterministic code owns source access, indexing, retrieval, validation, budgets, rendering of low-risk references, and most auditing.

## Boundary matrix

| Boundary | Canonical artifact | Owner |
|---|---|---|
| source eligibility | `.docgen/index/inventory.json` | deterministic inventory |
| searchable knowledge | `.docgen/index/semantic.db` | deterministic indexer |
| provider input | `.docgen/context/<stage>/*.json` | bounded context compiler |
| core synthesis | `.docgen/model/{system,business,flows,catalogs}.json` | one bounded provider call + orchestrator validation |
| enterprise synthesis | `.docgen/model/{security,operations,testing,data-governance,decisions,configuration,change-impact,ownership}.json` | one bounded provider call + orchestrator validation |
| page plan | `.docgen/plan/manifest.json` | bounded planner + deterministic canonicalization |
| reference pages | selected `docs/**/*.md` | deterministic renderer |
| narrative pages | selected `docs/**/*.md` | bounded writer |
| page claims | `.docgen/traceability/pages/<page-id>.json` | same generation call or deterministic item mapping |
| structural/grounding audit | `.docgen/audit/deterministic.json` | deterministic auditor |
| semantic risk audit | `.docgen/audit/llm-risk.json` | selective, hash-cached provider call |
| quality summary | `.docgen/audit/quality-summary.json` | deterministic aggregator |
| publishing | `.docgen/publish/*.json`, `docs/llms*.txt` | deterministic publisher |
| provider usage | `.docgen/telemetry/provider-runs.jsonl`, `.docgen/budget/report.json` | orchestrator |

## Hard invariants

1. **Source is indexed once** — provider sessions do not broadly scan repository source.
2. **Canonical inventory** — `.gitignore`, nested non-Git fallback, `.docgenignore`, binary signatures, UTF-8 checks, and size limits are applied before indexing.
3. **Context-only provider** — hooks restrict provider reads to declared `.docgen/context/**` packs and stage outputs.
4. **Bounded context** — each pack has an explicit token budget and reports omitted facts/model items.
5. **Content addressing** — contexts, stages, pages, and risk audits are reusable only while selected item hashes remain unchanged.
6. **Hard provider budget** — a call is refused before execution when it would exceed configured call, input-token, output-token, or per-call limits.
7. **Typed models** — semantic items preserve stable identity, kind, classification, confidence, evidence, and unknowns.
8. **Direct evidence for FACT** — deterministic audit rejects FACT page claims without evidence or with evidence outside the canonical inventory.
9. **Qualified model identity** — SQLite item IDs are model-qualified to prevent cross-model collisions.
10. **Deterministic references** — exhaustive low-risk catalogs are rendered without provider calls.
11. **Selective audit** — LLM audit runs only for risk-scored pages and only when page/context hashes change.
12. **No repair loop** — there is no automatic enrich, fix, or full re-audit cycle.
13. **No parent delegation** — provider prompts complete their bounded task directly and do not load agent/skill trees.
14. **Mermaid only** — published diagrams may not use PlantUML, Graphviz, or image-only diagrams.
15. **Breaking migration** — v1 workflow artifacts are archived, not interpreted as v2 checkpoints.

## Core model surfaces

- `system.json`: components, relationships, workflows, unknowns;
- `business.json`: actors, capabilities, concepts, rules, decisions, branches, lifecycles, invariants, use cases, unknowns;
- `flows.json`: business, control, request, traffic, data, and event flows;
- `catalogs.json`: endpoints, message handlers, dependencies, data stores, scheduled jobs.

## Enterprise model surfaces

- `security.json`
- `operations.json`
- `testing.json`
- `data-governance.json`
- `decisions.json`
- `configuration.json`
- `change-impact.json`
- `ownership.json`

## Page traceability

Each page sidecar contains:

```json
{
  "schemaVersion": "2.0",
  "pageId": "quote-lifecycle",
  "pagePath": "docs/business/quote-lifecycle.md",
  "pageHash": "...",
  "inputHash": "...",
  "contextId": "...",
  "claims": [
    {
      "id": "quote-lifecycle:draft-submit",
      "statement": "A draft quote can be submitted.",
      "classification": "FACT",
      "confidence": 1,
      "evidence": [{"path": "src/QuoteService.java", "startLine": 120, "endLine": 146}],
      "sourceModelRefs": ["business:rule-submit-draft"]
    }
  ]
}
```

The orchestrator fills page/input/context hashes after generation.

## Workspace contracts

P3 remains deterministic and consumes current repository models plus commit/source/model hashes. Cross-repository edges require explicit repository identity, dependency targets, shared evidenced producer/consumer channels, or model references. Ambiguous relationships remain unresolved.
