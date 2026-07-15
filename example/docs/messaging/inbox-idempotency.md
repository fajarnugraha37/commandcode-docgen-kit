# Inbox Idempotency

Consumer-side deduplication guarantees that a delivered event produces **at most one**
business side effect. This page documents how the notification-result consumer uses a
relational inbox table to make duplicate Kafka delivery harmless.

- **Audience:** engineer, architect, operator
- **Coverage tags:** `event-flow`, `message-handler-catalog`, `data-flow`
- **Related pages:** [Message Handler Catalog](../catalogs/message-handler-catalog.md),
  [Outbox Reliability](../messaging/outbox-reliability.md),
  [Event Flows](../flows/event-flows.md),
  [Operations Runbooks](../runbooks/operations-runbooks.md)

---

## 1. Pattern and Rationale (ADR-005)

**ADR-005 = `inbox-idempotency`** — Inbox dedup via `UNIQUE(consumer_name, event_id)`.

Kafka delivery semantics are *at-least-once*: the broker may redeliver a record after a
rebalance, a consumer crash, or a commit timeout. Without consumer-side protection, a
redelivered `notification.result.v1` event could produce a second `notification` side
effect (a duplicate email/SMS/push), which is a correctness and recipient-trust defect.

The chosen pattern (FACT, ADR-005 + `messaging-topics.md`) is the **transactional inbox**:

> One `eventId` ⇒ one business side effect **per consumer**, per domain-lifecycle invariant
> **`inv-one-side-effect-per-event`**.

The `inbox_event` row and the business side effect are written inside the **same database
transaction**. The database unique constraint — not application logic — is the authority
that decides whether an event is new or a duplicate. This is the consumer-side mirror of the
producer-side transactional outbox (ADR-004): the outbox makes publishing safe against
duplicate *publish*, the inbox makes consuming safe against duplicate *delivery*.

Consequences (from ADR-005 + catalog):
- Dedup is enforced by PostgreSQL, not by in-memory state, so it survives restarts and
  multiple app instances.
- The constraint is per-`consumer_name`, so different consumers may each process the same
  `event_id` independently (relevant if more consumers subscribe to `notification.result.v1`).

---

## 2. Inbox Write Path

The data flow `df-notification-result-inbox` describes the path:

> `kafka (notification.result.v1)` → `sentinel-application (notification side effect)`

Ownership: `sentinel-messaging` (`KafkaNotificationConsumer`, `NotificationEventHandler`);
persistence: `inbox_event` + `notification` tables (release 0005).

Within a single consumer transaction the order is:

1. `KafkaNotificationConsumer` receives a record from `notification.result.v1`.
2. `InboxRepositoryMyBatisAdapter` attempts to `INSERT` an `inbox_event` row keyed by
   `(consumer_name, event_id)`.
3. If the insert succeeds, `NotificationEventHandler` produces the `notification` side
   effect and the row is marked `processed_at`.
4. If the insert violates `UNIQUE(consumer_name, event_id)`, the event is a duplicate and
   the transaction short-circuits with **no side effect**.

### Inbox constraint table

The `inbox_event` table is created in release 0005 (`0005-messaging.yaml`) alongside
`outbox_event` and `notification`. Columns and the dedup constraint:

| Column | Role | Notes |
|---|---|---|
| `id` | Primary key (UUID) | Per foundation changelog convention: UUID PKs. |
| `consumer_name` | Dedup partition key | Identifies the consuming handler; part of the unique constraint. |
| `event_id` | Source event identity | The Kafka record's event id; part of the unique constraint. |
| `processed_at` | Completion marker | Set when the side effect has been produced. |
| `result_reference` | Correlation back to side effect | References the produced `notification` row. |

**Constraint:** `UNIQUE(consumer_name, event_id)`.

**Transaction invariant:** the `inbox_event` insert and the `notification` side effect are
written in the **same transaction**. Either both commit or both roll back — there is never a
committed inbox row without its side effect, nor a side effect without its dedup row.

---

## 3. Duplicate Delivery Handling

Because the dedup decision is delegated to the unique constraint, redelivery is mechanically
safe:

- **First delivery** of `(consumer_name, event_id)` → insert succeeds → side effect produced
  once → `processed_at` set.
- **Duplicate delivery** of the same `(consumer_name, event_id)` → insert throws a unique-
  violation → the consumer treats it as already-handled → **no second side effect**.

The invariant `inv-one-side-effect-per-event` is therefore satisfied by construction: the
database refuses the second row, so `NotificationEventHandler` never runs a second time for
that event.

> Caveat (operator): the constraint is per `consumer_name`. If a *new* consumer name is
> configured for the same topic, its first delivery is treated as new and will produce a
> side effect. Duplicate *delivery* is absorbed; duplicate *consumers* are not.

The `ef-notification-result` event flow confirms the contract:

> `idempotency`: `inbox_event UNIQUE(consumer_name, event_id)`; at most one notification
> side effect per event.

---

## 4. Retry and Dead-Letter

Side-effect processing can still fail (e.g., downstream notification target unavailable,
transient SQL error). Failures are routed through Kafka retry/DLQ topics, governed by env-
configured settings.

### Retry/DLQ config table

| Setting | Default / Source | Behavior |
|---|---|---|
| `NOTIFICATION_MAX_RETRIES` | **3** (default) | Max retries before dead-lettering. |
| `NOTIFICATION_CONSUMER_GROUP_ID` | configured via env | Consumer group identity for `notification.result.v1`. |
| `.retry` topic | derived topic | Receives the record while failure count is **under** `NOTIFICATION_MAX_RETRIES`. |
| `.dlq` topic | derived topic | Receives the record once retries are **exceeded** (`> NOTIFICATION_MAX_RETRIES`). |

Flow (`ef-notification-result`):

> `retry`: retry/DLQ via `NOTIFICATION_MAX_RETRIES=3` and `NOTIFICATION_CONSUMER_GROUP_ID`;
> `dlq`: `.dlq` topic.

Notes for operators:
- The retry count is tracked per record (Kafka dead-letter semantics), independent of the
  inbox dedup. A record that exhausts retries lands in `.dlq` for manual inspection —
  see [Operations Runbooks](../runbooks/operations-runbooks.md).
- A redelivered record from `.retry` still passes through the inbox dedup path, so a
  recovered retry never double-produces a side effect once it has already committed.

---

## 5. Failure Scenarios

| Scenario | What happens | Side-effect outcome |
|---|---|---|
| Normal first delivery | Insert succeeds, handler runs, `processed_at` set. | Exactly one `notification`. |
| Duplicate delivery (same `consumer_name`, `event_id`) | `UNIQUE` violation → dedup short-circuit. | **Zero** additional side effects (at most one total). |
| Transient handler failure, retry ≤ 3 | Routed to `.retry`; re-consumed; passes inbox dedup if prior attempt did not commit. | At most one `notification` (committed exactly once). |
| Handler failure, retries exceeded | Routed to `.dlq`. | No side effect from DLQ path unless operator republishes. |
| Consumer crash after side effect, before commit | Whole tx rolls back → inbox row absent → redelivery re-inserts and re-produces. | One side effect after redelivery (no permanent loss). |
| Consumer crash after commit | Redelivery hits `UNIQUE` → deduped. | No second side effect. |
| New `consumer_name` for same topic | Constraint partition differs → first insert succeeds. | New side effect for the new consumer (by design). |

Key resilience fact (`messaging-topics.md`): a Kafka outage does **not** roll back committed
business writes; pending outbox rows remain retryable, and the inbox mirrors this on the
consumer side — a committed `inbox_event`+`notification` pair is durable, and an
uncommitted one is safely retried.

---

### Catalog / model references (traceability)

- **Evidence:** `messaging-topics.md` (inbox/idempotency, retry/DLQ, `NOTIFICATION_MAX_RETRIES`),
  `data-schema.md` (release 0005 `inbox_event`/`notification`), `adr-landscape.md` (ADR-005).
- **Models:** `flows.json` → `dataFlows.df-notification-result-inbox`,
  `eventFlows.ef-notification-result`, `controlFlows`; `catalogs.json` →
  `messageHandlers.mh-notification-result`, `mh-notification-handler`, `mh-inbox-repository`.
- **Handlers:** `KafkaNotificationConsumer`, `NotificationEventHandler`,
  `InboxRepositoryMyBatisAdapter`.
