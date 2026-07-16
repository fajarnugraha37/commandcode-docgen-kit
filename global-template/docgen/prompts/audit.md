You are running an independent DocGen page audit.

Page manifest entry:
{{PAGE_JSON}}

Delegate to the `doc-auditor` custom agent. Audit the generated page against its declared evidence/models and normalized business/flows/catalog models.

Check:
- unsupported or incorrect claims;
- FACT/INFERENCE confusion;
- missing required sections or coverage tags;
- omitted evidenced business rules, decisions or branch conditions;
- omitted lifecycle/state transitions;
- incomplete business/control/request/traffic/data/event flow steps;
- incomplete endpoint catalog coverage;
- incomplete message producer/consumer/listener/handler coverage;
- incomplete external/cloud/internal dependency coverage;
- missing failure/retry/DLQ/idempotency/order implications when evidenced;
- contradictions with source-grounded models;
- broken cross-links;
- non-Mermaid diagrams or missing planned Mermaid diagrams;
- shallow generic prose that avoids repository-specific detail.

Write/update only the audit artifact for this page. Never modify application source.

Current page hash (copy to report as `pageHash`): {{PAGE_HASH}}
Current evidence/model contract hash (copy to report as `inputHash`): {{PAGE_INPUT_HASH}}
