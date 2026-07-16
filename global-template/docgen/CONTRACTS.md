# DocGen Contract Firewall

DocGen treats every LLM-produced artifact as untrusted, uncommitted output until it has passed canonicalization and invariant validation.

## Boundary matrix

| Stage | Canonical artifact | Canonical arrays/fields |
|---|---|---|
| discover | `.docgen/evidence/index.json` | `artifacts` |
| analyze | `.docgen/model/system.json` | `components`, `relationships`, `workflows`, `unknowns` |
| semantics/business | `.docgen/model/business.json` | `actors`, `capabilities`, `concepts`, `businessRules`, `decisions`, `branchConditions`, `lifecycles`, `invariants`, `useCases`, `unknowns` |
| semantics/flows | `.docgen/model/flows.json` | `businessFlows`, `controlFlows`, `requestFlows`, `trafficFlows`, `dataFlows`, `eventFlows` |
| semantics/catalogs | `.docgen/model/catalogs.json` | `endpoints`, `messageHandlers`, `externalDependencies`, `dataStores`, `scheduledJobs` |
| enterprise/security | `.docgen/model/security.json` | `trustBoundaries`, `principals`, `authenticationFlows`, `authorizationRules`, `permissions`, `serviceIdentities`, `secrets`, `sensitiveData`, `threats`, `controls`, `unknowns` |
| enterprise/operations | `.docgen/model/operations.json` | runtime, health, observability, SLI/SLO, alerts, capacity, scaling, failures, recovery, backup, deployment, runbooks |
| enterprise/testing | `.docgen/model/testing.json` | suites, test types, fixtures, test data, environments, commands, gaps, contract tests, failure injection, quality gates |
| enterprise/data governance | `.docgen/model/data-governance.json` | entities, ownership, sources of truth, classification, retention, transactions, consistency, concurrency, idempotency, reconciliation, lineage, migration, auditability |
| enterprise/decisions | `.docgen/model/decisions.json` | recorded/inferred decisions, alternatives, trade-offs, constraints, consequences, superseded decisions |
| enterprise/configuration | `.docgen/model/configuration.json` | settings, environments, flags, secrets, tuning, validation, reload behavior, deprecations |
| enterprise/change impact | `.docgen/model/change-impact.json` | change surfaces, impact edges, compatibility, extension points, risks, tests, operations and contracts |
| enterprise/ownership | `.docgen/model/ownership.json` | teams, responsibilities, RACI, component/data/operational ownership, approvals and escalation |
| plan | `.docgen/plan/manifest.json` | `navigation`, `pages`, canonical `docs/**/*.md` paths |
| generate/enrich/fix | `docs/**/*.md` | exact manifest target, valid Markdown, Mermaid-only diagrams |
| page traceability | `.docgen/traceability/pages/<page-id>.json` | typed claims, evidence refs, model/catalog/branch coverage, source snapshot |
| cross-page consistency | `.docgen/traceability/{index,contradictions,duplicates,freshness}.json` | unique claim IDs, contradiction groups, duplicate groups, freshness |
| audit | `.docgen/audit/pages/<page-id>.json` | `pageId`, `pagePath`, `pageHash`, `inputHash`, `findings` |
| update-impact | `.docgen/plan/update-plan.json` | `changedPaths`, `affectedEvidenceScopes`, `affectedModels`, `affectedPageIds`, `rationale` |
| publishing | `.docgen/publish/*.json`, `docs/llms*.txt`, page frontmatter | mode, aliases, lifecycle/version metadata, search/navigation/backlink/redirect/example indexes |

## Invariants

1. **Single canonical representation** — aliases are removed from committed artifacts.
2. **Idempotence** — normalizing canonical output again cannot change or duplicate it.
3. **Losslessness for known split aliases** — producers, consumers and listeners are merged into the complete message-handler catalog.
4. **Path safety** — evidence remains under `.docgen/evidence/**`; published pages remain under `docs/**/*.md`.
5. **Identity consistency** — audit page ID/path/hash must match the current manifest/page.
6. **Input consistency** — generated pages and audits are fingerprinted against their declared evidence/model inputs.
7. **Transactional stages** — partial output is quarantined and the previous valid artifact restored.
8. **Dependency invalidation** — rerunning an upstream stage invalidates dependent stage skips.
9. **Typed semantic items** — each model item has stable ID, kind, epistemic classification, confidence, evidence, and source references.
10. **Direct evidence for FACT** — FACT items and claims cannot commit without resolvable repository evidence.
11. **Claim-level traceability** — material page claims map to source and normalized semantic/catalog items.
12. **Cross-page consistency** — claim ID collisions and subject/predicate contradictions fail quality gates.
13. **Freshness** — page, input, Git/source fingerprint changes make traceability stale.
14. **Evidence-centric quality** — grounding and coverage are hard gates; word count is advisory.
15. **Ignore-aware source boundary** — `.gitignore`, `.docgenignore`, hard exclusions, and project `config.exclude` produce one canonical source inventory used by every stage.
16. **Ignored evidence rejection** — an ignored path cannot support a typed FACT or page claim.
17. **Enterprise-depth coverage** — security, operations, testing, data governance, decisions, configuration, change impact, and ownership use typed, evidence-backed item contracts.
18. **Binary/non-text budget boundary** — binary extensions, magic signatures, NUL bytes, invalid UTF-8, excessive control characters, and oversized text are excluded before reads, fingerprints, change detection, or evidence validation.
19. **Mode-aware documentation** — every planned page has a canonical document mode and mode-specific structural contract.
20. **Deterministic publishing** — frontmatter, navigation, search, backlinks, redirects, orphan reports, examples indexes, and `llms*.txt` are produced without a provider call.
21. **Evidence-derived examples** — publishable examples must map to page claims and source/model references; generic unsupported examples do not satisfy the quality contract.

Run the zero-token suite with:

```bash
docgen contract-test
```

The machine-readable report is written to `.docgen/state/contract-report.json`.

## Trustworthiness reports

Run `docgen traceability` to rebuild deterministic claim, contradiction, duplicate, and freshness reports. Run `docgen quality` to apply semantic thresholds. Neither command requires an LLM call.
