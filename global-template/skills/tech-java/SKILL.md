---
name: tech-java
description: Interpret Java repository structure, application entry points, service boundaries, concurrency, annotations, and runtime wiring during discovery.
---

# Java Discovery Heuristics

Inspect source sets, modules, `module-info.java` when present, application/main classes, annotations, service loader files, dependency injection wiring, concurrency primitives, and generated-source boundaries. Distinguish compile-time declarations from runtime registration. Do not infer framework behavior from an annotation unless the relevant runtime/framework is evidenced.
