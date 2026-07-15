---
id: module-bootstrap
title: Module: sentinel-bootstrap
module: sentinel-bootstrap
layer: assembly
boundedContext: enforcement-bootstrap
coverageTags: [architecture, configuration, operations]
relatedPages:
  - module-overview
  - configuration
  - local-development
  - deployment-topology
evidence:
  - .docgen/evidence/module-catalog.md
  - .docgen/evidence/build-reactor.md
  - .docgen/evidence/deployment-topology.md
models:
  - .docgen/model/system.json
classification: FACT
---

# Module: sentinel-bootstrap

`sentinel-bootstrap` is the **assembly** module — the application entry point. It loads configuration,
binds all modules via HK2, runs the Liquibase (app) and Camunda schema migrations as separate mains,
starts the embedded Jetty/Jersey server, exposes the `/health` endpoint, and owns process lifecycle.

> **Reading depth guide**
> - **Newcomer:** *Responsibility and Boundaries* + the wiring flowchart show how everything is stitched at startup.
> - **Maintainer:** the *Wiring responsibility table* is your map of which module each binder wires.
> - **Expert:** *Migration Mains* + *Health and Lifecycle* cover the exact-match issuer, schema-order, and healthcheck contract.

---

## Responsibility and Boundaries

| Aspect | Value (FACT) |
|---|---|
| Module id | `sentinel-bootstrap` |
| Layer | `assembly` |
| Bounded Context | `enforcement-bootstrap` |
| Key source | `com/sentinel/enforcement/bootstrap/**` |
| Responsibility | Entry point, HK2 binder, config loading, Liquibase/Camunda migration mains, health |
| Build | Maven 3.9+ reactor, `maven.compiler.release=21`, `maven-shade-plugin` produces runnable artifact (`build-reactor.md`) |
| Wires | `sentinel-api`, `sentinel-application`, `sentinel-domain`, `sentinel-persistence`, `sentinel-messaging`, `sentinel-storage`, `sentinel-workflow`, `sentinel-security` (`assembly` edges in `system.json`) |

The bootstrap module has **no business logic** of its own; it depends on every other module as an
assembly concern and exists to compose them. Domain layering invariant (`system.json`
`layeringInvariant`) is preserved: `domain <- application <- api`, and bootstrap sits above all of them.

---

## Wiring and HK2 Binder

The module uses **HK2** (Jersey's DI container) to bind every module's implementations to its ports.
All module dependencies are `assembly`-typed edges (`system.json` `moduleDependencies.edges`):
bootstrap → api/application/domain/persistence/messaging/storage/workflow/security.

### Bootstrap wiring of modules (flowchart)

```mermaid
flowchart TD
    MAIN[Main entry point] --> CFG[Configuration Loading: env vars]
    CFG --> BIND[HK2 Binder: bind all module ports/impls]
    BIND --> DOM[sentinel-domain]
    BIND --> APP[sentinel-application]
    BIND --> API[sentinel-api: Jersey resources]
    BIND --> PER[sentinel-persistence: MyBatis + Liquibase changelog]
    BIND --> MSG[sentinel-messaging: Kafka outbox/inbox]
    BIND --> STO[sentinel-storage: MinioEvidenceStorageAdapter]
    BIND --> WF[sentinel-workflow: Camunda ProcessEngine]
    BIND --> SEC[sentinel-security: RoleBasedAuthorizationService]
    MAIN --> MIG[Run migration mains: Liquibase app + CamundaSchemaMigrator]
    MIG --> SRV[Start Jetty/Jersey server on HTTP_PORT]
    SRV --> HEALTH[/health endpoint]
    HEALTH --> HC[Compose healthcheck curls /health]
```

---

## Configuration Loading

Configuration is loaded from environment variables (FACT, `deployment-topology.md`). Key groups:

| Env group | Examples | Notes |
|---|---|---|
| Server | `HTTP_PORT` | Jersey server bind port |
| Database | `DB_URL`, `DB_USER`, `DB_PASSWORD` | PostgreSQL 18.3-alpine; Hikari 6.3.0 pool |
| Kafka | `KAFKA_BOOTSTRAP_SERVERS`, `OUTBOX_POLL_INTERVAL` (PT2S), `OUTBOX_LEASE_DURATION` (PT30S), `OUTBOX_BATCH_SIZE` (20), `NOTIFICATION_CONSUMER_GROUP_ID`, `NOTIFICATION_MAX_RETRIES` (3) | Outbox lease uses `APP_INSTANCE_ID` as owner |
| MinIO | `MINIO_*` | Bucket default `sentinel-evidence`; `EVIDENCE_UPLOAD_URL_TTL` (PT15M) / `EVIDENCE_DOWNLOAD_URL_TTL` (PT10M), ISO-8601 |
| Keycloak | `KEYCLOAK_ISSUER`, `KEYCLOAK_AUDIENCE`, `KEYCLOAK_JWKS_URL` | Exact-match issuer; app JWKS via `host.docker.internal` |
| Workflow | `WORKFLOW_ENGINE_NAME`, `WORKFLOW_INVESTIGATION_ESCALATION_DURATION` (PT30M) | Camunda engine name + escalation timer |
| Identity | `APP_INSTANCE_ID` | Outbox lease owner; instance correlation |

> **Caveat (exact-match issuer):** Keycloak issuer is `http://localhost:{KEYCLOAK_PORT}/realms/sentinel`.
> Verification is exact-match, so the app and Keycloak must agree on `localhost` (README troubleshooting,
> `deployment-topology.md`). A mismatch breaks all JWT verification → 401 on every request.

---

## Migration Mains (Liquibase/Camunda)

Migrations run as **separate mains** before the app serves traffic (`deployment-topology.md` developer
loop: `make migrate` runs "app + Camunda schema, then start app"; `build-reactor.md` lists
`exec-maven-plugin` + `maven-shade-plugin`):

| Migration | Tool | Trigger | Detail |
|---|---|---|---|
| App schema | **Liquibase 4.31.1** | `make migrate` → Liquibase main | 7 releases (`system.json` `liquibaseReleaseCount`); `db.changelog-master.yaml` |
| Camunda schema | **CamundaSchemaMigrator** | `make migrate` → before app start | `databaseSchemaUpdate=false`; `ACT_*` migrated before `ProcessEngine` starts (`workflow-camunda.md`, ADR-002) |

Order matters: Liquibase app schema and Camunda schema must both be current **before** the Jetty/Jersey
server starts accepting requests. `make migrate` also supports `rollback ROLLBACK_COUNT=n`,
`db-status`, `db-shell` (`build-reactor.md`).

---

## Health and Lifecycle

- **Server:** The app is built from `Dockerfile` as a **non-root** container (`deployment-topology.md`).
- **Health endpoint:** `/health` is exposed; the Compose **healthcheck curls `/health`** to determine
  readiness (`deployment-topology.md` developer loop).
- **Lifecycle order (FACT, developer loop):**
  1. `make bootstrap` (one-time setup)
  2. `make up` (start postgres/kafka/minio/minio-init/keycloak/app)
  3. `make migrate` (app + Camunda schema, then start app)
  4. `make seed` (default users: intake-jkt/bdg, triage-jkt/bdg, investigator-jkt, reviewer-jkt,
     decision-jkt, appeal-jkt, supervisor-jkt (+unit-2), auditor-jkt, system-admin — all `sentinel`)
  5. `make smoke-test`

### Wiring responsibility table

| Concern | Owner (module) | Wired by bootstrap via |
|---|---|---|
| Domain aggregates/policies | `sentinel-domain` | HK2 binder (no infra deps) |
| Command/query handlers, ports | `sentinel-application` | HK2 binder |
| Jersey resources, DTOs, auth filters | `sentinel-api` | HK2 binder (server) |
| MyBatis mappers, Liquibase changelog | `sentinel-persistence` | HK2 binder + Liquibase main |
| Kafka outbox/inbox, retry/DLQ | `sentinel-messaging` | HK2 binder |
| MinIO adapter, presigned URLs | `sentinel-storage` | HK2 binder |
| Camunda engine, BPMN, delegates | `sentinel-workflow` | HK2 binder + CamundaSchemaMigrator main |
| JWT verification, authorization policy | `sentinel-security` | HK2 binder (auth filter) |
| App + Camunda schema migration | `sentinel-bootstrap` | Liquibase main + CamundaSchemaMigrator main |
| `/health` + Jetty/Jersey startup | `sentinel-bootstrap` | Server bootstrap |

### Cross-links

- [Module Overview](module-overview.md) — bootstrap's assembly role in the 10-module reactor.
- [Configuration](configuration.md) — full env-var reference and loading.
- [Local Development](local-development.md) — `make bootstrap/up/migrate/seed/smoke-test` loop.
- [Deployment Topology](deployment-topology.md) — Compose services, healthcheck, Keycloak issuer.
