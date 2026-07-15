# Local Development

**Page ID:** local-development
**Coverage tags:** operations, configuration
**Audience:** engineer, operator
**Module:** `sentinel-bootstrap` (entry/assembly), driven by Makefile + Docker Compose.

This page is the developer's walkthrough of the local workflow: prerequisites, bring-up sequence, build/test commands, dependency-readiness behavior, and common tasks. Everything is Docker Compose + Makefile driven; there is no separate orchestrator.

FACT basis: `deployment-topology.md`, `build-reactor.md`, `testing-strategy.md`, `Makefile`, `system.json`.

---

## 1. Prerequisites

- **Docker + Docker Compose** available locally (compose defines `postgres`, `kafka`, `minio`, `minio-init`, `keycloak`, `app`).
- **Maven 3.9+** and **Java 21** (toolchain: `maven.compiler.release=21`). The build is a 10-module reactor (`com.sentinel.enforcement:sentinel-enforcement:0.1.0-SNAPSHOT`).
- A local `.env` file (copy from `.env.example`). Do **not** commit real secrets.
- `make` available (Makefile uses `pwsh.exe` shell on Windows; `LOCAL_RUNTIME_ENV` block supplies safe defaults when env vars are unset).

### Compose services (FACT, `docker-compose.yaml`)

| Service | Version / note |
|---|---|
| `postgres` | `18.3-alpine` |
| `kafka` | `confluent-7.8.1` (KRaft single node) |
| `minio` | `RELEASE.2025-09-07` |
| `minio-init` | `mc` bucket bootstrap (creates `sentinel-evidence`) |
| `keycloak` | `26.6`, realm import `deployment/keycloak/realm/sentinel-realm.json` |
| `app` | built from `Dockerfile`, **non-root** container |
| `mailpit` | present per master prompt (local mail capture) |

> Redis is referenced in some environments but has **no evidence** in deployment topology or env (`business.json` `unknown-redis-usage`); do not assume a cache container.

---

## 2. Bring-Up Sequence

The canonical developer loop (FACT, README + Makefile):

```mermaid
flowchart TD
    A[make bootstrap] --> B[make up]
    B --> C[make migrate (app + Camunda schema, then start app)]
    C --> D[make seed (MinIO bucket init)]
    D --> E[make smoke-test (GET /health)]
    E --> F{Iterative dev loop}
    F --> G[make compile]
    G --> H[make unit-test]
    H --> I[make integration-test]
    I --> J[make verify]
    J --> F
    F --> K[make down (teardown)]
```

1. `make bootstrap` — `mvn -q -DskipTests dependency:go-offline` (restore dependencies for offline local dev).
2. `make up` — `docker compose up -d --build postgres kafka minio keycloak` then `docker compose up minio-init` (DB, broker, object store, IdP, bucket).
3. `make migrate` — install `sentinel-bootstrap`, run `DatabaseMigrationMain` (app schema **and** Camunda schema via `CamundaSchemaMigrator`, `databaseSchemaUpdate=false`), then `docker compose up -d --build app`.
4. `make seed` — re-runs idempotent local bootstrap helpers (MinIO bucket init via `minio-init`).
5. `make smoke-test` — `Invoke-RestMethod -Method Get -Uri http://localhost:8080/health` (healthcheck curls `/health`).

> Compose healthcheck curls `/health` to gate app readiness before dependent traffic.

### Default seeded users (dummy, local-only, password `sentinel`)

`intake-jkt` / `intake-bdg`, `triage-jkt` / `triage-bdg`, `investigator-jkt`, `reviewer-jkt` (+public, +conflicted variants), `decision-jkt`, `appeal-jkt`, `supervisor-jkt` (+unit-2), `auditor-jkt`, `system-admin`. These exercise every authorization path including `SYSTEM_ADMIN` short-circuit and conflict-of-interest denial.

---

## 3. Build and Test Commands

| Command | What it runs |
|---|---|
| `make compile` | `mvn -q -DskipTests compile` (all modules). |
| `make test` | `mvn -q verify` (unit + integration). |
| `make unit-test` | `mvn -q test` (unit tests only). |
| `make integration-test` | `mvn -q -pl sentinel-integration-tests -am verify` (Testcontainers PG+Kafka+MinIO+Keycloak). |
| `make workflow-test` | `mvn -q -pl sentinel-workflow -am test` + `WorkflowTaskApiIT` verify. |
| `make messaging-test` | `mvn -q -pl sentinel-integration-tests -am "-Dit.test=MessagingReliabilityIT" verify`. |
| `make e2e-test` | `mvn -q -pl sentinel-integration-tests -am verify` (phase 6 E2E slice). |
| `make verify` | `mvn -q verify` (full reactor). |
| `make package` | `mvn -q -DskipTests package` (distributable artifacts). |

### Integration test suites (`sentinel-integration-tests`, Testcontainers)

`ReportApiIT`, `CaseApiIT`, `EvidenceApiIT`, `WorkflowTaskApiIT`, `WorkflowReconciliationApiIT`, `MessagingReliabilityIT`, `ApplicationRuntimeSchemaLifecycleIT`. They cover happy paths, investigator visibility, assigned-unit/classification/conflict denial, task cursor/search/sort/dup-completion, reconciliation, outbox reliability under Kafka outage, inbox dedup, and 401/403/404/409 cases.

### Verification status (this run, `testing-strategy.md`)

- `spotless:apply` passed.
- `mvn test` passed.
- `mvn -pl sentinel-integration-tests -am verify` passed for full reactor and targeted ITs (phase 8 regression fixed a malformed MyBatis dynamic-SQL branch in case listing and stale assigned-unit unit identifiers).

### Known limitations (do not treat as regressions)

- Workflow-start still uses **compensation** rather than outbox-backed start intent.
- Later-state prerequisites are **lighter** than master target (`PhaseSevenCaseProgressionGuard` deepens but gaps remain).
- Enforcement-monitoring detail **incomplete**.
- Load/performance review + failure-injection + metrics/dashboards **outstanding**.

---

## 4. Dependency Readiness and Retries

- The application **retries with bounded exponential backoff** when a dependency (Postgres, Kafka, MinIO, Keycloak) is not yet ready. Do **not** rely on `depends_on` alone — readiness is verified at runtime, not just container start order.
- The `app` container runs as a **non-root** user; the Dockerfile is **multi-stage**.
- `make migrate` separates schema readiness (bootstrap `DatabaseMigrationMain`) from app start, so the app only comes up after both app and Camunda schemas are applied.

---

## 5. Common Tasks

| Makefile target | Description |
|---|---|
| `help` | List available targets. |
| `bootstrap` | Restore Maven dependencies offline for local dev. |
| `clean` | Remove compiled artifacts (`mvn clean`). |
| `compile` | Compile all modules. |
| `test` | Run unit + integration tests (`mvn verify`). |
| `unit-test` | Run unit tests. |
| `integration-test` | Run integration tests with Testcontainers (`-pl sentinel-integration-tests -am verify`). |
| `verify` | Run Maven `verify` (full reactor). |
| `package` | Build distributable artifacts. |
| `up` | Start postgres, kafka, minio, keycloak (+ minio-init). |
| `down` | Stop compose services. |
| `restart` | Restart compose services. |
| `reset` | `docker compose down -v` (wipe volumes). |
| `ps` | Show compose service status. |
| `logs` | Tail compose logs. |
| `app-logs` | Tail app logs (`docker compose logs -f app`). |
| `migrate` | Run app + Camunda schema migration, then start app. |
| `rollback` | Roll back latest Liquibase changesets (`ROLLBACK_COUNT=n`). |
| `db-status` | Show PostgreSQL container status. |
| `db-shell` | Open `psql` shell inside postgres container. |
| `seed` | Re-run idempotent bootstrap helpers (MinIO bucket init). |
| `smoke-test` | Call `/health` endpoint. |
| `docker-build` | Build the application image via Docker Compose. |
| `openapi-generate` | Generate OpenAPI models (`openapi-generator-maven-plugin` on `sentinel-api`). |
| `openapi-validate` | Validate `docs/api/openapi.yaml`. |
| `bpmn-validate` | Validate the embedded Camunda BPMN model (`BpmnModelValidationTest`). |
| `format` | Apply Java + POM formatting (`mvn spotless:apply`). |
| `lint` | Check formatting (`mvn spotless:check`). |
| `dependency-check` | `mvn dependency:analyze`. |

> Additional targets present in the Makefile (not in the required set but useful): `docker-push-local`, `kafka-topics`, `kafka-consume`, `kafka-produce`, `minio-init`, `keycloak-import`, `bpmn-deploy`, `db-reset`.

---

## Related pages

- [Quickstart](../orientation/quickstart.md) — first-run orientation.
- [Deployment Topology](../architecture/deployment-topology.md) — compose services and ports.
- [Testing Strategy](../architecture/testing-strategy.md) — unit/integration coverage and known limits.
- [Configuration](./configuration.md) — environment variables consumed by the local stack.

> Cross-link targets above are the canonical page locations implied by the related-page list. Adjust the relative path if a target page is renamed.
