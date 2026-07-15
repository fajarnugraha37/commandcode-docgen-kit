# Module: sentinel-messaging

**Layer:** `infrastructure` &middot; **Bounded context:** `enforcement-messaging` &middot; **Module id:** `sentinel-messaging`

Deep dive into the messaging/infrastructure module: Kafka publisher/consumer, outbox polling, inbox
dedup, retry/DLQ, and the notification handler.

- **Newcomer:** This module moves business events out to Kafka and pulls notification results back in.
  It never loses an event: every business write also inserts an `outbox_event` row, and a poller ships
  those rows to Kafka. Inbound duplicates are swallowed by an `inbox_event` uniqueness constraint.
- **Maintainer:** The module is a port-adapter wired by `sentinel-application` (`df-outbox` out, `df-inbox`
  in; `application -> messaging` is `port-adapter`). Outbound work is driven by the scheduled
  `job-outbox-publisher`; inbound work by `KafkaNotificationConsumer` + `NotificationEventHandler`.
- **Expert:** See the [Class → role table](#class--role-table), the
  [internal flow diagram](#messaging-module-internal-flow), and the reliability details in
  [Reliability Guarantees](#reliability-guarantees).

Related pages: [Module Overview](../modules/module-overview.md),
[Message Handler Catalog](../messaging/message-handler-catalog.md),
[Outbox Reliability](../messaging/outbox-reliability.md),
[Inbox Idempotency](../messaging/inbox-idempotency.md).

---

## Responsibility and Boundaries

`sentinel-messaging` is an **infrastructure** module (`com/sentinel/enforcement/messaging/**`)
within bounded context `enforcement-messaging`. It owns all Kafka I/O and the transactional
outbox/inbox persistence path. Per the module catalog (FACT, `module-catalog.md`):

| Aspect | Owned by `sentinel-messaging` |
|---|---|
| Kafka producer/consumer | Yes — `KafkaOutboxPublisher`, `KafkaNotificationConsumer` |
| Outbox polling | Yes — `job-outbox-publisher` leases + publishes pending rows |
| Inbox dedup | Yes — `inbox_event` write with `UNIQUE(consumer_name, event_id)` |
| Retry/DLQ routing | Yes — `.retry` / `.dlq` topics via `NOTIFICATION_MAX_RETRIES` |
| Notification handler | Yes — `NotificationEventHandler` (at most one side effect) |

**Boundaries (FACT, `system.json` + `module-catalog.md`):**

- `sentinel-application -> sentinel-messaging` is a **port-adapter** dependency; the application layer
  issues the business write + `outbox_event` insert, then the messaging module ships it.
- Outbound ownership of the `outbox_event` table is shared: `sentinel-persistence` (Liquibase release
  **0005**) defines the table; `OutboxRepositoryMyBatisAdapter` (this module) persists/leases/marks it.
- Inbound ownership of `inbox_event` + `notification` tables is release **0005**, written by this module
  via `InboxRepositoryMyBatisAdapter` + `NotificationEventHandler`.
- The module depends on **Kafka** `confluent-7.8.1` (KRaft single node) as an external broker.
  `redis` and `mailpit` are listed as `UNKNOWN` — there is **no evidence of usage** in deployment
  topology or env (FACT, `catalogs.json` `externalDependencies`).

---

## Publisher and Consumer

### Outbound — `KafkaOutboxPublisher`

The publisher does **not** write to Kafka directly inside the business transaction. Instead, a scheduled
job (`job-outbox-publisher`) polls the `outbox_event` table and publishes leased rows.

| Attribute | Value | Source |
|---|---|---|
| Poll trigger | `OUTBOX_POLL_INTERVAL=PT2S` | `catalogs.json` `scheduledJobs` |
| Batch size | 20 rows | `cf-outbox-publisher-loop` |
| Lease mechanism | `FOR UPDATE SKIP LOCKED` | `messaging-topics.md`, `cf-outbox-publisher-loop` |
| Lease owner | `APP_INSTANCE_ID` | `messaging-topics.md` |
| Lease duration | `PT30S` | `catalogs.json`, `cf-outbox-publisher-loop` |
| Ordering key | `aggregateId` (per-aggregate ordering) | `messaging-topics.md`, `ef-*` |
| Post-publish state | row marked `PUBLISHED` | `messaging-topics.md` |
| Duplicate safety | safe against duplicate publish (idempotent mark) | `messaging-topics.md`, `catalogs.json` |

It publishes **all 7 outbound topics** from leased outbox rows:
`case.lifecycle.v1`, `case.assignment.v1`, `evidence.lifecycle.v1`, `decision.lifecycle.v1`,
`sanction.lifecycle.v1`, `appeal.lifecycle.v1`, `notification.command.v1`.

### Inbound — `KafkaNotificationConsumer` + `NotificationEventHandler`

| Step | Actor | Detail |
|---|---|---|
| Consume | `KafkaNotificationConsumer` | reads `notification.result.v1` (in) under `NOTIFICATION_CONSUMER_GROUP_ID` |
| Dedup write | `KafkaNotificationConsumer` | inserts `inbox_event` with `UNIQUE(consumer_name, event_id)` |
| Process | `NotificationEventHandler` | produces **at most one** notification side effect per event |

The consumer group id is configured via env (`NOTIFICATION_CONSUMER_GROUP_ID`); failure retry is governed
by `NOTIFICATION_MAX_RETRIES` (default **3**) routing to `.retry` then `.dlq` (see
[Retry and Dead-Letter](#retry-and-dead-letter)).

---

## Outbox/Inbox Repositories

| Repository | Table | Role | Source |
|---|---|---|---|
| `OutboxRepositoryMyBatisAdapter` | `outbox_event` (release 0005) | Persists outbox rows inside the business tx; leases pending rows with `SKIP LOCKED` owned by `APP_INSTANCE_ID`; marks `PUBLISHED` | `catalogs.json mh-outbox-repository`, `df-outbox-to-kafka` |
| `InboxRepositoryMyBatisAdapter` | `inbox_event` (release 0005) | Persists dedup rows with `UNIQUE(consumer_name, event_id)` | `catalogs.json mh-inbox-repository`, `df-notification-result-inbox` |

- **Outbox persistence** happens in the **same DB transaction** as the business change
  (`df-outbox-to-kafka`: "business change + outbox_event insert in same tx"). The key is `aggregateId`,
  guaranteeing per-aggregate ordering on the Kafka topic.
- **Inbox persistence** is the dedup boundary: a duplicate delivery produces a unique-constraint
  collision on `(consumer_name, event_id)`, so `NotificationEventHandler` runs its side effect at most
  once per event.

### Class → role table

| Class | Role | Direction/Topic |
|---|---|---|
| `KafkaOutboxPublisher` | Publishes all out topics from leased outbox rows | out &middot; case.lifecycle.v1, case.assignment.v1, evidence.lifecycle.v1, decision.lifecycle.v1, sanction.lifecycle.v1, appeal.lifecycle.v1, notification.command.v1 |
| `KafkaNotificationConsumer` | Consumes `notification.result.v1`, writes `inbox_event` | in &middot; notification.result.v1 |
| `NotificationEventHandler` | Processor, at most one notification side effect per event | in &middot; notification.result.v1 |
| `OutboxRepositoryMyBatisAdapter` | Leases/marks `outbox_event` in business tx, `SKIP LOCKED`, `APP_INSTANCE_ID` lease | out &middot; outbox_event (all out topics) |
| `InboxRepositoryMyBatisAdapter` | Persists `inbox_event` `UNIQUE(consumer_name,event_id)` | in &middot; inbox_event (notification.result.v1) |

---

## Retry and Dead-Letter

Retry/DLQ routing is uniform across event flows (FACT, `flows.json` `eventFlows` + `messaging-topics.md`):

| Mechanism | Value / Topic | Notes |
|---|---|---|
| Transient failure topic | `.retry` | failures routed here first |
| Exhausted-retry topic | `.dlq` | repeated failure after max retries |
| `NOTIFICATION_MAX_RETRIES` | default **3** | env-configured; applies to `notification.command.v1` and `notification.result.v1` |
| `NOTIFICATION_CONSUMER_GROUP_ID` | env-configured | consumer group for `notification.result.v1` |

- All outbound event flows (`ef-case-lifecycle` … `ef-appeal-lifecycle`, `ef-notification-command`)
  declare retry `.retry topic` and DLQ `.dlq topic`.
- `ef-notification-result` (inbound) uses `NOTIFICATION_MAX_RETRIES=3` + `NOTIFICATION_CONSUMER_GROUP_ID`
  for retry/DLQ; idempotency is enforced by `inbox_event UNIQUE(consumer_name, event_id)`.
- Ordering is preserved per `aggregateId`/`caseId` key on every flow.

**Runbooks** (FACT, `messaging-topics.md`):
- [Outbox stuck](../runbooks/outbox-stuck.md)
- [Dead-letter events](../runbooks/dead-letter-events.md)
- [Kafka backlog](../runbooks/kafka-backlog.md)

---

## Reliability Guarantees

| Guarantee | How it is achieved | Evidence |
|---|---|---|
| No lost business events | business change + `outbox_event` insert in same DB tx | `messaging-topics.md`, `df-outbox-to-kafka` |
| No duplicate outbound publish | `SKIP LOCKED` lease (`APP_INSTANCE_ID`, `PT30S`) + idempotent `PUBLISHED` mark | `messaging-topics.md`, `cf-outbox-publisher-loop` |
| At-most-once inbound side effect | `inbox_event UNIQUE(consumer_name, event_id)` | `messaging-topics.md`, `df-notification-result-inbox` |
| Per-aggregate ordering | publish key = `aggregateId`/`caseId` | `messaging-topics.md`, `ef-*` |
| Kafka outage ≠ data loss | outage does **not** roll back committed business writes; pending outbox rows remain retryable | `messaging-topics.md` (verified by `MessagingReliabilityIT`) |

**Caveats / inferences:**
- `redis` and `mailpit` appear in `catalogs.json` external dependencies but with `UNKNOWN` version/role
  and **no evidence of usage** — treat any caching or mail-target behavior as unverified.
- The `SKIP LOCKED` lease `PT30S` bounds how long a row is held by one instance; a crashed instance
  releases its lease after `PT30S`, after which another instance can republish (safe due to the
  `PUBLISHED` mark).
- Module ownership is not explicitly assigned (`gap-ownership-assignment`, INFERENCE in `system.json`);
  treat ownership as implicit.

---

## Messaging module internal flow

```mermaid
flowchart TD
    subgraph Business["Business transaction (sentinel-application)"]
        BC["Business change + outbox_event insert (same DB tx, key=aggregateId)"]
    end

    subgraph Outbound["Outbound — KafkaOutboxPublisher (job-outbox-publisher)"]
        POLL["Poll pending outbox rows\nOUTBOX_POLL_INTERVAL=PT2S, batch 20"]
        LEASE["Lease FOR UPDATE SKIP LOCKED\nowner=APP_INSTANCE_ID, duration PT30S"]
        PUB["Publish to Kafka out topics\nkey=aggregateId"]
        MARK["Mark row PUBLISHED\n(safe against duplicate publish)"]
        RETRY_O["publish failure\n-> .retry topic"]
        DLQ_O["exhausted (NOTIFICATION_MAX_RETRIES=3)\n-> .dlq topic"]
    end

    subgraph Inbound["Inbound — notification.result.v1"]
        CONS["KafkaNotificationConsumer\nconsume notification.result.v1"]
        INBOX["InboxRepositoryMyBatisAdapter\nwrite inbox_event UNIQUE(consumer_name, event_id)"]
        DEDUP{"Duplicate delivery?"}
        HANDLER["NotificationEventHandler\nat most one notification side effect"]
        NOTIF["notification"]
        RETRY_I["failure -> .retry topic"]
        DLQ_I["exhausted (NOTIFICATION_MAX_RETRIES=3)\n-> .dlq topic"]
    end

    BC --> POLL
    POLL --> LEASE
    LEASE --> PUB
    PUB --> MARK
    PUB -.failure.-> RETRY_O
    RETRY_O -.exhausted.-> DLQ_O

    CONS --> INBOX
    INBOX --> DEDUP
    DEDUP -->|no| HANDLER
    DEDUP -->|yes (unique collision)| NOTIF
    HANDLER --> NOTIF
    HANDLER -.failure.-> RETRY_I
    RETRY_I -.exhausted.-> DLQ_I
```
