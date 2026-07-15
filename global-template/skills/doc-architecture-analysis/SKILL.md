---
name: doc-architecture-analysis
description: Synthesize components, dependencies, ownership, boundaries, and failure surfaces from evidence.
---

# Architecture Analysis Procedure

Build a model, not a file inventory.

Identify:

- components and their responsibilities
- inbound and outbound interfaces
- runtime dependencies and directionality
- data ownership and mutation boundaries
- synchronous versus asynchronous coupling
- security and trust boundaries
- failure propagation, retry, timeout, compensation, and idempotency behavior when evidenced

Every responsibility or relationship must carry `classification` and `evidenceIds`. Prefer `UNKNOWN` over architectural storytelling when evidence is insufficient.
