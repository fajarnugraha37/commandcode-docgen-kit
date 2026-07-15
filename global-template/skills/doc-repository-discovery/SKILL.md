---
name: doc-repository-discovery
description: Systematically discover repository structure and produce evidence artifacts without writing narrative documentation.
---

# Repository Discovery Procedure

1. Read `.docgen/config/documentation.json` and respect exclusions.
2. Establish repository identity, build system, modules, languages, and entry points.
3. Detect inbound interfaces: HTTP, messaging, jobs, CLI, workflow engines.
4. Detect outbound interfaces: HTTP clients, messaging producers, database access, external SDKs.
5. Detect persistence artifacts, configuration, security boundaries, and runtime/deployment descriptors.
6. Load relevant technology skills before interpreting framework conventions.
7. Record evidence artifacts under `.docgen/evidence/**`.
8. Reconcile `.docgen/evidence/index.json` rather than appending duplicates blindly.

Prefer source inspection with `glob`, `grep`, and `read_file`. Use shell only for conservative read-only inspection.
