# ADR-007 MinIO Evidence Storage

## Context

Evidence file membutuhkan object storage dengan alur upload langsung.

## Decision

Gunakan MinIO untuk local development evidence storage.

## Alternatives

- Menyimpan file di local filesystem
- Menggunakan database blob

## Consequences

Flow lebih realistis, tetapi perlu lifecycle object dan metadata yang disiplin.

## Status

Accepted
