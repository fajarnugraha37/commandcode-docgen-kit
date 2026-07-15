---
name: "doc-data-model-analysis"
description: "Extract data entities, ownership, relationships, lifecycle, transformations, persistence paths, consistency boundaries, and sensitive-data semantics."
---
# Data model analysis

Identify evidenced:

- domain entities, DTOs/contracts, persistence records, messages and configuration objects;
- logical ownership and authoritative source;
- relationships and cardinality when supported;
- creation/update/delete/archive lifecycle;
- validation and transformation stages;
- transaction and consistency boundaries;
- cache/materialized/derived copies;
- data crossing service or trust boundaries;
- sensitive or security-relevant fields only when evidenced;
- unknown ownership or lifecycle gaps.

Do not infer a canonical enterprise data model from class names alone.
