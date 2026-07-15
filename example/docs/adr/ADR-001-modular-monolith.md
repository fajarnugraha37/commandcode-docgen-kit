# ADR-001 Modular Monolith

## Context

Project membutuhkan boundary yang jelas tanpa operational overhead microservice pada fase awal.

## Decision

Gunakan modular monolith dengan Maven multi-module dan boundary yang eksplisit.

## Alternatives

- Single-module application
- Full microservice split sejak awal

## Consequences

Boundary domain lebih jelas, tetapi wiring awal menjadi lebih banyak dibanding starter template.

## Status

Accepted
