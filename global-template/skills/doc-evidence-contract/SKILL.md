---
name: "doc-evidence-contract"
description: "Define canonical evidence rules and resilient evidence-index conventions for source-grounded documentation generation."
---
# Evidence contract

Source code, executable configuration, API/message contracts, schemas, migrations and deployment/runtime definitions are primary evidence.

Every non-obvious fact should carry:

- stable fact id where practical;
- kind/category;
- statement or structured data;
- source path;
- symbol or location when available;
- classification: FACT / INFERENCE / UNKNOWN;
- confidence for inference when useful.

## Canonical evidence index

`.docgen/evidence/index.json` MUST be a JSON object containing at least:

```json
{
  "schemaVersion": "1.0",
  "generatedAt": "<ISO-8601>",
  "repository": {},
  "artifacts": [
    {
      "id": "rest-api",
      "path": ".docgen/evidence/rest-api.json",
      "kind": "api",
      "scope": "."
    }
  ]
}
```

The top-level key is exactly `artifacts`. Do not substitute `files`, `entries`, or `documents`.

Artifact files may organize facts by repository structure, technology, bounded context, or concern. Prefer bounded cohesive evidence files over one giant file.

Never silently convert UNKNOWN into FACT. Existing prose is secondary evidence and must not override contradictory source evidence.
