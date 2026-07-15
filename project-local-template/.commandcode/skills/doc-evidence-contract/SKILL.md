---
name: doc-evidence-contract
description: Define evidence classifications, traceability, and machine-readable source grounding for all DocGen stages.
---

# Evidence Contract

Use this contract whenever extracting facts, synthesizing models, writing documentation, or auditing claims.

## Classifications

- `FACT`: directly observable in authoritative repository artifacts.
- `INFERENCE`: a reasoned conclusion supported by one or more facts. Record supporting evidence ids.
- `UNKNOWN`: evidence is insufficient or contradictory. Do not convert it into a confident statement.

## Required Traceability

Important facts must identify a source path and, when available, a symbol and line range. Generated evidence ids must be stable enough to be referenced by model artifacts.

## Prohibited Behavior

Never infer business intent solely from names. Never claim runtime guarantees from configuration defaults unless the deployed configuration is known. Never treat existing documentation as stronger evidence than executable source or contracts.

## Output Discipline

Use the JSON schemas under `.docgen/schemas/**`. Keep evidence atomic enough that later model and audit stages can cite a precise fact rather than a large prose summary.
