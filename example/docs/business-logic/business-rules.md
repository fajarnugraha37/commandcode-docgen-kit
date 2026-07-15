# Business Rules and Invariants

**Category:** business-logic
**Audience:** engineer, architect, business-analyst
**Coverage tags:** business-rules, branch-conditions
**Evidence:** [domain-lifecycle](../../.docgen/evidence/domain-lifecycle.md), [authorization-model](../../.docgen/evidence/authorization-model.md), [messaging-topics](../../.docgen/evidence/messaging-topics.md), [evidence-storage](../../.docgen/evidence/evidence-storage.md)
**Models:** [business.json](../../.docgen/model/business.json), [system.json](../../.docgen/model/system.json)

---

## Orientation (newcomer)

This page is the **consolidated, exhaustive catalog** of domain invariants and business rules for the Sentinel Enforcement Platform. Every rule below is **evidence-backed** (classification `FACT`) and drawn from the domain model, authorization model, messaging topics, and evidence-storage evidence.

A "rule" is a normative statement the system must uphold. An "invariant" is an enforcement mechanism — who/what actually stops a violation. Most rules have a one-to-one invariant; a few (e.g., outbox survival, checksum rejection) are enforced outside the domain core in infrastructure layers.

Read this page top-to-bottom if you are a business analyst. If you are an engineer or architect, jump to the [Rule Catalog](#rule-catalog) table and the [Rule-to-enforcement-owner mapping](#rule-to-enforcement-owner-mapping) diagram.

## Working model (maintainer)

- **15 rules** are cataloged — all `FACT`, no inferred rules.
- Enforcement owners fall into three buckets: **domain policy** (`CaseProgressionGuard` / `PhaseSevenCaseProgressionGuard`, transition guards, DB relationships), **authorization policy** (`RoleBasedAuthorizationService`), and **infrastructure** (outbox publisher loop, storage adapter guard).
- Two rules (`rule-outbox-survives-kafka-outage`, `rule-checksum-mismatch-reject`) are **not** enforced by the domain core — they live in `sentinel-messaging` and `sentinel-storage` respectively.
- The authoritative source of truth is the domain aggregate; Camunda is orchestration position only (ADR-002).

## Rule Catalog

| Rule id | Statement | Enforcement | Evidence |
|---|---|---|---|
| `rule-closed-immutability` | A CLOSED case cannot change state except via an approved reopen. | Domain policy (`CaseProgressionGuard` / `PhaseSevenCaseProgressionGuard`) | domain-lifecycle |
| `rule-pending-decision-gate` | Cannot enter `PENDING_DECISION` unless the investigation report has been approved. | Domain policy (transition guard) | domain-lifecycle |
| `rule-no-close-with-active-sanction` | Cannot `CLOSE` a case if an active sanction obligation exists. | Domain policy / DB relationship | domain-lifecycle |
| `rule-maker-checker-recommendation` | Maker-checker: the recommendation author must not be the final approver. | Domain policy | domain-lifecycle |
| `rule-sanction-changer-not-approver` | Sanction changer must not be the approver of the same change. | Domain policy | domain-lifecycle |
| `rule-evidence-published-decision-protected` | Evidence referenced by a published decision cannot be deleted. | Domain policy | domain-lifecycle |
| `rule-evidence-sha256-immutable` | Every `EvidenceVersion` has an immutable SHA-256 checksum. | DB constraint / domain value object | domain-lifecycle, evidence-storage |
| `rule-sensitive-download-audit` | Sensitive evidence download emits an audit event (including denied access as `EvidenceDownloadDenied`). | Domain policy / audit append | domain-lifecycle, evidence-storage |
| `rule-published-decision-immutable` | A published Decision is immutable; later change only via correction or appeal. | Domain policy | domain-lifecycle |
| `rule-one-active-appeal` | At most one active appeal may exist per decision. | Domain policy / DB uniqueness | domain-lifecycle |
| `rule-late-appeal-supervisor` | A late appeal requires explicit supervisor override (deadline override rule). | Domain policy / endpoint guard | domain-lifecycle, endpoint-catalog |
| `rule-one-side-effect-per-event` | One `eventId` yields exactly one business side effect per consumer (messaging idempotency). | DB constraint `UNIQUE(consumer_name, event_id)` | domain-lifecycle, messaging-topics |
| `rule-role-insufficient-for-access` | Holding a role alone does not grant case access; jurisdiction/classification/conflict/unit/direct-assignment checks apply. | Authorization policy (`RoleBasedAuthorizationService`) | domain-lifecycle, authorization-model |
| `rule-outbox-survives-kafka-outage` | The OUTBOX is not rolled back on Kafka outage; pending rows remain retryable after committed business writes. | Infrastructure reliability policy (outbox) | messaging-topics, testing-strategy |
| `rule-checksum-mismatch-reject` | Evidence finalize with checksum mismatch or missing object is rejected (conflict/missing exception mapping). | Storage adapter guard | evidence-storage |

## Case State Invariants

The `CaseStatus` enum (FACT, `CaseStatus.java`) defines the lifecycle:
`CREATED → UNDER_TRIAGE → UNDER_INVESTIGATION → PENDING_REVIEW → PENDING_DECISION → DECIDED → UNDER_APPEAL → ENFORCEMENT_IN_PROGRESS → CLOSED / CANCELLED`.

Terminal states: `CLOSED`, `CANCELLED` (`isTerminal()`).

| Invariant | Triggering transition | Enforcement owner |
|---|---|---|
| CLOSED immutability | Any mutation on a `CLOSED` case | `CaseProgressionGuard` (blocked unless approved reopen) |
| PENDING_DECISION requires approved report | `PENDING_REVIEW → PENDING_DECISION` | Transition guard (requires approved investigation report) |
| No close with active sanction | `ENFORCEMENT_IN_PROGRESS → CLOSED` | Domain policy / sanction obligation DB relationship |
| Reopen requires approved reopen | `CLOSED → CREATED` | Domain policy before any state change permitted |

**Progression guards (FACT):** `CaseProgressionGuard` functional interface with `NO_OP` default. `PhaseSevenCaseProgressionGuard` deepens later-state prerequisites (recommendation/review/decision/sanction/appeal). Documented gaps remain for enforcement-monitoring detail (PROJECT_STATUS.md).

## Maker-Checker and Separation

Two separation rules prevent a single actor from both proposing and authorizing a change:

1. **Recommendation maker-checker** (`rule-maker-checker-recommendation`): the recommendation author must not be the final approver. Enforced at `submitRecommendation` / `reviewRecommendation` and across the lifecycle.
2. **Sanction changer ≠ approver** (`rule-sanction-changer-not-approver`): the actor who changes a sanction obligation must not be the approver of that same change.

Both are enforced in **domain policy**. Neither is bypassed by `SYSTEM_ADMIN` short-circuit in the authorization layer — separation is a domain-level invariant independent of the auth role check (see `rule-role-insufficient-for-access`).

## Evidence Integrity

| Rule id | What it protects | Failure behavior |
|---|---|---|
| `rule-evidence-sha256-immutable` | Every `EvidenceVersion` carries an immutable SHA-256 | DB constraint / domain value object; set once at finalize |
| `rule-checksum-mismatch-reject` | Object integrity at finalize | Checksum mismatch or missing object → conflict/missing exception (`EvidenceConflictExceptionMapper` / `EvidenceObjectMissingExceptionMapper`, HTTP 409) |
| `rule-evidence-published-decision-protected` | Evidence referenced by a published decision | Delete blocked by domain policy |
| `rule-sensitive-download-audit` | Access to sensitive evidence | Audit event emitted on every download session; **denied access** recorded as `EvidenceDownloadDenied` |

Evidence lifecycle (FACT): `pending (upload session metadata) → immutable EvidenceVersion (after finalize)`. Finalize verifies object existence, size, media type, and SHA-256; storage unavailable → `503` (`EvidenceStorageUnavailableExceptionMapper`).

## Messaging Idempotency

Two rules govern messaging behavior:

- **`rule-one-side-effect-per-event`** — enforced by `inbox_event` with `UNIQUE(consumer_name, event_id)`. `KafkaNotificationConsumer` writes the inbox row; duplicate delivery → at most one `notification` side effect. Verified by `MessagingReliabilityIT`.
- **`rule-outbox-survives-kafka-outage`** — business change and `outbox_event` insert happen in the **same DB transaction**. `KafkaOutboxPublisher` leases pending rows with `FOR UPDATE SKIP LOCKED`, publishes, marks `PUBLISHED`. A Kafka outage does **not** roll back committed business writes; pending rows remain retryable.

Ordering: outbox key = `aggregateId` for per-aggregate ordering. Retry/DLQ routing: failures → `.retry` topic while under `NOTIFICATION_MAX_RETRIES` (default 3), else `.dlq`.

## Authorization Invariants

`rule-role-insufficient-for-access` is the umbrella authorization invariant. The `RoleBasedAuthorizationService` policy (FACT) applies, in order:

1. `SYSTEM_ADMIN` short-circuits **all** checks.
2. Actor must hold a role mapped to the required `Permission` else `403`.
3. **Jurisdiction** — if context `jurisdictionCode` set and actor lacks it → denied.
4. **Classification clearance** — if `caseClassification` set and actor lacks clearance → denied.
5. **Conflict-of-interest** — if `resourceOwnerId` set and actor `isConflictedWith` owner → denied.
6. **Assigned-unit scope** — `enforceAssignedUnitScope` enforced for unit-restricted resources.
7. **Direct assignment** — `requiresDirectAssignment(actor, permission)` requires `actor.username() == authorizationContext.assigneeUserId()`.

Denied access returns `401` (no token) / `403` (role/jurisdiction/unit/classification/conflict/assignment), mapped by `AuthorizationDeniedExceptionMapper` + `UnauthenticatedExceptionMapper`. `GET /api/v1/cases` and workflow task visibility use the **same** authorization rules — list filtering no looser than item GET.

## Rule-to-enforcement-owner mapping

```mermaid
flowchart TD
    subgraph DOMAIN["Domain policy (sentinel-domain / application)"]
        R1[rule-closed-immutability]
        R2[rule-pending-decision-gate]
        R3[rule-no-close-with-active-sanction]
        R4[rule-maker-checker-recommendation]
        R5[rule-sanction-changer-not-approver]
        R6[rule-evidence-published-decision-protected]
        R7[rule-evidence-sha256-immutable]
        R8[rule-sensitive-download-audit]
        R9[rule-published-decision-immutable]
        R10[rule-one-active-appeal]
        R11[rule-late-appeal-supervisor]
        R12[rule-one-side-effect-per-event]
    end
    subgraph AUTH["Authorization policy (sentinel-security)"]
        R13[rule-role-insufficient-for-access]
    end
    subgraph INFRA["Infrastructure reliability / storage"]
        R14[rule-outbox-survives-kafka-outage]
        R15[rule-checksum-mismatch-reject]
    end

    R1 --> G[CaseProgressionGuard / PhaseSevenCaseProgressionGuard]
    R2 --> TG[Transition guard]
    R3 --> DBR[Sanction obligation DB relationship]
    R4 --> MK[Maker-checker separation]
    R5 --> MK
    R6 --> DP[Delete protection]
    R7 --> DC[DB constraint / value object]
    R8 --> AU[Audit append]
    R9 --> DPI[Published-decision immutability]
    R10 --> UNIQ[DB uniqueness]
    R11 --> EPG[Endpoint guard]
    R12 --> IB[UNIQUE(consumer_name, event_id)]
    R13 --> RBAC[RoleBasedAuthorizationService]
    R14 --> OBX[Outbox + KafkaOutboxPublisher]
    R15 --> SA[MinioEvidenceStorageAdapter guard]

    G -.->|enforced by| DOMAIN
    TG -.->|enforced by| DOMAIN
    RBAC -.->|enforced by| AUTH
    OBX -.->|enforced by| INFRA
    SA -.->|enforced by| INFRA
```

## Caveats and known gaps

- **Enforcement-monitoring detail** is incomplete in current evidence (business.json `unknown-enforcement-monitoring`).
- **Later-state prerequisites** are lighter than the master target; `PhaseSevenCaseProgressionGuard` deepens them but gaps remain (`unknown-later-state-prerequisites`).
- **Workflow-start** still uses compensation rather than outbox-backed start intent (`unknown-workflow-start-compensation`).

## Related pages

- [Branch Conditions and Gateways](branch-conditions.md)
- [Case Lifecycle](../business-domain/case-lifecycle.md)
- [Decision Lifecycle](../business-domain/decision-lifecycle.md)
- [Evidence Lifecycle](../business-domain/evidence-lifecycle.md)
- [Security and Authorization](../architecture/security-authorization.md) — *linked by manifest `security-authorization`; verify canonical path*
