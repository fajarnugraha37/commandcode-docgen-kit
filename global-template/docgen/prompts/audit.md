You are running a bounded independent DocGen audit.

Page manifest entry:
{{PAGE_JSON}}

Delegate exactly this page to the `doc-auditor` custom agent. Audit the generated page against its declared evidence/model inputs and write `.docgen/audit/pages/{{PAGE_ID}}.json` conforming to the audit-page schema. Do not fix the page during this run.
