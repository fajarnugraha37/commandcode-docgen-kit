# ADR-004 Transactional Outbox

## Context

Kafka publish tidak boleh menjadi operasi independen dari perubahan domain.

## Decision

Gunakan transactional outbox saat messaging diimplementasikan.

## Alternatives

- Direct publish setelah commit
- Two-phase commit

## Consequences

Reliability meningkat, tetapi perlu publisher dan monitoring tambahan.

## Status

Accepted
