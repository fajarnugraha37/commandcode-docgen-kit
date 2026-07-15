# ADR-010 Audit Log Model

## Context

Regulatory enforcement membutuhkan jejak tindakan yang append-only dan terpisah dari application log.

## Decision

Gunakan audit event append-only sebagai model audit terpisah.

## Alternatives

- Hanya mengandalkan application log
- Menyimpan audit sebagai field sampingan pada resource

## Consequences

Audit trail lebih kuat, tetapi perlu storage dan query model khusus.

## Status

Accepted
