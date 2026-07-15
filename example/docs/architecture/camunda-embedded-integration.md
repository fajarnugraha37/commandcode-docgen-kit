# Camunda Embedded Integration Assessment

## Current architecture

```text
Jersey resources
  -> application services
  -> workflow port
  -> embedded Camunda engine
  -> PostgreSQL

Application data schema:
  Liquibase changelog

Workflow schema:
  official Camunda SQL resources
```

## Current repository findings

- Jersey stack is `jakarta.*` with Jersey 3 and HK2 binder-based dependency injection.
- Embedded Camunda is bootstrapped from [WorkflowModule.java](/C:/Users/nugra/workspace/project/.jax-rs/.onboard/sentinel-workflow/src/main/java/com/sentinel/enforcement/workflow/WorkflowModule.java).
- Application bootstrap and lifecycle live in [ApplicationRuntime.java](/C:/Users/nugra/workspace/project/.jax-rs/.onboard/sentinel-bootstrap/src/main/java/com/sentinel/enforcement/bootstrap/ApplicationRuntime.java).
- Workflow correlation is stored in the application-owned `workflow_instance` table through the MyBatis adapter [WorkflowInstanceMyBatisAdapter.java](/C:/Users/nugra/workspace/project/.jax-rs/.onboard/sentinel-persistence/src/main/java/com/sentinel/enforcement/persistence/workflow/WorkflowInstanceMyBatisAdapter.java).
- Operational workflow reads use public Camunda Java API, not direct SQL to internal tables.

## Direct SQL audit for Camunda internal tables

- No operational SQL access to `ACT_RU_*`, `ACT_HI_*`, `ACT_RE_*`, `ACT_ID_*`, or `ACT_GE_*` was found in the repository.
- Runtime access now stays on public Camunda Java API only.
- Explicit schema creation remains isolated in [CamundaSchemaMigrator.java](/C:/Users/nugra/workspace/project/.jax-rs/.onboard/sentinel-bootstrap/src/main/java/com/sentinel/enforcement/bootstrap/CamundaSchemaMigrator.java), which executes official Camunda SQL resources during the migration stage and does not query internal Camunda tables for operational reads.

## Risks identified before refactor

- `databaseSchemaUpdate=true` allowed the engine to mutate schema on startup.
- App startup performed schema work inline, mixing deployment and migration concerns.
- Health only checked database reachability, not workflow readiness.
- Embedded engine lifecycle was singleton in practice, but not represented as an explicit provider/service boundary.
- Transaction semantics for `create case -> start workflow -> persist case` are still compensation-based rather than fully atomic.
- Kafka publishing for domain events now uses transactional outbox, but workflow start intent still does not.

## Target architecture

```text
migration stage
  -> Liquibase app schema
  -> official Camunda SQL schema

application startup
  -> application-scoped ProcessEngineProvider
  -> CamundaServices wrapper
  -> BPMN deployment with duplicate filtering
  -> readiness validation

runtime
  -> Jersey DTO API
  -> domain authorization
  -> application-owned workflow registry/correlation
  -> public Camunda Java API for runtime/history/tasks
```

## Files changed for this hardening step

- [ApplicationRuntime.java](/C:/Users/nugra/workspace/project/.jax-rs/.onboard/sentinel-bootstrap/src/main/java/com/sentinel/enforcement/bootstrap/ApplicationRuntime.java)
- [CamundaSchemaMigrator.java](/C:/Users/nugra/workspace/project/.jax-rs/.onboard/sentinel-bootstrap/src/main/java/com/sentinel/enforcement/bootstrap/CamundaSchemaMigrator.java)
- [WorkflowAwareHealthStatusService.java](/C:/Users/nugra/workspace/project/.jax-rs/.onboard/sentinel-bootstrap/src/main/java/com/sentinel/enforcement/bootstrap/WorkflowAwareHealthStatusService.java)
- [WorkflowModule.java](/C:/Users/nugra/workspace/project/.jax-rs/.onboard/sentinel-workflow/src/main/java/com/sentinel/enforcement/workflow/WorkflowModule.java)
- [CamundaCaseWorkflowAdapter.java](/C:/Users/nugra/workspace/project/.jax-rs/.onboard/sentinel-workflow/src/main/java/com/sentinel/enforcement/workflow/CamundaCaseWorkflowAdapter.java)
- [AbstractApiIT.java](/C:/Users/nugra/workspace/project/.jax-rs/.onboard/sentinel-integration-tests/src/test/java/com/sentinel/enforcement/integration/AbstractApiIT.java)
- [ApplicationRuntimeSchemaLifecycleIT.java](/C:/Users/nugra/workspace/project/.jax-rs/.onboard/sentinel-integration-tests/src/test/java/com/sentinel/enforcement/integration/ApplicationRuntimeSchemaLifecycleIT.java)

## Migration compatibility concerns

- This increment supports explicit creation of the current Camunda schema version used by the repository.
- Future Camunda version upgrades must run official upgrade scripts before application rollout; startup no longer performs schema mutation.
- Running instances are not automatically migrated between BPMN definition versions in this increment.
- The workflow start path still uses compensation rather than outbox/JTA-backed atomic orchestration.
