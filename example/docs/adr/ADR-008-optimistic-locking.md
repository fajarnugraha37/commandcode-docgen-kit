# ADR-008 Optimistic Locking

## Context

Case dan aggregate mutable lain harus aman terhadap concurrent update.

## Decision

Gunakan optimistic locking berbasis kolom `version`.

## Alternatives

- Last write wins
- Pessimistic locking umum

## Consequences

Conflict menjadi eksplisit, tetapi caller harus menangani retry atau user-facing error.

## Status

Accepted
