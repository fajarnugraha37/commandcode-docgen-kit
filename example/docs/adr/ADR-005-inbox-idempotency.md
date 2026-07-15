# ADR-005 Inbox Idempotency

## Context

Consumer event harus aman terhadap duplicate delivery.

## Decision

Gunakan inbox table dengan unique key `(consumer_name, event_id)`.

## Alternatives

- In-memory deduplication
- Broker-only delivery guarantee

## Consequences

Perlu storage tambahan, tetapi side effect lebih aman.

## Status

Accepted
