# Security & Authorization (Beyond Jersey Resources)

**Page ID:** security-authorization
**Coverage tags:** security, business-rules, branch-conditions
**Audience:** engineer, architect, security
**Module:** `sentinel-security` (cross-cutting)

Centralized authorization in Sentinel lives in `RoleBasedAuthorizationService.requirePermission(actor, permission, context)` — not in individual Jersey resources. The same service guards REST endpoints, workflow task visibility, and list filtering. This page documents the contract, the 25-permission model, the ordered context checks, the `SYSTEM_ADMIN` short-circuit, tested denial scenarios, and the claim-based vs live-lookup trade-off.

FACT basis: `authorization-model.md`, `endpoint-catalog.md`, `domain-lifecycle.md`, `business.json`, `system.json`, `flows.json`.

---

## 1. Authorization Service Contract

The single entry point for authorization is:

```java
RoleBasedAuthorizationService.requirePermission(actor, permission, context);
```

It throws when any required check fails. Denials are mapped by two exception mappers onto HTTP responses (see [Tested Denial Scenarios](#5-tested-denial-scenarios)):

- `UnauthenticatedExceptionMapper` → **401** when there is no token / the token is unverifiable.
- `AuthorizationDeniedExceptionMapper` → **403** for every role/jurisdiction/unit/classification/conflict/assignment failure.

### Inputs

| Input | Source | Notes |
|---|---|---|
| `actor` | Security context built from the verified JWT | Carries role, `jurisdictions`, `assigned_units`, `case_classifications`, `conflicted_actor_ids`. |
| `permission` | One of 25 `Permission` enum values | Mapped from the requested capability/endpoint. |
| `context` | `authorizationContext` | Carries `jurisdictionCode`, `caseClassification`, `resourceOwnerId`, `enforceAssignedUnitScope`, `assigneeUserId()` as applicable. |

### JWT claim verification (precondition)

Token verification (`KeycloakTokenVerifier`) checks signature, issuer, audience, expiry, not-before, and required claims. There is **no unsigned decode** — an unverifiable token is rejected at the auth filter (→ 401), before `requirePermission` is ever reached.

### Invariant

> **`inv-role-insufficient`** — Holding a role alone does **not** grant case access. Jurisdiction, classification, conflict, assigned-unit scope, and (where required) direct-assignment checks still apply. (Enforced by `RoleBasedAuthorizationService`; confirmed in `authorization-model.md` and `domain-lifecycle.md`.)

---

## 2. Permission Model (25 permissions)

The `Permission` enum has exactly **25** permissions, covering report / case / evidence / recommendation / decision / appeal / task / workflow-reconciliation. Each permission is mapped by a role; `requirePermission` first checks the actor holds a role mapped to the required permission (policy step 2).

The table below maps each permission to a representative endpoint or capability from `endpoint-catalog.md` / `catalogs.json`. Permission identifiers are grouped by domain area; exact enum constant names follow `Permission.java` naming, grouped here by capability.

| Permission (group) | Representative endpoint / capability | Evidence ref |
|---|---|---|
| `REPORT_CREATE` | `POST /api/v1/reports` (`createReport`) | endpoint #2 |
| `REPORT_READ` | `GET /api/v1/reports/{reportId}` (`getReport`) | endpoint #3 |
| `REPORT_TRIAGE` | `POST /api/v1/reports/{reportId}/triage` (`triageReport`) | endpoint #4 |
| `CASE_CREATE` | `POST /api/v1/cases` (`createCase`) | endpoint #5 |
| `CASE_LIST` | `GET /api/v1/cases` (`listCases`) | endpoint #6 |
| `CASE_READ` | `GET /api/v1/cases/{caseId}` (`getCase`) | endpoint #7 |
| `CASE_ASSIGN` | `POST /api/v1/cases/{caseId}/assignments` (`assignCase`) | endpoint #8 |
| `CASE_TRANSITION` | `POST /api/v1/cases/{caseId}/transitions` (`transitionCase`) | endpoint #9 |
| `CASE_AUDIT_READ` | `GET /api/v1/cases/{caseId}/audit-events` (`getCaseAuditEvents`) | endpoint #10 |
| `RECOMMENDATION_CREATE` | `POST /api/v1/cases/{caseId}/recommendations` (`createRecommendation`) | endpoint #11 |
| `RECOMMENDATION_SUBMIT` | `POST /api/v1/recommendations/{recommendationId}/submit` (`submitRecommendation`) | endpoint #12 |
| `RECOMMENDATION_REVIEW` | `POST /api/v1/recommendations/{recommendationId}/reviews` (`reviewRecommendation`) | endpoint #13 |
| `DECISION_CREATE` | `POST /api/v1/cases/{caseId}/decisions` (`createDecision`) | endpoint #14 |
| `DECISION_APPROVE` | `POST /api/v1/decisions/{decisionId}/approve` (`approveDecision`) | endpoint #15 |
| `DECISION_PUBLISH` | `POST /api/v1/decisions/{decisionId}/publish` (`publishDecision`) | endpoint #16 |
| `APPEAL_CREATE` | `POST /api/v1/decisions/{decisionId}/appeals` (`createAppeal`) | endpoint #17 |
| `APPEAL_DECIDE` | `POST /api/v1/appeals/{appealId}/decide` (`decideAppeal`) | endpoint #18 |
| `EVIDENCE_UPLOAD_CREATE` | `POST /api/v1/cases/{caseId}/evidence/upload-sessions` (`createEvidenceUploadSession`) | endpoint #19 |
| `EVIDENCE_READ` | `GET /api/v1/evidence/{evidenceId}` (`getEvidence`) | endpoint #20 |
| `EVIDENCE_FINALIZE` | `POST /api/v1/evidence/{evidenceId}/versions/finalize` (`finalizeEvidenceVersion`) | endpoint #21 |
| `EVIDENCE_DOWNLOAD_CREATE` | `POST /api/v1/evidence/{evidenceId}/download-sessions` (`createEvidenceDownloadSession`) | endpoint #22 |
| `TASK_LIST` | `GET /api/v1/tasks` (`listTasks`) | endpoint #23 |
| `TASK_CLAIM` | `POST /api/v1/tasks/{taskId}/claim` (`claimTask`) | endpoint #24 |
| `TASK_COMPLETE` | `POST /api/v1/tasks/{taskId}/complete` (`completeTask`) | endpoint #25 |
| `WORKFLOW_RECONCILIATION` | `GET /api/v1/workflow-reconciliation` + `POST .../actions` (`listWorkflowReconciliationIssues`, `reconcileWorkflowCase`) | endpoints #26, #27 |

> The 25 permissions span the 8 domain areas named in the enum definition: report, case, evidence, recommendation, decision, appeal, task, workflow-reconciliation. The 27 catalog endpoints all funnel through these 25 permissions (e.g., list vs read of the same resource share a permission area; `CASE_LIST` and `CASE_READ` are distinct to support the no-looser-than-item-GET rule).

---

## 3. Context Checks (jurisdiction / unit / classification / conflict / assignment)

After the `SYSTEM_ADMIN` short-circuit and the role→permission check, `requirePermission` applies the following ordered context checks (policy steps 3–7). Order is fixed; the first failing check denies.

| # | Check | Condition for **denial** | Context field driving it | JWT claim used |
|---|---|---|---|---|
| 3 | **Jurisdiction** | `context.jurisdictionCode` is set AND actor lacks it | `jurisdictionCode` | `jurisdictions` |
| 4 | **Classification clearance** | `context.caseClassification` is set AND actor lacks clearance | `caseClassification` | `case_classifications` |
| 5 | **Conflict-of-interest** | `context.resourceOwnerId` is set AND actor `isConflictedWith(owner)` | `resourceOwnerId` | `conflicted_actor_ids` |
| 6 | **Assigned-unit scope** | `enforceAssignedUnitScope` is `true` for a unit-restricted resource AND actor's unit scope excludes it | `enforceAssignedUnitScope` | `assigned_units` |
| 7 | **Direct assignment** | `requiresDirectAssignment(actor, permission)` is `true` AND `actor.username() != authorizationContext.assigneeUserId()` | `assigneeUserId()` | (username) |

Branch conditions mirror these checks (see `business.json` `branchConditions`):

- `branch-jurisdiction-match` — actor jurisdictionCode matches resource jurisdictionCode? else denied.
- `branch-classification-clearance` — actor holds clearance for caseClassification? else denied.
- `branch-conflict-of-interest` — actor `isConflictedWith(resourceOwnerId)`? else denied.
- `branch-assigned-unit-scope` — `enforceAssignedUnitScope` for unit-restricted resource? else denied.

### List vs item parity

`GET /api/v1/cases` (list) and workflow task visibility use the **same** authorization rules. List filtering is **no looser than** item `GET` — a case hidden from `getCase` is also excluded from `listCases` (safe dynamic SQL via `list-query-pattern`, `endpoint-catalog.md`).

---

## 4. System Admin Short-Circuit

Policy step 1 — a `SYSTEM_ADMIN` actor short-circuits **all** subsequent checks (role mapping, jurisdiction, classification, conflict, unit scope, direct assignment). The `system-admin` seeded user exercises this path.

- The short-circuit applies regardless of `jurisdictionCode`, `caseClassification`, `resourceOwnerId`, unit scope, or assignment.
- It is the first branch evaluated; if it matches, the remaining policy steps are skipped entirely.

This is consistent with `business.json` actor `actor-system-admin`: "SYSTEM_ADMIN short-circuits all authorization checks."

```mermaid
flowchart TD
    A[requirePermission(actor, permission, context)] --> B{actor is SYSTEM_ADMIN?}
    B -- yes --> Z[ALLOW: short-circuit all checks]
    B -- no --> C{actor holds role mapped to permission?}
    C -- no --> D[DENY 403: role]
    C -- yes --> E{context.jurisdictionCode set AND actor lacks it?}
    E -- yes --> F[DENY 403: jurisdiction]
    E -- no --> G{context.caseClassification set AND actor lacks clearance?}
    G -- yes --> H[DENY 403: classification]
    G -- no --> I{context.resourceOwnerId set AND actor isConflictedWith owner?}
    I -- yes --> J[DENY 403: conflict-of-interest]
    I -- no --> K{enforceAssignedUnitScope AND unit-restricted AND actor unit excludes it?}
    K -- yes --> L[DENY 403: assigned-unit]
    K -- no --> M{requiresDirectAssignment AND actor.username != assigneeUserId?}
    M -- yes --> N[DENY 403: direct-assignment]
    M -- no --> O[ALLOW]
    D --> P[AuthorizationDeniedExceptionMapper -> 403]
    F --> P
    H --> P
    J --> P
    L --> P
    N --> P
```

> Note: a missing/unverifiable token never reaches this flowchart — the auth filter rejects it at the edge → **401** (`UnauthenticatedExceptionMapper`).

---

## 5. Tested Denial Scenarios

These denial classes are covered by `RoleBasedAuthorizationServiceTest` (unit) and the `sentinel-integration-tests` suites (`CaseApiIT`, `EvidenceApiIT`, `WorkflowTaskApiIT`, `WorkflowReconciliationApiIT`) per `testing-strategy.md`. The mapping to HTTP status is fixed by the two exception mappers.

| Scenario | Check that fails | HTTP status |
|---|---|---|
| No bearer token / expired / bad signature | token not verifiable (pre-filter) | 401 |
| Actor holds no role mapped to the required permission | policy step 2 (role) | 403 |
| Actor's jurisdiction set excludes the resource `jurisdictionCode` | jurisdiction (step 3) | 403 |
| Actor lacks clearance for the resource `caseClassification` | classification (step 4) | 403 |
| Actor is conflicted with the `resourceOwnerId` | conflict-of-interest (step 5) | 403 |
| Unit-restricted resource outside actor `assigned_units` | assigned-unit scope (step 6) | 403 |
| `requiresDirectAssignment` true but `actor.username != assigneeUserId` | direct assignment (step 7) | 403 |
| Sensitive evidence download denied access | authorization (step 2–7) + audit `EvidenceDownloadDenied` | 403 |

> Integration denial tests from `testing-strategy.md` explicitly cover "investigator visibility, assigned-unit/classification/conflict denial, task cursor/search/sort/dup-completion, reconciliation, outbox reliability under Kafka outage, inbox dedup, **401/403/404/409 cases**."

---

## 6. Claim-Based vs Live Lookup Trade-off

Local actor JWTs carry four authorization-bearing claims (`authorization-model.md`, `KeycloakTokenVerifier`):

- `jurisdictions`
- `assigned_units`
- `case_classifications`
- `conflicted_actor_ids`

### Claim-based (current design)

Context checks read these claims directly from the verified token — no extra DB hop at request time.

| Pros | Cons |
|---|---|
| Low latency; no per-request lookup for scope. | Claims are a **point-in-time snapshot** — revocation/role change only takes effect at next token issuance. |
| Keeps `sentinel-security` free of infrastructure coupling at the check site. | Token lifetime bounds how fresh scope is; caller must re-auth to refresh. |
| Deterministic given the verified token; easy to test (`RoleBasedAuthorizationServiceTest`). | No server-side deny-list within token lifetime (conflict added after issue still blocks until re-issue, because claim already present). |

### Live lookup (alternative)

A live lookup would resolve scope from the domain DB on every `requirePermission` call (e.g., reading `case_assignment`, classification, conflict rows from release 0007 columns).

| Pros | Cons |
|---|---|
| Always-current scope; immediate revocation. | Adds a DB round-trip on every guarded call (latency + coupling). |
| Single source of truth at check time. | Harder to reason about under optimistic locking / concurrent assignment changes. |

### Decision stance (evidence)

The shipped model is **claim-based**, consistent with ADR-006 (Keycloak local IdP, JWT verification, claim-based authz). The token is verified for signature/issuer/audience/expiry/nbf/required-claims before any check, so claims are trusted once the token is valid. Direct-assignment (step 7) is the one check that reads a request-time `assigneeUserId()` from `authorizationContext` rather than a static claim, but it still compares against the live `actor.username()` — not a separate DB lookup.

---

## Related pages

- [Keycloak Authentication](./keycloak-authentication.md) — JWT issuance, JWKS verification, claim population.
- [Branch Conditions](../business-logic/branch-conditions.md) — the authorization branch conditions as business rules.
- [Business Rules](../business-logic/business-rules.md) — `inv-role-insufficient` and maker-checker / sanction invariants.
- [Decisions and Authorization Contexts](./decisions-and-authorization-contexts.md) — how contexts are assembled per request.

> Cross-link targets above are the canonical page locations implied by the related-page list. Adjust the relative path if a target page is renamed.
