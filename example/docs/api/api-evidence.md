# Evidence API

Deeper behavior for the evidence upload, download, and finalize endpoints. This page is the behavioral contract for `createEvidenceUploadSession`, `getEvidence`, `finalizeEvidenceVersion`, and `createEvidenceDownloadSession`. All claims are grounded in the endpoint catalog, MinIO evidence-storage notes, and domain-lifecycle invariants.

- **Audience:** engineer
- **Source endpoints:** `POST /api/v1/cases/{caseId}/evidence/upload-sessions`, `GET /api/v1/evidence/{evidenceId}`, `POST /api/v1/evidence/{evidenceId}/versions/finalize`, `POST /api/v1/evidence/{evidenceId}/download-sessions`
- **Storage adapter:** `MinioEvidenceStorageAdapter` (sentinel-storage); bucket `MINIO_EVIDENCE_BUCKET` (default `sentinel-evidence`), created idempotently by `deployment/minio/init/create-bucket.sh` via the `minio-init` service.
- **Related pages:** [Endpoint Catalog](../api/endpoint-catalog.md), [Evidence Lifecycle](../evidence/evidence-lifecycle.md), [MinIO Evidence Storage](../runbooks/minio-evidence-storage.md), [Observability](../operations/observability.md)

## Orientation (newcomer)

Evidence is never streamed through the application. The app mints **presigned URLs** so the client talks to MinIO directly:

1. **Upload session** → app validates permission, writes *pending* metadata, and returns a **presigned PUT URL** (TTL `EVIDENCE_UPLOAD_URL_TTL`, default **PT15M**).
2. Client PUTs the object straight to MinIO.
3. **Finalize** → app verifies the object exists, its size, its media type, and its **SHA-256** (supplied by the client at session creation). On success it activates an **immutable `EvidenceVersion`**.
4. **Read** → `GET /api/v1/evidence/{evidenceId}` returns active metadata + the latest version.
5. **Download session** → app enforces authorization and returns a **presigned GET URL** (TTL `EVIDENCE_DOWNLOAD_URL_TTL`, default **PT10M**); denied access is audited (`EvidenceDownloadDenied`).

The client-supplied filename and media type are **never trusted**; the object key is server-generated and path-traversal is prevented.

## Working model (maintainer)

| Operation | Endpoint | Presigned TTL | Primary checks | Failure mapping |
|---|---|---|---|---|
| Create upload session | `POST /api/v1/cases/{caseId}/evidence/upload-sessions` | `EVIDENCE_UPLOAD_URL_TTL` (default PT15M, PUT) | permission, pending metadata, key build | 401/403/404/409/422/429/500 |
| Get evidence | `GET /api/v1/evidence/{evidenceId}` | none | authorization, active version lookup | 401/403/404/500 |
| Finalize version | `POST /api/v1/evidence/{evidenceId}/versions/finalize` | none | existence, size, media type, SHA-256 | 409 (mismatch/missing), 503 (storage down), 404/422 |
| Create download session | `POST /api/v1/evidence/{evidenceId}/download-sessions` | `EVIDENCE_DOWNLOAD_URL_TTL` (default PT10M, GET) | authorization, audit denied | 401/403/404/429/500 (+ audit) |

Object key pattern (server-generated):

```
/{jurisdiction}/{caseId}/{evidenceId}/{version}/{generatedFileName}
```

- `filename` / `media type` are **not trusted from the client**; the `generatedFileName` is produced by the app.
- Path traversal is prevented on key construction.
- Every `EvidenceVersion` carries an **immutable SHA-256** (DB constraint / domain value object).
- **Invariant:** evidence referenced by a *published decision* cannot be deleted (`inv-evidence-referenced-protected`).

## Upload Session

`POST /api/v1/cases/{caseId}/evidence/upload-sessions` — `operationId: createEvidenceUploadSession` (bearer).

**Behavior (FACT, evidence-storage §1, endpoint-catalog #19):**
1. Validates the caller's permission on the case (authorization policy: role alone is insufficient — jurisdiction / classification / conflict / unit / direct-assignment apply, see `inv-role-insufficient`).
2. Creates **pending** metadata (`EvidenceUploadSession` aggregate; persisted in release 0004 tables `evidence`, `evidence_version`, `evidence_upload_session`).
3. Returns a **presigned PUT URL** scoped to the object key with TTL `EVIDENCE_UPLOAD_URL_TTL`, default **PT15M**.
4. The client uploads the object **directly to MinIO** (the app never buffers the bytes).

**Object key (FACT, evidence-storage):** `/{jurisdiction}/{caseId}/{evidenceId}/{version}/{generatedFileName}`
- Path traversal prevented on key assembly.
- Filename and media type are **not trusted from the client**; the server generates `generatedFileName` and derives the stored media type at finalize.

**Notes / caveats:**
- The SHA-256 is **client-supplied at session creation** and verified later at finalize — the upload step does not itself compute or validate the digest.
- A session that is never finalized leaves *pending* metadata; there is no TTL-based auto-purge described in evidence (treat as pending indefinitely unless otherwise reconciled).

## Get Evidence

`GET /api/v1/evidence/{evidenceId}` — `operationId: getEvidence` (bearer).

**Behavior (FACT, evidence-storage §5, endpoint-catalog #20):**
- Returns the **active metadata** plus the **latest version** of the evidence.
- Authorization is enforced like any case-scoped resource (no looser than item GET; see `rf-list-cases` authorization filtering rule).
- A 404 indicates the evidence id is unknown or not visible to the caller.

**Caveat:** this endpoint returns the *latest* version only; it does not enumerate historical immutable versions. Version enumeration is out of scope of the catalog entry.

## Finalize Version

`POST /api/v1/evidence/{evidenceId}/versions/finalize` — `operationId: finalizeEvidenceVersion` (bearer).

**Behavior (FACT, evidence-storage §3–4, endpoint-catalog #21, flows `rf-evidence-finalize`):**
1. Auth + permission check.
2. The storage adapter verifies, against the MinIO object:
   - **object existence**
   - **size**
   - **media type**
   - **SHA-256 checksum** (client-supplied at session creation)
3. On success → activates an **immutable `EvidenceVersion`** (SHA-256 immutable via DB constraint / domain value object, `inv-evidence-sha256-immutable`, `rule-evidence-sha256-immutable`).

**Failure mapping (FACT):**
- Checksum mismatch **or** missing object → **409** via `EvidenceConflictExceptionMapper` / `EvidenceObjectMissingExceptionMapper` (`rule-checksum-mismatch-reject`, `inv-checksum-mismatch-reject`).
- Storage unavailable → **503** via `EvidenceStorageUnavailableExceptionMapper`.
- Unknown / not-finalizable evidence → 404 / 422 depending on state.

**Invariant (FACT, domain-lifecycle):** evidence referenced by a **published decision** cannot be deleted (`rule-evidence-published-decision-protected`, `inv-evidence-referenced-protected`). Finalize itself only *activates* a version; deletion protection is enforced elsewhere in the lifecycle.

## Download Session and Audit

`POST /api/v1/evidence/{evidenceId}/download-sessions` — `operationId: createEvidenceDownloadSession` (bearer).

**Behavior (FACT, evidence-storage §6, endpoint-catalog #22, business `uc-download-session`):**
1. Enforces authorization on the evidence resource (same jurisdiction / classification / conflict / unit / direct-assignment rules).
2. Returns a **presigned GET URL** with TTL `EVIDENCE_DOWNLOAD_URL_TTL`, default **PT10M**.
3. **Audits denied access** as `EvidenceDownloadDenied` (append-only `audit_event`, release 0002).
4. A **sensitive** download emits an audit event (`rule-sensitive-download-audit`, `inv-` via domain-lifecycle; `cap-audit` includes sensitive download denials).

**Caveats:**
- The presigned GET URL is short-lived (PT10M) and minted only after authorization succeeds; a denial is recorded before any URL is issued.
- Audit of *denied* access is mandatory regardless of whether a URL was produced.

## Failure and Error Mapping

All errors use the RFC-7807-style `ErrorResponse` envelope: `type / title / status / code / detail / instance / correlationId / violations`. Mappers live under `sentinel-api/.../error/*ExceptionMapper.java` (FACT, endpoint-catalog).

**Status mapping (FACT):** `400 / 401 / 403 / 404 / 409 / 412 / 422 / 429 / 500 / 503`.

| Status | Evidence-specific mapper / cause | Trigger in Evidence API |
|---|---|---|
| 400 | generic validation mapper | malformed request body |
| 401 | auth filter | missing / invalid bearer JWT |
| 403 | authorization policy | caller lacks jurisdiction / classification / unit / direct-assignment; conflicted actor |
| 404 | not-found mapper | unknown `caseId` / `evidenceId`; not visible to caller |
| 409 | `EvidenceConflictExceptionMapper`, `EvidenceObjectMissingExceptionMapper` | finalize SHA-256 mismatch or missing object (also optimistic-lock conflicts elsewhere) |
| 412 | precondition mapper | expected-version precondition failure (shared pattern) |
| 422 | unprocessable mapper | finalize against non-finalizable state |
| 429 | rate-limit mapper | throttled session creation / download |
| 500 | generic server mapper | unexpected application error |
| 503 | `EvidenceStorageUnavailableExceptionMapper` | MinIO unreachable at finalize / presign time |

**Evidence-specific mappers (FACT, evidence-storage):**
- `EvidenceConflictExceptionMapper` — checksum mismatch at finalize → 409.
- `EvidenceObjectMissingExceptionMapper` — object missing at finalize → 409.
- `EvidenceStorageUnavailableExceptionMapper` — storage adapter cannot reach MinIO → 503.
- `EvidenceDownloadDenied` — audit event recorded on denied download (not an HTTP mapper; side-effect on 403 path).

## Sequence: Upload / Finalize / Download

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant A as sentinel-api (app)
    participant DB as PostgreSQL
    participant M as MinIO (sentinel-evidence)

    Note over C,A: Upload Session
    C->>A: POST /api/v1/cases/{caseId}/evidence/upload-sessions
    A->>A: verify permission (jurisdiction/classification/conflict/unit)
    A->>DB: insert pending EvidenceUploadSession metadata
    A-->>C: 200 + presigned PUT URL (TTL PT15M)

    Note over C,M: Direct object upload
    C->>M: PUT object (key /{jurisdiction}/{caseId}/{evidenceId}/{version}/{generatedFileName})

    Note over C,A: Finalize Version
    C->>A: POST /api/v1/evidence/{evidenceId}/versions/finalize
    A->>M: verify existence / size / media type / SHA-256
    alt mismatch or missing object
        M-->>A: conflict
        A-->>C: 409 (EvidenceConflictExceptionMapper / EvidenceObjectMissingExceptionMapper)
    else storage unavailable
        M-->>A: unavailable
        A-->>C: 503 (EvidenceStorageUnavailableExceptionMapper)
    else verified
        A->>DB: activate immutable EvidenceVersion (SHA-256)
        A-->>C: 200
    end

    Note over C,A: Get Evidence
    C->>A: GET /api/v1/evidence/{evidenceId}
    A->>DB: read active metadata + latest version
    A-->>C: 200 (metadata + latest version)

    Note over C,A,M: Download Session and Audit
    C->>A: POST /api/v1/evidence/{evidenceId}/download-sessions
    A->>A: enforce authorization
    alt denied
        A->>DB: audit EvidenceDownloadDenied
        A-->>C: 403
    else authorized
        A-->>C: 200 + presigned GET URL (TTL PT10M)
        C->>M: GET object
    end
```

## Coverage tags

`endpoint-catalog`, `request-flow`, `data-model`, `security`

## Related pages

- [Endpoint Catalog](../api/endpoint-catalog.md) — full operationId / auth matrix.
- [Evidence Lifecycle](../evidence/evidence-lifecycle.md) — aggregate states and transition invariants.
- [MinIO Evidence Storage](../runbooks/minio-evidence-storage.md) — bucket bootstrap and storage runbook.
- [Observability](../operations/observability.md) — correlation ids, audit events, and error telemetry.
