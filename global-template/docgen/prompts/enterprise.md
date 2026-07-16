You are running the DocGen P1 enterprise-depth analysis pass: `{{ENTERPRISE_PASS}}`.

Delegate to the `doc-enterprise-analyst` custom agent.

Mandatory source boundary:
- Read `.docgen/state/source-files.txt` before any source inspection.
- Do not read or cite paths excluded by `.gitignore`, `.docgenignore`, or DocGen config.
- Use `.docgen/evidence/**` and `.docgen/model/*.json` as primary inputs.

Produce exactly the output files listed below and no published Markdown:

{{OUTPUT_PATHS_JSON}}

Pass contracts:

## governance
Produce `security.json` and `ownership.json` covering trust boundaries, principals, authentication, authorization, permissions, service identities, secrets, sensitive data, threats, controls, team/component/data/operations ownership, RACI, approval authority, and escalation paths.

## operability
Produce `operations.json` and `testing.json` covering runtime components, health/readiness/liveness, logs/metrics/traces, SLI/SLO, alerts, capacity limits, scaling, failure modes, recovery, backup/restore, deployment/rollback, runbooks, test suites/types, fixtures/data, test environments/commands, contract tests, failure injection, quality gates, and coverage gaps.

## data-and-configuration
Produce `data-governance.json` and `configuration.json` covering data entities, source of truth, ownership, classification, retention/deletion, transaction boundaries, consistency, concurrency/locking, idempotency, reconciliation, lineage, migrations, auditability, settings, environment matrix, flags, secrets, validation, reload/restart behavior, tuning, and deprecations.

## evolution
Produce `decisions.json` and `change-impact.json` covering recorded ADR decisions, inferred decisions clearly labeled as inference, alternatives, trade-offs, constraints, consequences, superseded decisions, change surfaces, blast-radius edges, compatibility boundaries, safe extension points, migration risks, affected tests/operations/contracts.

Use empty arrays where evidence is absent. Never invent a security control, SLO, owner, decision rationale, test guarantee, data policy, or configuration default.
