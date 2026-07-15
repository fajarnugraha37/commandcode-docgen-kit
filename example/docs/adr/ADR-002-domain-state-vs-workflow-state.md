# ADR-002 Domain State vs Workflow State

## Context

Project membutuhkan pemisahan antara business truth dan orchestration state.

## Decision

Database domain menjadi source of truth business state, sementara engine workflow akan memegang orchestration state.

## Alternatives

- Menyimpan business state penuh di workflow engine
- Menyatukan state domain dan workflow dalam tabel tunggal

## Consequences

Sinkronisasi perlu ditangani eksplisit, tetapi invariant bisnis lebih terlindungi.

## Status

Accepted
