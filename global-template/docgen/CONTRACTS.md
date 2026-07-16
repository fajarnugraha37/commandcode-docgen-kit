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
| plan | `.docgen/plan/manifest.json` | `navigation`, `pages`, canonical `docs/**/*.md` paths |
| generate/enrich/fix | `docs/**/*.md` | exact manifest target, valid Markdown, Mermaid-only diagrams |
| audit | `.docgen/audit/pages/<page-id>.json` | `pageId`, `pagePath`, `pageHash`, `inputHash`, `findings` |
| update-impact | `.docgen/plan/update-plan.json` | `changedPaths`, `affectedEvidenceScopes`, `affectedModels`, `affectedPageIds`, `rationale` |

## Invariants

1. **Single canonical representation** — aliases are removed from committed artifacts.
2. **Idempotence** — normalizing canonical output again cannot change or duplicate it.
3. **Losslessness for known split aliases** — producers, consumers and listeners are merged into the complete message-handler catalog.
4. **Path safety** — evidence remains under `.docgen/evidence/**`; published pages remain under `docs/**/*.md`.
5. **Identity consistency** — audit page ID/path/hash must match the current manifest/page.
6. **Input consistency** — generated pages and audits are fingerprinted against their declared evidence/model inputs.
7. **Transactional stages** — partial output is quarantined and the previous valid artifact restored.
8. **Dependency invalidation** — rerunning an upstream stage invalidates dependent stage skips.

Run the zero-token suite with:

```bash
docgen contract-test
```

The machine-readable report is written to `.docgen/state/contract-report.json`.
