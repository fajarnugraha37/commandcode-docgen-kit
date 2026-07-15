# Module: sentinel-application

Deep dive into the `sentinel-application` module — the application layer of the
Sentinel Enforcement Platform. It hosts command/query handlers, the transaction
boundary, authorization orchestration, and the port interfaces that decouple
domain logic from infrastructure adapters.

- **Module id:** `sentinel-application`
- **Layer:** `application`
- **Bounded context:** `enforcement-application`
- **Source root:** `com/sentinel/enforcement/application/**`

**Newcomer orientation:** This module is the "use-case glue." It receives
commands/queries from the API layer, orchestrates the domain aggregates, enforces
authorization, opens the database transaction, and calls out through ports to
persistence, messaging, storage, workflow, and security adapters. It does not
contain business rules (those live in [`module-domain.md`](module-domain.md)) and
it does not touch infrastructure directly (those live behind ports).

**Maintainer model:** `app` is compiled against `domain` and defines outbound
ports; adapters in `persistence`/`messaging`/`storage`/`workflow`/`security`
implement those ports. `api` calls `app` (compile). `bootstrap` wires ports to
adapters at assembly time. Layering invariant: `domain <- application <- api`,
and `domain` has **no** infrastructure dependencies.

**Related pages:** [`module-overview.md`](module-overview.md),
[`module-domain.md`](module-domain.md),
[`module-persistence.md`](module-persistence.md),
[`security-authorization.md`](security-authorization.md).

---

## Responsibility and Boundaries

`sentinel-application` is the **application** layer. Its responsibility
(FACT, `module-catalog.md`, `system.json`):

> Commands/queries, handlers, transaction boundary, authorization
> orchestration, ports.

What it owns (application services):

- **Case management** — create/list/read cases, start the Camunda process,
  transition state per policy with optimistic locking.
- **Assignment** — assign cases to units/individuals with optimistic lock + audit.
- **Evidence lifecycle** — upload sessions, immutable (SHA-256) evidence
  versions, download sessions with audit.
- **Recommendation/review** — create recommendations, submit (maker-checker),
  review them.
- **Decision/approval/publication** — create, approve (maker ≠ approver),
  publish (immutable thereafter).
- **Sanction** — define sanctions/obligations; active obligation blocks CLOSE.
- **Appeal** — create/decide appeals (one active per decision; late needs
  supervisor override).
- **Notification orchestration** — emits `notification.command.v1` outbox events
  and consumes `notification.result.v1` via inbox.
- **Reconciliation** — detect/repair/terminate domain↔workflow mismatches
  (delegated to workflow adapter, supervisor-scoped).

**Boundaries — what it does NOT own:**

| Concern | Owning module | Why it is out of `app` |
|---|---|---|
| Aggregates, transition rules, domain exceptions | `sentinel-domain` | Domain logic lives in `core`; `app` depends on it (compile). |
| Repository/adapter persistence | `sentinel-persistence` | Implemented behind repository ports (port-adapter). |
| Kafka publishing, outbox polling, inbox dedup | `sentinel-messaging` | Implemented behind messaging ports (port-adapter). |
| MinIO presigned URLs, object storage | `sentinel-storage` | Implemented behind evidence storage port (port-adapter). |
| Camunda runtime, task adapter, correlation | `sentinel-workflow` | Implemented behind workflow adapter port (port-adapter). |
| JWT verification, permission model, policy | `sentinel-security` | Implemented behind authorization port (port-adapter). |
| HTTP resources, DTOs, exception mappers | `sentinel-api` | `api` depends on `app` (compile); `app` has no Jersey deps. |
| Wiring of ports→adapters | `sentinel-bootstrap` | `bootstrap` is the assembly root. |

**Layering invariant (FACT):** `domain <- application <- api`; domain has no
infrastructure deps. `app` depends on `domain` (compile) and on ports implemented
by the persistence/messaging/storage/workflow/security adapters (port-adapter).

**Transaction/reliability caveats (FACT):**
- The OUTBOX is not rolled back on Kafka outage; pending rows remain retryable
  after the business write commits (`business.json` `inv-outbox-not-rolled-back`).
- Domain update and Camunda signal are **not** in one distributed transaction;
  the reconciliation job covers mismatches (`system.json`
  `camundaOrchestration.consistencyNote`).

---

## Command/Query and Handlers

`app` exposes command/query handlers invoked by `api` via `cf-request`
(HTTP request through auth filter → handler). Handlers coordinate domain
aggregates and call ports. The table below maps the application service areas to
the business capabilities they serve and the owning module (FACT,
`business.json`).

### Application service → capability table

| Application service area | Capability | Owning module |
|---|---|---|
| Intake / Triage | `cap-intake` (Intake / Report), `cap-triage` (Triage) | `sentinel-application` |
| Case Management | `cap-case-management` (Case Management) | `sentinel-application` |
| Assignment | `cap-assignment` (Assignment) | `sentinel-application` |
| Evidence Lifecycle | `cap-evidence-lifecycle` (Evidence Lifecycle) | `sentinel-application` |
| Recommendation / Review | `cap-recommendation-review` (Recommendation / Review) | `sentinel-application` |
| Decision / Approval / Publication | `cap-decision-approval-publication` (Decision / Approval / Publication) | `sentinel-application` |
| Sanction | `cap-sanction` (Sanction) | `sentinel-application` |
| Appeal | `cap-appeal` (Appeal) | `sentinel-application` |
| Notification (orchestration) | `cap-notification` (Notification) — emitted/consumed via ports | `sentinel-messaging` (owned); orchestrated by `sentinel-application` |
| Reconciliation | `cap-reconciliation` (Reconciliation) — via workflow adapter | `sentinel-workflow` (owned); orchestrated by `sentinel-application` |
| (Audit exposure) | `cap-audit` (Audit) | `sentinel-persistence` |
| (Workflow task handling) | `cap-workflow-task-handling` (Workflow Task Handling) | `sentinel-workflow` |

**Note:** Notification and Reconciliation capabilities are *owned* by
`sentinel-messaging` and `sentinel-workflow` respectively; `app` orchestrates
them through ports (`df-outbox`/`df-inbox` and `cf-workflow-reconcile`). Audit
is owned by `sentinel-persistence`; `app` reads audit exposure through the
persistence port.

**Representative command/query flows (FACT, `business.json` use cases +
`system.json` control/data flows):**

- **Create Case** (`POST /api/v1/cases`, `uc-create-case`): requires triaged
  source report → creates `CaseRecord` → `cf-workflow-start` starts the
  `regulatory-enforcement-case` process by business key `caseId`.
- **Transition Case** (`uc-transition`): applies state-transition policy under
  `df-optimistic-lock` (optimistic locking on mutable aggregates).
- **Evidence finalize** (`uc-finalize-evidence`): verifies object
  existence/size/type/SHA-256 → activates immutable `EvidenceVersion`; mismatch
  or missing object is rejected.
- **Download session** (`uc-download-session`): enforces authorization → returns
  presigned GET URL (TTL PT10M) → audits denied access.
- **Appeal decision** (`uc-decide-appeal`): late appeal requires supervisor
  override (deadline override rule).

**Handler invariants enforced (FACT, `domain-lifecycle.md`):**
- `CLOSED` case cannot change except via approved reopen.
- Cannot enter `PENDING_DECISION` unless investigation report approved
  (`rule-pending-decision-gate`).
- Cannot `CLOSE` with active sanction obligation (`rule-no-close-with-active-sanction`).
- Maker-checker: recommendation author ≠ final approver; sanction changer ≠
  approver of same change.
- Published `Decision` immutable; later change via correction/appeal.
- One active appeal per decision (+ supervisor override for late).
- One `eventId` → one business side effect per consumer (messaging
  idempotency; `UNIQUE(consumer_name, event_id)`).
- Role alone does **not** grant case access.

---

## Transaction Boundary

`app` defines the transaction boundary for mutable use cases (FACT,
`system.json` `df-optimistic-lock`, `data-schema`).

- **Optimistic concurrency:** mutable aggregates carry a version; updates go
  through `df-optimistic-lock` (app → persistence). A conflicting write surfaces
  as a conflict exception (e.g., `409` at the API layer).
- **Outbox in same DB tx:** business writes and the transactional `OutboxEvent`
  row are committed together (`concept-outboxevent`). The outbox is **not**
  rolled back on Kafka outage — pending rows stay retryable
  (`inv-outbox-not-rolled-back`, `rule-outbox-survives-kafka-outage`).
- **Inbox idempotency:** inbound `notification.result.v1` is deduped by
  `UNIQUE(consumer_name, event_id)` so at most one side effect occurs per
  consumer per event (`concept-inboxevent`, `inv-one-side-effect-per-event`).
- **Workflow start compensation:** `cf-workflow-start` currently uses
  compensation rather than an outbox-backed start intent
  (`system.json` `gap-workflow-start-outbox`). Domain update and Camunda signal
  are not in one distributed transaction; `cf-workflow-reconcile` repairs
  mismatches (`camundaOrchestration.consistencyNote`).
- **Audit append-only:** `AuditEvent` is exempt from optimistic-lock version
  churn (`concept-auditevent`); sensitive download denials are audited
  (`rule-sensitive-download-audit`).

---

## Authorization Orchestration

`app` orchestrates authorization through the **security port** implemented by
`sentinel-security` (`RoleBasedAuthorizationService`). The policy steps are
enforced sequentially (FACT, `authorization-model.md`):

1. **`SYSTEM_ADMIN`** short-circuits all checks.
2. **Role → Permission:** actor must hold a role mapped to the required
   `Permission` else `403`. There are **25 permissions** covering
   report/case/evidence/recommendation/decision/appeal/task/workflow-reconciliation.
3. **Jurisdiction:** if context `jurisdictionCode` is set and actor lacks it ⇒
   denied (`branch-jurisdiction-match`).
4. **Classification clearance:** if `caseClassification` is set and actor lacks
   clearance ⇒ denied (`branch-classification-clearance`).
5. **Conflict-of-interest:** if `resourceOwnerId` set and actor
   `isConflictedWith(owner)` ⇒ denied (`branch-conflict-of-interest`).
6. **Assigned-unit scope:** `enforceAssignedUnitScope` enforced for
   unit-restricted resources (`branch-assigned-unit-scope`).
7. **Direct assignment:** `requiresDirectAssignment(actor, permission)` requires
   `actor.username() == authorizationContext.assigneeUserId()`.

**JWT claims (FACT, verified by `KeycloakTokenVerifier` — signature, issuer,
audience, expiry, not-before, required claims; no unsigned decode):**

| Claim | Used by step |
|---|---|
| `jurisdictions` | Step 3 (jurisdiction) |
| `assigned_units` | Step 6 (assigned-unit scope) |
| `case_classifications` | Step 4 (classification clearance) |
| `conflicted_actor_ids` | Step 5 (conflict-of-interest) |

**Denials (FACT):** `401` when no token; `403` for role/jurisdiction/unit/
classification/conflict/assignment failures. Mapped by
`AuthorizationDeniedExceptionMapper` + `UnauthenticatedExceptionMapper`.

**List-filtering rule (FACT):** `GET /api/v1/cases` and workflow task visibility
use the same authorization rules — list filtering is **no looser** than item GET.

**Cross-cutting caveat (FACT):** Role alone does not grant case access; steps
3–7 still apply (`inv-role-insufficient`, `rule-role-insufficient-for-access`).

See [`security-authorization.md`](security-authorization.md) for the full
permission matrix and policy detail.

---

## Port Interfaces

`app` defines outbound **ports**; the infrastructure adapters implement them
(FACT, `system.json` `moduleDependencies` edges of type `port-adapter`). The
center node in the diagram below is `sentinel-application`; the surrounding
boundaries are the adapter modules reached through ports.

### Application service → port adapter mapping

```mermaid
flowchart TB
    subgraph APP["sentinel-application (application layer)"]
        CMD["Command / Query Handlers"]
        TX["Transaction Boundary"]
        AUTH["Authorization Orchestration"]
        SVCS["Application Services<br/>case / assignment / evidence /<br/>recommendation / decision / sanction /<br/>appeal / notification / reconciliation"]
    end

    subgraph PERS["sentinel-persistence (adapter)"]
        REPO["Repository Ports<br/>(repository adapters)"]
    end

    subgraph MSG["sentinel-messaging (adapter)"]
        OUT["Outbox Port<br/>(notification.command.v1)"]
        IN["Inbox Port<br/>(notification.result.v1)"]
    end

    subgraph STORE["sentinel-storage (adapter)"]
        EVID["Evidence Storage Port<br/>(presigned URL / object)"]
    end

    subgraph WF["sentinel-workflow (adapter)"]
        WFA["Workflow Adapter Port<br/>(Camunda start / reconcile)"]
    end

    subgraph SEC["sentinel-security (adapter)"]
        AZ["Authorization Port<br/>(RoleBasedAuthorizationService)"]
    end

    CMD --> TX
    TX --> SVCS
    SVCS --> AUTH
    AUTH -->|port-adapter| AZ

    SVCS -->|port-adapter (df-optimistic-lock)| REPO
    SVCS -->|port-adapter (df-outbox)| OUT
    IN -->|port-adapter (df-inbox)| SVCS
    SVCS -->|port-adapter (evidence presign)| EVID
    SVCS -->|port-adapter (cf-workflow-start)| WFA
    SVCS -->|port-adapter (cf-workflow-reconcile)| WFA

    classDef app fill:#e8f0fe,stroke:#4285f4,color:#1a3c6e;
    classDef port fill:#fef7e0,stroke:#f9ab00,color:#6b4e00;
    class APP app;
    class AZ,REPO,OUT,IN,EVID,WFA port;
```

**Port dependency edges (FACT, `port-adapter` type):**

| Port boundary | Adapter module | Direction / data-control flow |
|---|---|---|
| Repository ports | `sentinel-persistence` | app → persistence (`df-optimistic-lock`) |
| Outbox port | `sentinel-messaging` | app → messaging (`df-outbox`) |
| Inbox port | `sentinel-messaging` | messaging → app (`df-inbox`) |
| Evidence storage port | `sentinel-storage` | app → storage (presigned upload/finalize) |
| Workflow adapter port | `sentinel-workflow` | app → workflow (`cf-workflow-start`, `cf-workflow-reconcile`) |
| Authorization port | `sentinel-security` | app → security (`RoleBasedAuthorizationService`) |

**Assembly (FACT):** `sentinel-bootstrap` wires these ports to their adapters
(assembly edges). `api` depends on `app` (compile), and `app` depends on
`domain` (compile) — the layering invariant `domain <- application <- api`
holds, with domain free of infrastructure dependencies.

---

## Cross-module references

- [`module-overview.md`](module-overview.md) — full 10-module catalog and
  dependency direction.
- [`module-domain.md`](module-domain.md) — aggregates, transition rules, and
  `CaseProgressionGuard` / `PhaseSevenCaseProgressionGuard`.
- [`module-persistence.md`](module-persistence.md) — repository adapters,
  outbox/inbox tables, optimistic-lock schema.
- [`security-authorization.md`](security-authorization.md) — the 25-permission
  model and `RoleBasedAuthorizationService` policy detail.
