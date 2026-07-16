You are running the DocGen documentation planning stage.

Delegate to the `doc-planner` custom agent. Read:

- `.docgen/evidence/index.json` and relevant evidence artifacts;
- `.docgen/model/system.json`;
- `.docgen/model/business.json` when present;
- `.docgen/model/flows.json` when present;
- `.docgen/model/catalogs.json` when present;
- `.docgen/model/security.json`, `operations.json`, `testing.json`, `data-governance.json`, `decisions.json`, `configuration.json`, `change-impact.json`, and `ownership.json` when present;
- documentation config, style guide and glossary;
- the existing manifest when present.

Produce or reconcile `.docgen/plan/manifest.json` conforming to the manifest schema.

The target is a deep multi-page system knowledge base with the breadth and navigation density of a curated Mintlify-style documentation site. Do not optimize for a small page count. Split major concepts into focused pages when that improves discoverability or depth. Do not create one giant catch-all page.

Build a navigation taxonomy with categories and pages appropriate to the repository. Cover every evidence-backed surface that matters, including when present:

- orientation, quickstart, repository map and architecture at a glance;
- business/domain overview, actors, capabilities, glossary and conceptual model;
- business logic, rules, validations, decisions and branch conditions;
- lifecycle/state-machine documentation;
- business flows and use cases;
- control/execution flows;
- inbound request flows;
- traffic/network/trust-boundary flows;
- data models, ownership, transformations, persistence and data flows;
- event/message flows;
- complete endpoint catalog and deeper API behavior pages;
- complete Kafka/RabbitMQ/queue/stream handler catalog;
- external services, cloud services, internal service dependencies and integrations;
- module/component deep dives;
- security overview, trust boundaries, authentication, authorization/permissions, secrets, sensitive-data protection, threats and controls;
- data governance: ownership, source of truth, classification, retention, transactions, consistency, concurrency, idempotency, reconciliation, lineage, migrations and auditability;
- operations: health/readiness, logs/metrics/traces, SLI/SLO when evidenced, alerts, capacity, scaling, failure modes, recovery, backup/restore, deployment/rollback and runbooks;
- testing strategy, suites, fixtures/data, environments, commands, contract tests, failure injection, gates and coverage gaps;
- configuration overview, environment matrix, flags, secrets, validation, reload/restart behavior, tuning and deprecation;
- architecture decisions, alternatives, trade-offs, constraints, consequences and supersession;
- ownership/RACI/approval/escalation and change-impact/blast-radius/compatibility/extension-point documentation;
- persistence, configuration, security and observability;
- local development and common engineering tasks;
- deployment/runtime architecture;
- operations, failure modes, recovery and troubleshooting;
- reference pages where exhaustive lists are useful.

Every page must define category, purpose, summary, audience, evidence/models, required sections, Mermaid diagram intents, coverageTags, related pages, document mode, search keywords, aliases where relevant, lifecycle/version/deprecation metadata, evidence-derived example intents, and optional required tables/quality hints.

Required coverage tags are conditional on evidence. Examples:
`system-overview`, `architecture`, `security-trust-boundaries`, `authorization-model`, `data-governance`, `consistency-transactions`, `operations-observability`, `failure-recovery`, `testing-strategy`, `configuration-matrix`, `architecture-decisions`, `change-impact`, `ownership-responsibilities`, `business-domain`, `business-rules`, `branch-conditions`, `state-lifecycle`, `business-flow`, `control-flow`, `request-flow`, `traffic-flow`, `data-model`, `data-flow`, `event-flow`, `endpoint-catalog`, `message-handler-catalog`, `external-dependency-catalog`, `persistence`, `security`, `configuration`, `operations`, `troubleshooting`.

{{MISSING_COVERAGE}}

Avoid duplicate ownership of the same concept. Preserve stable page ids/paths where reasonable. All planned diagrams must be Mermaid.


Hard manifest rules:
- every page path must be canonical: `docs/<category>/<slug>.md`;
- `evidence[]` and `models[]` must contain exact existing repository-relative paths or exact evidence artifact IDs from `.docgen/evidence/index.json`;
- never invent shorthand filenames such as `system.json` when the actual path is `.docgen/model/system.json`;
- before finishing, verify all page ids, paths, navigation references, evidence references and model references.


P2 documentation experience rules:
- choose exactly one primary mode: tutorial, how-to, explanation, reference, runbook, decision-record, migration-guide, or troubleshooting;
- plan user journeys from orientation to task completion to deep reference;
- create migration/deprecation pages when evidence exists;
- use stable aliases for renamed/moved pages;
- declare exampleIntents only when examples can be grounded in evidence/tests/contracts;
- include searchKeywords and clear relatedPages/backlinks.
