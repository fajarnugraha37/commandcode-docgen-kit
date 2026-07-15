# Glossary

Canonical terminology for the Sentinel Enforcement Platform. This page is the authoritative source for domain, messaging, authorization, and storage vocabulary used across the documentation set.

**Related pages:** [Business Overview](business-overview.md), [Conceptual Model](conceptual-model.md), [Security & Authorization](security-authorization.md).

> Evidence markers follow each term: `(FACT, <source>)` denotes a fact grounded in a model or evidence file; `(ADR-###)` denotes a decision recorded in an architecture decision record. Sources are listed in the *Evidence* column of each table.

---

## Domain Terms

Terms describing the regulatory enforcement business domain, case lifecycle, and workflow correlation.

| Term | Canonical Meaning | Evidence |
| --- | --- | --- |
| `CaseRecord` | Core case aggregate with status, assignments, status history, and audit events; lifecycle runs `CREATED` → `CLOSED`/`CANCELLED`. | (FACT, domain-lifecycle, data-schema) |
| `CaseStatus` | Enum: `CREATED`, `UNDER_TRIAGE`, `UNDER_INVESTIGATION`, `PENDING_REVIEW`, `PENDING_DECISION`, `DECIDED`, `UNDER_APPEAL`, `ENFORCEMENT_IN_PROGRESS`, `CLOSED`, `CANCELLED`; terminal states are `CLOSED`/`CANCELLED`. | (FACT, domain-lifecycle, system.json) |
| `EvidenceVersion` | Immutable evidence version carrying a SHA-256 checksum; produced only after finalize (size/type/checksum verification). | (FACT, domain-lifecycle, evidence-storage, data-schema) |
| `SHA-256` | Client-supplied immutable integrity digest for evidence objects; verified at finalize. Mismatch or missing object raises a conflict. | (FACT, domain-lifecycle, evidence-storage) |
| `Report` | Intake aggregate; must be triaged before it can become a case source. | (FACT, domain-lifecycle, data-schema) |
| `Recommendation` | Proposed enforcement recommendation within a case (see business.json concepts). | (FACT, business.json) |
| `Review` | Review activity over a recommendation or decision artifact (see business.json concepts). | (FACT, business.json) |
| `Decision` | Outcome decision for a case, versioned via `DecisionVersion`. | (FACT, business.json) |
| `DecisionVersion` | Versioned snapshot of a case decision. | (FACT, business.json) |
| `Sanction` | Enforcement sanction issued against a party; composed of obligations. | (FACT, business.json) |
| `SanctionObligation` | Individual obligation bound to a sanction. | (FACT, business.json) |
| `Appeal` | Challenge raised against a decided case; resolved by an `AppealDecision`. | (FACT, business.json) |
| `AppealDecision` | Decision resolving an appeal. | (FACT, business.json) |
| `BusinessKey` | `caseId` used as the Camunda business key to start and correlate the `regulatory-enforcement-case` process. | (FACT, workflow-camunda) |
| `WorkflowInstance` | Correlation table linking a domain case business key (`caseId`) to an embedded Camunda process instance. | (FACT, workflow-camunda, data-schema) |
| `AuditEvent` | Append-only audit record (exempt from optimistic-lock version churn); includes sensitive download denials. | (FACT, domain-lifecycle, data-schema, ADR-010) |
| `ProgressionGuard` | `CaseProgressionGuard` functional interface with a `NO_OP` default; `PhaseSevenCaseProgressionGuard` deepens later-state prerequisites. | (FACT, domain-lifecycle) |

---

## Messaging Terms

Terms describing the transactional outbox/inbox pattern, Kafka topics, and failure routing.

| Term | Canonical Meaning | Evidence |
| --- | --- | --- |
| `OutboxEvent` | Transactional outbox row written in the same DB transaction as the business change; `key = aggregateId`; leased via `SKIP LOCKED`; marked `PUBLISHED` after Kafka delivery. | (ADR-004) |
| `InboxEvent` | Idempotency record with `UNIQUE(consumer_name, event_id)`; guarantees at most one side effect per consumer per event. | (ADR-005) |
| `case.lifecycle.v1` | Outbound Kafka topic for case lifecycle events. | (FACT, messaging-topics) |
| `case.assignment.v1` | Outbound Kafka topic for case assignment events. | (FACT, messaging-topics) |
| `evidence.lifecycle.v1` | Outbound Kafka topic for evidence lifecycle events. | (FACT, messaging-topics) |
| `decision.lifecycle.v1` | Outbound Kafka topic for decision lifecycle events. | (FACT, messaging-topics) |
| `sanction.lifecycle.v1` | Outbound Kafka topic for sanction lifecycle events. | (FACT, messaging-topics) |
| `appeal.lifecycle.v1` | Outbound Kafka topic for appeal lifecycle events. | (FACT, messaging-topics) |
| `notification.command.v1` | Outbound Kafka topic carrying notification commands. | (FACT, messaging-topics) |
| `notification.result.v1` | Inbound Kafka topic carrying notification results. | (FACT, messaging-topics) |
| `Dead-letter / retry` | Failure routing path: events go to `.retry` then `.dlq`; `NOTIFICATION_MAX_RETRIES` defaults to `3`. | (FACT, messaging-topics) |

---

## Authorization Terms

Terms describing jurisdiction, clearance, unit scope, separation-of-duties, and the authorization service.

| Term | Canonical Meaning | Evidence |
| --- | --- | --- |
| `JurisdictionCode` | Value (`jkt`/`bdg`) on reports/cases and in the JWT claim; gates access and the evidence object key path. | (FACT, data-schema, authorization-model, evidence-storage) |
| `CaseClassification` | Clearance-tagged classification on cases; an actor must hold the required clearance to access. | (FACT, authorization-model, data-schema) |
| `AssignedUnit` | Unit-scope assignment on cases; `enforceAssignedUnitScope` applies to unit-restricted resources; backed by the JWT claim `assigned_units`. | (FACT, authorization-model, data-schema) |
| `maker-checker` | Separation control — the recommendation author must not be the final approver; the sanction changer must not approve the same change. | (FACT, domain-lifecycle) |
| `Permission` | Enum of 25 permissions spanning report/case/evidence/recommendation/decision/appeal/task/workflow-reconciliation. | (FACT, authorization-model) |
| `RoleBasedAuthorizationService` | Centralized authorization service; `SYSTEM_ADMIN` short-circuits; performs jurisdiction/classification/conflict/unit/direct-assignment checks. | (FACT, authorization-model) |
| `Conflict-of-interest` | If `resourceOwnerId` is set and the actor `isConflictedWith` the owner, access is denied. | (FACT, authorization-model) |

---

## Storage Terms

Terms describing the MinIO evidence store, presigned URLs, object keying, and upload sessions.

| Term | Canonical Meaning | Evidence |
| --- | --- | --- |
| `MinIO / evidence bucket` | `sentinel-evidence` bucket, idempotently created by `minio-init`. | (FACT, evidence-storage) |
| `Presigned URL` | Short-lived upload `PUT` (default TTL `PT15M`) / download `GET` (default TTL `PT10M`); filename and media type are **not** trusted from the URL. | (FACT, evidence-storage) |
| `Object key pattern` | `/{jurisdiction}/{caseId}/{evidenceId}/{version}/{generatedFileName}`; path traversal is prevented. | (FACT, evidence-storage) |
| `EvidenceUploadSession` | Pending metadata created before the client upload; finalized after verification. | (FACT, evidence-storage) |
