# Documentation Map

Generated from `.docgen/plan/manifest.json`.

## undefined

- [Sentinel Enforcement Platform Overview](../orientation/overview.md) — Sentinel is a modular-monolith regulatory enforcement and complex case-management platform covering report intake, triage, investigation, recommendation, decision, sanction, appeal, and closure. This page frames the system, its mandatory tech stack, and the navigation taxonomy.
- [Quickstart](../orientation/quickstart.md) — Clone, bootstrap, bring dependencies up, migrate, seed, and smoke-test. Includes the minimal command sequence and expected endpoints.
- [Repository Map](../orientation/repository-map.md) — Maps top-level directories, Maven modules, Docker/compose assets, docs, and the .docgen workspace to their responsibilities.
- [Architecture at a Glance](../orientation/architecture-at-a-glance.md) — Modular monolith with explicit bounded contexts. Domain has no infrastructure dependencies; application depends on infrastructure through ports/adapters. Covers the REST/Application/Domain/Ports/Infrastructure layering and ADR-001..010 anchors.

## undefined

- [Business Overview](../business-domain/business-overview.md) — Describes the regulatory enforcement problem space, the human and system actors (intake officer through system admin, plus Kafka/MinIO/Keycloak), and the 13 capabilities from intake to notification.
- [Conceptual Model](../business-domain/conceptual-model.md) — Key concepts: Report, CaseRecord, CaseStatus, EvidenceVersion, SHA-256, Recommendation, Review, Decision/DecisionVersion, Sanction/SanctionObligation, Appeal, OutboxEvent, InboxEvent, WorkflowInstance, AuditEvent, BusinessKey, JurisdictionCode, CaseClassification, AssignedUnit.
- [Case Lifecycle and State Machine](../business-domain/case-lifecycle.md) — States CREATED, UNDER_TRIAGE, UNDER_INVESTIGATION, PENDING_REVIEW, PENDING_DECISION, DECIDED, UNDER_APPEAL, ENFORCEMENT_IN_PROGRESS, CLOSED, CANCELLED. Terminal CLOSED/CANCELLED. Transition policy enforced via CaseProgressionGuard / PhaseSevenCaseProgressionGuard with optimistic locking and status history.
- [Decision Lifecycle](../business-domain/decision-lifecycle.md) — Decision moves draft -> approved -> published; immutable after publish; later change only via correction or appeal. Maker (decision creator) must not be the approver.
- [Recommendation and Review Lifecycle](../business-domain/recommendation-lifecycle.md) — Recommendation draft -> submitted (maker-checker) -> reviewed. Author must not be the final approver of the same recommendation.
- [Appeal Lifecycle](../business-domain/appeal-lifecycle.md) — Appeal open -> decided. At most one active appeal per decision. Late appeal beyond deadline requires explicit supervisor override before it can be decided.
- [Evidence Lifecycle](../business-domain/evidence-lifecycle.md) — Pending upload-session metadata -> immutable EvidenceVersion after finalize (verifies size/type/SHA-256). Evidence referenced by a published decision cannot be deleted. Sensitive download emits an audit event including denied access.
- [Sanction and Obligation Model](../business-domain/sanction-model.md) — Sanction with obligations; an active sanction obligation blocks CLOSE. The sanction changer must not be the approver of the same change.

## undefined

- [Business Rules and Invariants](../business-logic/business-rules.md) — All 15 evidence-backed rules/invariants: closed immutability, pending-decision gate, no-close-with-active-sanction, maker-checker, sanction changer != approver, evidence published-decision protection, SHA-256 immutability, sensitive-download audit, published-decision immutability, one-active-appeal, late-appeal supervisor, one-side-effect-per-event, role-insufficient-for-access, outbox survives Kafka outage, checksum-mismatch reject.
- [Branch Conditions and Gateways](../business-logic/branch-conditions.md) — Evidence-sufficient, violation-proven, appeal-submitted, late-appeal-deadline, jurisdiction-match, classification-clearance, conflict-of-interest, assigned-unit-scope, retry-vs-dlq, duplicate-inbox branch conditions across Camunda gateways, authorization policy, and messaging routing.
- [Decisions and Authorization Contexts](../business-logic/decisions-and-authorization-contexts.md) — Key decisions (investigation-report approval gates pending-decision, decision approval maker != approver, appeal deadline override, approved reopen required, reconciliation repair/terminate) and the AuthorizationContext fields (caseId, jurisdictionCode, assignedUnitId, assigneeId, caseClassification, caseStatus, resourceOwner, createdBy).

## undefined

- [Business Flows](../flows/business-flows.md) — End-to-end enforcement case lifecycle, appeal subprocess, and evidence collection sub-flow, expressed as business steps independent of implementation.
- [Control Flows](../flows/control-flows.md) — HTTP request through auth filter to handler, case creation starts Camunda process, workflow reconciliation job, outbox polling publisher loop, investigation escalation boundary timer.
- [Inbound Request Flows](../flows/request-flows.md) — Mutating case request (transitionCase), list cases (cursor query), finalize evidence version, claim workflow task. Each shows auth filter, DTO validation, transaction boundary, authorization orchestration, transition policy, optimistic locking, outbox insert, and RFC-7807 error mapping.
- [Traffic and Trust-Boundary Flows](../flows/traffic-flows.md) — Client->app over HTTP (JWT bearer), app->Keycloak JWKS (host.docker.internal), app->PostgreSQL, app->Kafka, app->MinIO, MinIO-init bucket bootstrap. Documents trust boundaries and unsigned-decode prohibition.
- [Data Flows](../flows/data-flows.md) — Report create to DB, transactional outbox to Kafka, notification result to inbox, evidence presigned upload/finalize, optimistic locking write path, audit event append, case status history.
- [Event and Message Flows](../flows/event-flows.md) — case.lifecycle.v1, case.assignment.v1, evidence.lifecycle.v1, decision.lifecycle.v1, sanction.lifecycle.v1, appeal.lifecycle.v1 (out), notification.command.v1 (out), notification.result.v1 (in). Each documents producer, consumer, ordering key, idempotency, retry/DLQ.

## undefined

- [Endpoint Catalog](../api/endpoint-catalog.md) — Every verified operationId with method, path, auth mode, description, and the evidence/section it belongs to. Serves as the canonical API lookup page.
- [Intake and Reports API](../api/api-intake-reports.md) — createReport, getReport, triageReport: authorization (intake/triage officer), validation, optimistic lock on triage, and the prerequisite that a report must be triaged before case creation.
- [Case Management API](../api/api-case-management.md) — createCase (starts Camunda), listCases (cursor + q + searchField + sortBy), getCase, assignCase (optimistic lock + audit), transitionCase (transition policy + OLC), getCaseAuditEvents (cursor-paged).
- [Evidence API](../api/api-evidence.md) — createEvidenceUploadSession (presigned PUT TTL PT15M), getEvidence, finalizeEvidenceVersion (verify size/type/SHA-256; 409 on mismatch/missing; 503 on storage unavailable), createEvidenceDownloadSession (presigned GET TTL PT10M + audit denied).
- [Recommendation and Review API](../api/api-recommendation-review.md) — createRecommendation, submitRecommendation (maker-checker), reviewRecommendation. Documents separation enforcement and lifecycle gating.
- [Decision and Appeal API](../api/api-decision-appeal.md) — createDecision, approveDecision (maker != approver), publishDecision (immutable), createAppeal (one active), decideAppeal (late-appeal supervisor override).
- [Workflow Tasks and Reconciliation API](../api/api-workflow-tasks.md) — listTasks (cursor-paged), claimTask (409 conflicting claim), completeTask (idempotent), listWorkflowReconciliationIssues (supervisor-scoped), reconcileWorkflowCase (repair/terminate).

## undefined

- [Message Handler Catalog](../messaging/message-handler-catalog.md) — 8 topics; 7 outbox-backed producers via KafkaOutboxPublisher; notification.result.v1 consumer (KafkaNotificationConsumer) + processor (NotificationEventHandler); OutboxRepositoryMyBatisAdapter and InboxRepositoryMyBatisAdapter.
- [Transactional Outbox Reliability](../messaging/outbox-reliability.md) — Same-DB-tx business change + outbox_event insert; publisher polls (PT2S, batch 20), leases via FOR UPDATE SKIP LOCKED (owner APP_INSTANCE_ID, PT30S), publishes key=aggregateId, marks PUBLISHED. Outbox not rolled back on Kafka outage; safe against duplicate publish.
- [Inbox Idempotency](../messaging/inbox-idempotency.md) — InboxEvent UNIQUE(consumer_name, event_id) written in same tx as side effect. Duplicate delivery yields at most one notification side effect. NotificationEventHandler produces side effect after dedup; retry/DLQ via NOTIFICATION_MAX_RETRIES=3.

## undefined

- [Camunda Workflow Integration](../integrations/camunda-workflow.md) — Embedded Camunda 7.24.0 (databaseSchemaUpdate=false, migrated via CamundaSchemaMigrator). Deployments: regulatory-enforcement-case.bpmn, decision-appeal-review.bpmn. Adapters: CamundaCaseWorkflowAdapter, InvestigationEscalationDelegate, WorkflowReconciliationApplicationService. ADR-002: domain is state of truth; Camunda is orchestration position. Business key = caseId.
- [MinIO Evidence Storage](../integrations/minio-evidence-storage.md) — MinIO RELEASE.2025-09-07, bucket sentinel-evidence. Upload session -> presigned PUT (TTL PT15M) -> client upload -> finalize verifies size/type/SHA-256 -> immutable EvidenceVersion. Download presigned GET (TTL PT10M) + audit denied. Path-traversal prevention; short-lived URLs.
- [Keycloak Authentication](../integrations/keycloak-authentication.md) — Keycloak 26.6, realm 'sentinel', issues JWTs verified via JWKS (signature/issuer/audience/expiry/nbf/required claims). Claims: jurisdictions, assigned_units, case_classifications, conflicted_actor_ids. App fetches host Keycloak certs via host.docker.internal. No unsigned JWT decode.

## undefined

- [Module Overview](../modules/module-overview.md) — Module catalog with layer, bounded context, responsibility, and compile/port-adapter/assembly/test dependency edges. Documents the layering invariant (domain <- application <- api; domain has no infra deps).
- [Module: sentinel-domain](../modules/module-domain.md) — Aggregates, entities, value objects, policies, transition rules, domain exceptions. No infrastructure dependencies. Hosts CaseRecord/CaseStatus, Evidence, Decision, Appeal, Recommendation and progression guards.
- [Module: sentinel-application](../modules/module-application.md) — Commands/queries, handlers, transaction boundary, authorization orchestration, ports. Owns case management, assignment, evidence lifecycle, recommendation/review, decision/appeal, notification, reconciliation application services.
- [Module: sentinel-api](../modules/module-api.md) — Jersey resources, request/response DTOs, exception mappers (RFC-7807 envelope), MapStruct mappers, auth filter integration. Contract-first OpenAPI 3.0.3.
- [Module: sentinel-persistence](../modules/module-persistence.md) — MyBatis mappers, repository adapters, Liquibase changelog (7 releases), type handlers, PL/pgSQL. PostgreSQL 18.3-alpine. Hosts outbox/inbox/audit/status-history tables and optimistic locking SQL.
- [Module: sentinel-messaging](../modules/module-messaging.md) — KafkaOutboxPublisher, KafkaNotificationConsumer, NotificationEventHandler, OutboxRepositoryMyBatisAdapter, InboxRepositoryMyBatisAdapter. Outbox polling, leasing, retry/DLQ.
- [Module: sentinel-storage](../modules/module-storage.md) — MinioEvidenceStorageAdapter, presigned URL minting, object metadata, evidence storage adapter. Bucket sentinel-evidence. Integrates with evidence lifecycle finalize/download.
- [Module: sentinel-workflow](../modules/module-workflow.md) — Embedded Camunda 7.24.0 runtime, BPMN deployment, task adapter, correlation, escalation delegate. Hosts CamundaCaseWorkflowAdapter, InvestigationEscalationDelegate, and reconciliation hooks.
- [Module: sentinel-security](../modules/module-security.md) — JWT verification (Keycloak), security context, permission model (25 permissions), RoleBasedAuthorizationService. Implements the centralized authorization policy used across modules.
- [Module: sentinel-bootstrap](../modules/module-bootstrap.md) — Entry point, HK2 binder, config loading, Liquibase/Camunda migration mains, health endpoint, Jersey server bootstrap, lifecycle management. Wires all modules together.
- [Module: sentinel-integration-tests](../modules/module-integration-tests.md) — Testcontainers PostgreSQL+Kafka+MinIO+Keycloak integration suites; unit, integration, workflow, and messaging test layers; failure-injection coverage.

## undefined

- [Data Model Overview](../data/data-model-overview.md) — Transactional tables with id/created_at/created_by/updated_at/updated_by/version (TIMESTAMPTZ, UTC). Append-only exceptions (audit_event). Outbox/inbox/status-history. Ownership by sentinel-persistence; domain = source of truth.
- [Liquibase Migrations](../data/liquibase-migrations.md) — db.changelog-master.yaml with releases 0001-foundation, 0002-case-management, 0003-workflow, 0004-evidence, 0005-messaging, 0006-phase7-decision-appeal, 0007-phase8-case-authorization. Stable identifiers, rollback where sensible, no edits to released changesets.
- [Persistence Patterns](../data/persistence-patterns.md) — MyBatis mappers over JDBC/HikariCP; optimistic locking via version column (UPDATE ... SET version=version+1 WHERE id AND version=expected; 0 rows -> 409 CONCURRENT_MODIFICATION); outbox/inbox tables; parameterized queries; no SELECT *.

## undefined

- [Security and Authorization](../cross-cutting/security-authorization.md) — RoleBasedAuthorizationService.requirePermission(actor, permission, context). Checks: role + jurisdiction + assigned-unit + case-classification + conflict-of-interest + direct-assignment. SYSTEM_ADMIN short-circuit. 25 permissions. Claim-based vs live lookup trade-off.
- [Configuration](../cross-cutting/configuration.md) — Env vars (HTTP_PORT, DB_URL, DB_USERNAME/PASSWORD, KAFKA_BOOTSTRAP_SERVERS, REDIS_HOST/PORT, MINIO_*, KEYCLOAK_ISSUER/AUDIENCE, CAMUNDA_DATABASE_URL, WORKFLOW_INVESTIGATION_ESCALATION_DURATION, OUTBOX_POLL_INTERVAL, NOTIFICATION_MAX_RETRIES). .env.example, Makefile, Dockerfile, fail-fast on missing required config.
- [Observability and Audit](../cross-cutting/observability.md) — Structured JSON logging with MDC (correlationId, traceId, actorId, caseId, processInstanceId, taskId, eventId, topic, partition, offset, errorCode, durationMs). Correlation id accepted/validated/generated/returned and propagated to Kafka headers and workflow. Append-only audit_event model (ADR-010). Health endpoint.

## undefined

- [Local Development](../operations/local-development.md) — Docker Compose + Makefile driven: bootstrap, up, migrate, seed, smoke-test. Multi-stage Docker build, non-root app container, bounded exponential backoff for dependency readiness. Common build/test commands.
- [Deployment Topology](../operations/deployment-topology.md) — Docker Compose services: app, postgres, kafka, redis (UNKNOWN presence), minio, minio-init, keycloak, mailpit (UNKNOWN). Healthchecks, named volumes, explicit ports, readiness dependencies, stable hostnames. Internal service network trust boundaries.
- [Testing Strategy](../operations/testing-strategy.md) — JUnit 5. Unit (state transition, maker-checker, appeal deadline, authorization, evidence lifecycle, sanction, mappers, events). Persistence integration (Testcontainers PostgreSQL, Liquibase, MyBatis, constraints, OLC, PL/pgSQL, concurrent case number). Workflow, Kafka, MinIO tests. E2E lifecycle. Current verification status from PROJECT_STATUS.
- [Operations Runbooks](../operations/operations-runbooks.md) — Runbooks for: app fails to start, PostgreSQL unavailable, Kafka backlog, outbox stuck, dead-letter event, Camunda incident, domain-workflow mismatch, MinIO object missing, Liquibase lock, Keycloak unavailable. Each with trigger, expected behavior, consistency expectation, retry, operator action, audit/log evidence.
- [Troubleshooting](../operations/troubleshooting.md) — Symptom-oriented troubleshooting: 401/403, 409 concurrent modification, 503 storage unavailable, stuck outbox, missing evidence object, Liquibase lock, JWT verification failure, workflow incident. Maps symptoms to runbooks and logs.

## undefined

- [Architecture Decision Record Landscape](../reference/adr-landscape.md) — ADR-001 modular-monolith, ADR-002 domain-state-vs-workflow-state, ADR-003 mybatis-over-orm, ADR-004 transactional-outbox, ADR-005 inbox-idempotency, ADR-006 keycloak-local-authentication, ADR-007 minio-evidence-storage, ADR-008 optimistic-locking, ADR-009 api-contract-first, ADR-010 audit-log-model. Each with context/decision/alternatives/consequences/status.
- [Glossary](../reference/glossary.md) — Project-specific terms: CaseRecord, CaseStatus, EvidenceVersion, SHA-256, OutboxEvent, InboxEvent, BusinessKey, JurisdictionCode, CaseClassification, AssignedUnit, ProgressionGuard, maker-checker, reconciliation. (Note: source glossary.md is currently a stub; this page seeds canonical meanings from evidence.)
- [Known Limitations and Unknowns](../reference/known-limitations-and-unknowns.md) — Enforcement-monitoring detail incomplete; later-state prerequisites lighter than master target; workflow-start uses compensation not outbox-backed start intent; load/performance review outstanding; module ownership not assigned (INFERENCE); Redis usage UNKNOWN; mailpit notification target UNKNOWN. Marked with classification and evidence refs.
