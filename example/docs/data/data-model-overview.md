# Data Model Overview

**Category:** data
**Engine:** PostgreSQL 18.3-alpine
**Migration:** Liquibase 4.31.1, master includes 7 releases
**Source of truth:** Domain relational tables (PostgreSQL) = business state of truth; Camunda ACT_* = orchestration position only (ADR-002)

> All claims on this page are FACT-grounded in `.docgen/evidence/data-schema.md`, `.docgen/evidence/domain-lifecycle.md`, and `.docgen/evidence/messaging-topics.md`, cross-referenced against `.docgen/model/system.json`, `.docgen/model/catalogs.json`, and `.docgen/model/business.json`.

---

## Schema Conventions

FACT conventions enforced across every transactional table:

- Every transactional table carries `id` / `created_at` / `created_by` / `updated_at` / `updated_by` / `version`.
- All timestamps are `TIMESTAMPTZ`.
- Primary keys are UUIDs.
- Unique constraints, foreign keys, check constraints, and partial indexes are applied per table.
- **Append-only tables (`audit_event`) are exempt from version churn** (no `version` update on insert; immutable append).
- Optimistic locking: `UPDATE ... SET version=version+1 WHERE id=#{id} AND version=#{expectedVersion}`; 0 rows affected ⇒ `409 CONCURRENT_MODIFICATION` (see [persistence-patterns](../../data/persistence-patterns.md)).
- Camunda schema is migrated **separately** via `CamundaSchemaMigrator` with `databaseSchemaUpdate=false`.

---

## Core Domain Tables

Phase 1–4 and 6–7 tables owned by `sentinel-persistence`. The case-lifecycle enum (CREATED … CLOSED/CANCELLED) and its invariants (see `domain-lifecycle.md`) are persisted here.

| Release | Table | Key columns / notes | Evidence |
|---|---|---|---|
| 0001 | `report` | `id` UUID PK, `title`, `description`, `jurisdiction_code`, `reporter_name`, `status`, `created/updated by+at`, `version` | `data-schema.md` |
| 0002 | `case_record` | Core case aggregate; status enum `CREATED`…`CANCELLED`; `isTerminal()` ⇒ `CLOSED`/`CANCELLED` | `data-schema.md`, `domain-lifecycle.md` |
| 0002 | `case_assignment` | Unit/individual assignment; supports assigned-unit scope enforcement | `data-schema.md`, `authorization-model` |
| 0002 | `case_status_history` | Appended status transitions; exposed via `getCaseAuditEvents` | `data-schema.md`, `endpoint-catalog` |
| 0002 | `audit_event` | **Append-only**, exempt from version churn; includes `EvidenceDownloadDenied` | `data-schema.md`, `adr-landscape` (ADR-010) |
| 0003 | `workflow_instance` | Correlation table: case business key (`caseId`) ↔ embedded Camunda process instance | `data-schema.md`, `workflow-camunda` |
| 0004 | `evidence` | Active evidence metadata; immutable EvidenceVersion after finalize | `data-schema.md`, `evidence-storage` |
| 0004 | `evidence_version` | Immutable SHA-256 checksum per version; terminal state | `data-schema.md`, `domain-lifecycle` |
| 0004 | `evidence_upload_session` | Pending upload session metadata before finalize | `data-schema.md`, `evidence-storage` |
| 0006 | `recommendation` | draft→submitted→reviewed; maker-checker (author ≠ approver) | `data-schema.md`, `domain-lifecycle` |
| 0006 | `review` | Review of a submitted recommendation | `data-schema.md`, `domain-lifecycle` |
| 0006 | `decision` | draft→approved→published; **immutable after publish** | `data-schema.md`, `domain-lifecycle` |
| 0006 | `decision_version` | Versioned decision content | `data-schema.md`, `domain-lifecycle` |
| 0006 | `sanction` | Sanction with obligations; active obligation blocks `CLOSE` | `data-schema.md`, `domain-lifecycle` |
| 0006 | `sanction_obligation` | Active obligation prevents terminal close | `data-schema.md`, `domain-lifecycle` |
| 0006 | `appeal` | One active appeal per decision; late appeal ⇒ supervisor override | `data-schema.md`, `domain-lifecycle` |
| 0006 | `appeal_decision` | Decision on an appeal | `data-schema.md`, `domain-lifecycle` |
| 0007 | `case_record` (cols) | Classification / assigned-unit / conflict support columns added (phase8-case-authorization) | `data-schema.md`, `authorization-model` |

Domain invariants persisted/guarded on these tables:

- CLOSED cannot change except via approved reopen; cannot enter PENDING_DECISION unless investigation report approved; cannot CLOSE if active sanction obligation.
- maker-checker (author ≠ approver); evidence referenced by published decision cannot be deleted; every EvidenceVersion immutable SHA-256.
- sensitive download emits audit event; published Decision immutable; one active appeal per decision; late appeal needs supervisor override.
- one eventId ⇒ one side effect per consumer; **role alone does not grant case access** (`inv-role-insufficient`).

---

## Messaging and Audit Tables

Messaging reliability tables (release 0005) decouple business writes from Kafka delivery.

| Release | Table | Key columns / notes | Evidence |
|---|---|---|---|
| 0005 | `outbox_event` | Written in same DB tx as business change; `key=aggregateId`; leased via `FOR UPDATE SKIP LOCKED`; marked `PUBLISHED` after Kafka deliver | `data-schema.md`, `messaging-topics.md` |
| 0005 | `inbox_event` | Idempotency record `UNIQUE(consumer_name, event_id)`; ensures at most one side effect per consumer | `data-schema.md`, `messaging-topics.md` |
| 0005 | `notification` | Notification command/result side-effect state | `data-schema.md`, `messaging-topics.md` |
| 0002 | `audit_event` | Append-only (listed under core domain); also the audit source of truth | `data-schema.md`, `adr-landscape` |

Messaging topics (8): `case.lifecycle.v1`, `case.assignment.v1`, `evidence.lifecycle.v1`, `decision.lifecycle.v1`, `sanction.lifecycle.v1`, `appeal.lifecycle.v1` (all out, `key=aggregateId`); `notification.command.v1` (out); `notification.result.v1` (in). See [persistence-patterns](../../data/persistence-patterns.md) and [outbox-reliability](../messaging/outbox-reliability.md).

```mermaid
flowchart LR
    subgraph Domain[Core domain - sentinel-persistence]
        R[report 0001]
        CR[case_record 0002]
        CA[case_assignment 0002]
        CSH[case_status_history 0002]
        AE[audit_event 0002 append-only]
        WI[workflow_instance 0003]
        EV[evidence 0004]
        EVV[evidence_version 0004]
        EUS[evidence_upload_session 0004]
        REC[recommendation 0006]
        REV[review 0006]
        DEC[decision 0006]
        DV[decision_version 0006]
        SAN[sanction 0006]
        SO[sanction_obligation 0006]
        AP[appeal 0006]
        AD[appeal_decision 0006]
    end
    subgraph Messaging[Messaging - release 0005]
        OBX[outbox_event]
        IBX[inbox_event]
        NOT[notification]
    end
    CR --> CSH
    CR --> CA
    CR --> WI
    EV --> EVV
    DEC --> DV
    SAN --> SO
    DEC --> AP
    AP --> AD
    R -. triage source .-> CR
    CR -. business change .-> OBX
    OBX -. leased SKIP LOCKED .-> KAFKA[(Kafka)]
    KAFKA -. notification.result.v1 .-> IBX
    CR -. audit append .-> AE
```

---

## Ownership and Source of Truth

FACT ownership per `.docgen/model/catalogs.json` dataStores:

| Data store | Owner | Notes | Evidence |
|---|---|---|---|
| PostgreSQL (all domain + messaging tables) | `sentinel-persistence` | Authoritative relational store | `catalogs.json`, `data-schema.md` |
| Camunda `ACT_*` schema | `sentinel-workflow` (via `CamundaSchemaMigrator`, `databaseSchemaUpdate=false`) | Orchestration position only — NOT business state of truth (ADR-002) | `catalogs.json`, `workflow-camunda.md` |
| MinIO bucket `sentinel-evidence` | `sentinel-storage` | Evidence objects; presigned URLs | `catalogs.json`, `evidence-storage.md` |
| `outbox_event` table | `sentinel-persistence` (release 0005) | Outbox written in business tx | `catalogs.json`, `messaging-topics.md` |
| `inbox_event` table | `sentinel-persistence` (release 0005) | Idempotency dedup | `catalogs.json`, `messaging-topics.md` |
| `audit_event` table | `sentinel-persistence` (release 0002) | Append-only; ADR-010 | `catalogs.json`, `adr-landscape` |

Source-of-truth rule (FACT, ADR-002): **Domain DB = business state of truth; Camunda = orchestration position only.** A reconciliation job (`WorkflowReconciliationApplicationService`) repairs/terminates domain↔workflow mismatches. See [conceptual-model](../architecture/conceptual-model.md) and [flows](../flows/).

---

## Constraints and Indexes

FACT constraint discipline:

| Constraint type | Where applied | Enforcement |
|---|---|---|
| UUID PK | all transactional tables | identity |
| `UNIQUE(consumer_name, event_id)` | `inbox_event` | at-most-one side effect per consumer (`inv-one-side-effect-per-event`) |
| FK + check constraints | `case_record`, `sanction_obligation`, `appeal`, `decision_version`, `evidence_version` | referential + state validity |
| Partial indexes | status/assignment/visibility columns | scoped query performance (e.g., active appeals, terminal cases) |
| `version` optimistic-lock column | all mutable transactional tables | `UPDATE ... SET version=version+1 WHERE id AND version=expected`; 0 rows ⇒ 409 |
| Append-only (no version churn) | `audit_event` | immutable history |
| SHA-256 immutable | `evidence_version` | `inv-evidence-sha256-immutable` |

Caveats:

- Workflow-start still uses compensation rather than outbox-backed start intent (`gap-workflow-start-outbox`).
- Enforcement-monitoring detail incomplete (`gap-enforcement-monitoring`); later-state prerequisites lighter than master target (`gap-later-state-prerequisites`).
- No Redis/cache evidenced (`dep-redis` UNKNOWN).

---

## Related Pages

- [Conceptual Model](../architecture/conceptual-model.md) — bounded contexts & state-of-truth
- [Liquibase Migrations](../../data/liquibase-migrations.md) — 7-release changelog detail
- [Persistence Patterns](../../data/persistence-patterns.md) — MyBatis, optimistic locking, outbox/inbox
- [Data Flows](../flows/) — outbox-to-Kafka, notification-result-inbox, optimistic-lock
- [Operations Runbooks](../../docs/runbooks/) — outbox-stuck, dead-letter-events, kafka-backlog
