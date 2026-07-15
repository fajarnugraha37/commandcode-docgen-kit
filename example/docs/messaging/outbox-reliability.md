# Transactional Outbox Reliability

How a business commit in `sentinel-application` and a Kafka publish stay consistent
without a distributed transaction. The pattern is recorded as **ADR-004 = transactional-outbox**
(Outbox + SKIP LOCKED publisher for Kafka reliability).

**Coverage tags:** `event-flow`, `data-flow`, `message-handler-catalog`, `persistence`

**Read this if you are:**
- **Engineer** — you own a command that mutates an aggregate and need the event to appear on Kafka.
- **Architect** — you are evaluating the consistency/availability trade-off under broker failure.
- **Operator** — you run the publisher and need to reason about stuck rows, leases, and backlog.

The core invariant: a domain change and its `outbox_event` insert happen in the **same DB
transaction** (`df-outbox-to-kafka`, source `sentinel-application` → sink `kafka`, persistence
`outbox_event` table release 0005). Either both commit or both roll back. Publication to Kafka is
then a separate, retryable step that never reverses the business write.

---

## Pattern and Rationale (ADR-004)

Per **ADR-004 (transactional-outbox)**: a dual-write to a relational store and a broker is unsafe
because a commit on one side followed by a crash leaves the two sides inconsistent. The chosen
mitigation is the **transactional outbox** — the business change and an `outbox_event` insert are
written in the same local transaction (`FOR UPDATE SKIP LOCKED` is used later only at publish time,
not at insert time).

Key facts from the messaging-topics evidence:

- Business change + `outbox_event` insert in **same DB tx**.
- `key=aggregateId` is used for **per-aggregate ordering**.
- A `KafkaOutboxPublisher` leases pending rows with `FOR UPDATE SKIP LOCKED`, publishes, and marks
  `PUBLISHED`.
- The outbox is **safe against duplicate publish**; `APP_INSTANCE_ID` is the lease owner.
- Kafka outage does **not** roll back committed business writes; pending outbox rows remain
  retryable (verified by `MessagingReliabilityIT`, testing-strategy evidence).

This pairs with **ADR-005 (inbox-idempotency)** for the inbound side: consumers dedup via
`UNIQUE(consumer_name, event_id)`. The two ADRs together give at-least-once delivery with
at-most-once effect.

| Concern | ADR-004 mechanism | Evidence |
|---|---|---|
| Atomic capture of intent | Same-tx domain change + `outbox_event` insert | `df-outbox-to-kafka`, messaging-topics |
| At-least-once delivery | Polling publisher marks `PUBLISHED` only after send | `cf-outbox-publisher-loop` |
| Per-aggregate ordering | `key=aggregateId` (topic key) | messaging-topics, `eventFlows` |
| Crash isolation | Lease (`FOR UPDATE SKIP LOCKED`) owned by `APP_INSTANCE_ID` | messaging-topics, `cf-outbox-publisher-loop` |
| Broker-down tolerance | Outbox not rolled back; pending rows retry | messaging-topics, `MessagingReliabilityIT` |

---

## Publisher Loop and Leasing

The publisher is a scheduled job (`job-outbox-publisher`, catalog `scheduledJobs`) implemented by
`KafkaOutboxPublisher` in `sentinel-messaging`. It is modelled by control flow
`cf-outbox-publisher-loop` (source `sentinel-application`/`sentinel-messaging`, sink `kafka`):

1. Poll pending outbox rows (`OUTBOX_POLL_INTERVAL PT2S`, batch size 20).
2. Lease with `FOR UPDATE SKIP LOCKED` — lease owner = `APP_INSTANCE_ID`, duration `PT30S`.
3. Publish to the Kafka topic, `key=aggregateId`.
4. Mark the row `PUBLISHED`.
5. Safe against duplicate publish.

`SKIP LOCKED` lets multiple app instances poll concurrently without contending: an instance that
crashes mid-publish simply lets its lease expire (`PT30S`); another instance then re-leases the still
`PENDING` rows and retries. Because the row is only marked `PUBLISHED` after a successful send, a
crash before that point yields a re-delivery, not a lost event (see Duplicate Publish Safety).

**Publisher configuration (FACT, cf-outbox-publisher-loop + catalog scheduledJobs):**

| Setting | Value | Source |
|---|---|---|
| `OUTBOX_POLL_INTERVAL` | `PT2S` | `cf-outbox-publisher-loop`, `job-outbox-publisher` |
| Batch size | `20` | `cf-outbox-publisher-loop`, `job-outbox-publisher` |
| Lease duration | `PT30S` | `cf-outbox-publisher-loop` |
| Lease owner | `APP_INSTANCE_ID` | messaging-topics, `cf-outbox-publisher-loop` |
| Topic key | `aggregateId` | `df-outbox-to-kafka`, `eventFlows` |

**Outbox column / state table (release 0005, `outbox_event`, data-schema + messaging-topics):**

| Column | Role / notes | Source |
|---|---|---|
| `id` | UUID PK; one row per event | data-schema (release 0005) |
| `aggregate_id` | Topic key (`key=aggregateId`) for per-aggregate ordering; `case.lifecycle.v1` uses `caseId` | data-schema, messaging-topics |
| `payload` | Serialized event body published to Kafka | messaging-topics |
| `status` | State value: `PENDING` → `PUBLISHED` | messaging-topics |
| `lease_owner` | `APP_INSTANCE_ID` of the publisher that holds the row lock | messaging-topics, `cf-outbox-publisher-loop` |
| `lease_expiry` | Lease deadline; after `PT30S` another instance may re-lease | `cf-outbox-publisher-loop` |
| `created_at` | TIMESTAMPTZ insert time (table convention) | data-schema (release 0005 conventions) |
| `version` | OLC column present on every transactional table | data-schema (release 0005 conventions) |

**State values (only two exist):**

- `PENDING` — inserted in the business tx; not yet published.
- `PUBLISHED` — marked only after a successful Kafka send.

There is no explicit `FAILED` state: failures leave the row `PENDING` and retryable, with routing to
`.retry`/`.dlq` handled downstream for consumer-side processing (messaging-topics).

**Repository responsibility:** `OutboxRepositoryMyBatisAdapter` (`mh-outbox-repository`) persists,
leases, and marks `PUBLISHED` outbox rows; the SKIP LOCKED lease is owned by `APP_INSTANCE_ID`. This
is the MyBatis adapter pattern mandated by **ADR-003 (mybatis-over-orm)**.

---

## Ordering Guarantees

All outbound topics are keyed by `aggregateId`, which gives **per-aggregate (per-key) ordering** in
Kafka partitions (`df-outbox-to-kafka`, `eventFlows`). Events for the same aggregate are published in
`created_at` / insert order by a single leased batch and land on the same partition, so consumers see
them in order.

| Topic | Key | Ordering basis | Source |
|---|---|---|---|
| `case.lifecycle.v1` | `caseId` (an aggregateId) | per-case ordering | `eventFlows.ef-case-lifecycle` |
| `case.assignment.v1` | `aggregateId` | per-aggregate ordering | `eventFlows.ef-case-assignment` |
| `evidence.lifecycle.v1` | `aggregateId` | per-aggregate ordering | `eventFlows.ef-evidence-lifecycle` |
| `decision.lifecycle.v1` | `aggregateId` | per-aggregate ordering | `eventFlows.ef-decision-lifecycle` |
| `sanction.lifecycle.v1` | `aggregateId` | per-aggregate ordering | `eventFlows.ef-sanction-lifecycle` |
| `appeal.lifecycle.v1` | `aggregateId` | per-aggregate ordering | `eventFlows.ef-appeal-lifecycle` |
| `notification.command.v1` | `aggregateId` | per-aggregate ordering | `eventFlows.ef-notification-command` |

Caveats for operators:
- Ordering is **per key only** — there is no global cross-aggregate ordering.
- A re-lease after a crash (lease expiry `PT30S`) can delay a late event behind newer events for the
  same key only if the newer event was already published; within a single aggregate the committed
  `PENDING` rows are still ordered by insertion.

---

## Duplicate Publish Safety

The publisher is **safe against duplicate publish** (messaging-topics, `cf-outbox-publisher-loop`).
The mechanism is the combination of the `PUBLISHED` marker plus the `FOR UPDATE SKIP LOCKED` lease:

- A row is marked `PUBLISHED` **only after** the Kafka send succeeds.
- Until then it stays `PENDING` and locked to its `lease_owner` (`APP_INSTANCE_ID`) for `PT30S`.
- If the publishing instance crashes after a successful send but before the `PUBLISHED` update, the
  lease expires, another instance re-leases the row, and re-publishes. Kafka therefore receives
  at-least-once delivery; downstream correctness relies on the consuming side.

Downstream deduplication is provided by **ADR-005 (inbox-idempotency)**: `KafkaNotificationConsumer`
(`mh-notification-result`) writes `inbox_event` with `UNIQUE(consumer_name, event_id)`, so a
duplicate delivery yields at most one `notification` side effect via `NotificationEventHandler`
(`mh-notification-handler`).

| Layer | Dedup / safety mechanism | Source |
|---|---|---|
| Outbox publish | `PUBLISHED` set post-send; lease prevents concurrent double-send | messaging-topics, `cf-outbox-publisher-loop` |
| Inbound consume | `inbox_event` `UNIQUE(consumer_name, event_id)` | messaging-topics, `mh-inbox-repository` |
| Side effect | `NotificationEventHandler` produces at most one effect per event | `mh-notification-handler` |

This is why "outbox is safe against duplicate publish" means *the source will not corrupt state by
double-marking*, while true exactly-once effect is achieved by the inbox on the consumer side.

---

## Kafka Outage Behavior

Per the messaging-topics evidence and `MessagingReliabilityIT` (testing-strategy), a Kafka outage
does **not** roll back committed business writes. The contract:

- The business tx (domain change + `outbox_event` insert `PENDING`) commits **independent of broker
  availability**.
- The publisher poll fails to send, so affected rows **remain `PENDING`** with a lease that expires.
- On broker recovery, the next poll (`PT2S`) re-leases and publishes the accumulated `PENDING` rows.
- No business data is lost and no domain write is undone by a broker failure.

This is the deliberate trade-off of ADR-004: availability of the write path is preserved; delivery is
delayed, not abandoned. Operators should watch for a growing `PENDING` count (stuck-outbox runbook
signal) and reconcile using the runbooks referenced in messaging-topics:
`docs/runbooks/outbox-stuck.md`, `docs/runbooks/dead-letter-events.md`,
`docs/runbooks/kafka-backlog.md`.

**Failure / alternate paths (operator view):**

| Trigger | Observed state | Recovery |
|---|---|---|
| Broker down at send | Rows stay `PENDING`; send retried next poll | Auto on recovery; rows remain retryable (`MessagingReliabilityIT`) |
| Publisher instance crash mid-send | Lease (`APP_INSTANCE_ID`, `PT30S`) expires; row still `PENDING` | Another instance re-leases and publishes |
| Consumer processing failure | Routed to `.retry`, then `.dlq` after `NOTIFICATION_MAX_RETRIES=3` | DLQ runbook; outbox already `PUBLISHED` |
| Long backlog | Pending count grows; poll batch 20 every `PT2S` drains gradually | `kafka-backlog.md` runbook |

---

## Outbox publish sequence with SKIP LOCKED lease

```mermaid
sequenceDiagram
    autonumber
    title Outbox publish sequence with SKIP LOCKED lease
    participant App as Application (business tx)
    participant Repo as OutboxRepositoryMyBatisAdapter
    participant Pub as KafkaOutboxPublisher
    participant Kafka as Kafka

    App->>Repo: domain change + outbox_event insert (status=PENDING)
    Note over App,Repo: Same DB transaction (ADR-004)

    loop every OUTBOX_POLL_INTERVAL = PT2S (batch 20)
        Pub->>Repo: poll pending rows
        Repo-->>Pub: PENDING rows (FOR UPDATE SKIP LOCKED, owner=APP_INSTANCE_ID, PT30S)
        Pub->>Kafka: publish event (key=aggregateId)
        Pub->>Repo: mark row PUBLISHED
    end

    Note over Pub,Kafka: Safe against duplicate publish<br/>(PUBLISHED only after successful send;<br/>re-lease on lease expiry)
```

---

## Related pages

- [Message Handler Catalog](./message-handler-catalog.md) — `KafkaOutboxPublisher`, `OutboxRepositoryMyBatisAdapter`, `KafkaNotificationConsumer`.
- [Inbox Idempotency](./inbox-idempotency.md) — ADR-005 dedup via `UNIQUE(consumer_name, event_id)`.
- [Event Flows](./event-flows.md) — per-topic `eventFlows` (key, retry, dlq, ordering).
- [Data Flows](./data-flows.md) — `df-outbox-to-kafka` source/sink/persistence.
- [ADR Landscape](../adr/adr-landscape.md) — ADR-004 (transactional-outbox), ADR-005 (inbox-idempotency).
