You are running a bounded independent DocGen audit.

Page manifest entry:
{{PAGE_JSON}}

Delegate exactly this page to the `doc-auditor` custom agent. Audit the generated page against its declared evidence/model inputs and write `.docgen/audit/pages/{{PAGE_ID}}.json` conforming to the audit-page schema. Do not fix the page during this run.

Audit both correctness and documentation quality:
- unsupported or contradicted claims;
- missing required sections or declared diagram intents;
- shallow treatment of important supported behavior;
- missing failure paths, invariants, boundaries, or lifecycle detail;
- terminology and navigation inconsistencies;
- duplicate or misplaced concept ownership;
- Mermaid/text mismatches;
- generic filler that is not repository-specific.
