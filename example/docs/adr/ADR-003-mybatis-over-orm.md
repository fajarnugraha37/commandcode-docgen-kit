# ADR-003 MyBatis over ORM

## Context

Project ingin query yang eksplisit, mudah ditelusuri, dan cocok untuk schema-driven persistence.

## Decision

Gunakan MyBatis sebagai persistence mapper utama.

## Alternatives

- JPA / Hibernate ORM
- Plain JDBC

## Consequences

Query lebih eksplisit, tetapi mapping perlu ditulis lebih manual.

## Status

Accepted
