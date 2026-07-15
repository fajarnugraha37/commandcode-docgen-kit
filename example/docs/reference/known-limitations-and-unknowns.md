# Known Limitations and Unknowns

> **Reference / Coverage:** `architecture`, `operations`, `configuration`
> **Related pages:** [Testing Strategy](./../testing-strategy.md), [Camunda Workflow](./../camunda-workflow.md), [Deployment Topology](./../deployment-topology.md), [Module Overview](./../module-overview.md)

This page honestly surfaces gaps, inferences, and unknowns in the Sentinel Enforcement Platform documentation. Every item is **classified** as `FACT`, `INFERENCE`, or `UNKNOWN` and carries an explicit evidence reference.

- **FACT** — directly evidenced in current evidence artifacts (`domain-lifecycle`, `testing-strategy`, `workflow-camunda`, `module-catalog`, `deployment-topology`, `system.json`, `business.json`).
- **INFERENCE** — a reasonable conclusion not directly evidenced.
- **UNKNOWN** — a dependency or presence not confirmed by any evidence.

---

## Fact-Backed Gaps

These items are directly evidenced in the current evidence artifacts. They represent concrete, documented gaps in the platform's implementation, testing, or lifecycle coverage.

| Gap ID | Classification | Description | Evidence |
| --- | --- | --- | --- |
| `gap-enforcement-monitoring` | FACT | Enforcement-monitoring detail is incomplete. | `system.json` → `unknowns.gaps`; `business.json` → `unknown-enforcement-monitoring` (`domain-lifecycle`) |
| `gap-later-state-prerequisites` | FACT | Later-state prerequisites are lighter than the master target. | `system.json` → `unknowns.gaps`; `business.json` → `unknown-later-state-prerequisites` (`testing-strategy`, `domain-lifecycle`) |
| `gap-workflow-start-outbox` | FACT | Workflow-start uses compensation rather than an outbox-backed start intent. | `system.json` → `unknowns.gaps`; `business.json` → `unknown-workflow-start-compensation` (`testing-strategy`, `workflow-camunda`) |
| `gap-load-perf-review` | FACT | Load/performance review is outstanding. | `system.json` → `unknowns.gaps`; `business.json` → `unknown-load-perf-review` (`testing-strategy`) |
| `unknown-load-perf-review` (extended) | FACT | Load/performance review **plus** failure-injection and metrics/dashboards are outstanding. | `business.json` → `unknown-load-perf-review` |
| `mailpit-notification-target` | UNKNOWN | Mailpit notification target not evidenced; `notification.command.v1` / `notification.result.v1` consumer sink not confirmed. | `deployment-topology` (lists postgres/kafka/minio/keycloak app; no mailpit sink); `messaging-topics` (notification topics present); master prompt references mailpit but not confirmed in current topology evidence |

---

## Inference Items

These items are reasonable conclusions drawn from the evidence but are **not directly evidenced** in any single artifact.

| Item ID | Classification | Description | Evidence |
| --- | --- | --- | --- |
| `gap-ownership-assignment` | INFERENCE | Module ownership is not explicitly assigned. | `system.json` → `unknowns.gaps` (`module-catalog`) |
| `unknown-module-ownership` | INFERENCE | Module ownership not explicitly assigned; no `CODEOWNERS` evidenced. | `business.json` → `unknown-module-ownership` (`module-catalog`) |

> **Inferred semantics:** The absence of an explicit ownership map in `module-catalog` and the lack of a `CODEOWNERS` file suggest ownership is either implicit (by directory) or unassigned. This is an inference, not a confirmed fact — see [Module Overview](./../module-overview.md) for the current module inventory.

---

## Unknown Dependencies

These are dependencies or system presences **not confirmed by any current evidence**. They may exist (e.g., referenced in the master prompt) but are absent from the verified topology / model artifacts.

| Dependency | Classification | Description | Evidence |
| --- | --- | --- | --- |
| `unknown-redis-usage` | UNKNOWN | Redis usage is not seen in evidence; its presence as a cache or runtime dependency is UNKNOWN. | `business.json` → `unknown-redis-usage` (`deployment-topology`, `system.json`) |
| `mailpit-notification-target` | UNKNOWN | Mailpit notification sink not evidenced in `deployment-topology`; notification consumer target unconfirmed. | `deployment-topology`, `messaging-topics`, master prompt (unconfirmed) |

> **Caveat:** `deployment-topology` explicitly lists `postgres`, `kafka`, `minio`, and `keycloak` as the app topology. Redis and Mailpit are **not** in that list. Until confirmed by topology evidence, treat both as UNKNOWN rather than assumed dependencies.

---

## Gap → Classification → Evidence → Impact

The table below consolidates **all** gaps, inferences, and unknowns from the evidence, with their classification, evidence reference, and documentation impact.

| Gap / Item | Classification | Evidence | Impact |
| --- | --- | --- | --- |
| `gap-enforcement-monitoring` / `unknown-enforcement-monitoring` | FACT | `system.json` → `unknowns.gaps`; `business.json` → `unknown-enforcement-monitoring` (`domain-lifecycle`) | Enforcement-monitoring lifecycle is not fully documented; operators lack a confirmed monitoring/observability contract for enforcement state transitions. |
| `gap-later-state-prerequisites` / `unknown-later-state-prerequisites` | FACT | `system.json` → `unknowns.gaps`; `business.json` → `unknown-later-state-prerequisites` (`testing-strategy`, `domain-lifecycle`) | Later-state prerequisites are documented as lighter than the master target; downstream state-transition guarantees are not verifiable against the master specification. |
| `gap-workflow-start-outbox` / `unknown-workflow-start-compensation` | FACT | `system.json` → `unknowns.gaps`; `business.json` → `unknown-workflow-start-compensation` (`testing-strategy`, `workflow-camunda`) | Workflow-start reliability is compensation-based, not outbox-backed; see [Camunda Workflow](./../camunda-workflow.md) for the start-intent pattern in use and its delivery guarantees. |
| `gap-load-perf-review` / `unknown-load-perf-review` | FACT | `system.json` → `unknowns.gaps`; `business.json` → `unknown-load-perf-review` (`testing-strategy`) | Load/performance targets are unverified; failure-injection and metrics/dashboards are outstanding. See [Testing Strategy](./../testing-strategy.md) for uncovered non-functional test scope. |
| `gap-ownership-assignment` / `unknown-module-ownership` | INFERENCE | `system.json` → `unknowns.gaps` (`module-catalog`); `business.json` → `unknown-module-ownership` | Module ownership is partly inferred; the [Module Overview](./../module-overview.md) cannot assert a definitive owner-per-module map, and no `CODEOWNERS` is referenced. |
| `unknown-redis-usage` | UNKNOWN | `business.json` → `unknown-redis-usage` (`deployment-topology`, `system.json`) | Redis cache patterns are undocumented because Redis presence is unconfirmed; any cache-invalidation or session-runtime documentation would be speculative. |
| `mailpit-notification-target` | UNKNOWN | `deployment-topology`, `messaging-topics`, master prompt (unconfirmed) | Notification delivery target is undocumented; `notification.command.v1` / `notification.result.v1` consumer sink cannot be asserted from current topology evidence. |

---

## Impact on Documentation

Each gap below limits the current documentation in a specific, concrete way. This section explains **how** the docs are constrained by the evidence gaps.

### Enforcement-monitoring lifecycle not fully documented
`gap-enforcement-monitoring` (FACT) means the enforcement-monitoring detail is incomplete in `domain-lifecycle`. The current docs cannot present a verified monitoring/observability contract for enforcement state transitions — operators must treat monitoring behavior as partially specified.

### Later-state prerequisites lighter than master target
`gap-later-state-prerequisites` (FACT) means documentation of later-state prerequisites is intentionally lighter than the master target. Downstream state-transition guarantees are described but **not** verifiable against the master specification, so readers should not assume master-level coverage for later states.

### Workflow-start uses compensation, not outbox
`gap-workflow-start-outbox` (FACT) is documented in [Camunda Workflow](./../camunda-workflow.md) as a compensation-based start intent rather than an outbox-backed start intent. The documentation reflects the compensation pattern and its weaker delivery guarantee; an outbox-backed design is **not** evidenced.

### Performance targets unverified
`gap-load-perf-review` + `unknown-load-perf-review` (FACT) mean load/performance review, failure-injection, and metrics/dashboards are outstanding per [Testing Strategy](./../testing-strategy.md). No performance targets are verified by evidence, so any throughput/latency claims in docs would be unsubstantiated.

### Module ownership partly inferred
`gap-ownership-assignment` / `unknown-module-ownership` (INFERENCE) means module ownership is not explicitly assigned and no `CODEOWNERS` is evidenced. The [Module Overview](./../module-overview.md) presents the module inventory but cannot assert a definitive owner-per-module map — ownership is inferred, not confirmed.

### Redis cache patterns undocumented
`unknown-redis-usage` (UNKNOWN) means Redis presence is unconfirmed in `deployment-topology` and `system.json`. Because Redis is not evidenced, cache patterns, invalidation, and runtime-dependency behavior are **not** documented — any such content would be speculative rather than evidence-based.

### Notification delivery target undocumented
`mailpit-notification-target` (UNKNOWN) means the `notification.command.v1` / `notification.result.v1` consumer sink is not evidenced in `deployment-topology` (which lists postgres/kafka/minio/keycloak). Although the master prompt references Mailpit, the current topology evidence does not confirm it. Notification delivery documentation therefore stops at the topic level and cannot assert a concrete sink.

### Reconciliation / known-limitations partly inferred
Because ownership and Redis usage are INFERENCE / UNKNOWN respectively, the reconciliation of module responsibilities and runtime dependencies is **partly inferred**. This known-limitations page itself is the honest boundary: items beyond FACT classification are flagged rather than asserted as confirmed platform behavior.
