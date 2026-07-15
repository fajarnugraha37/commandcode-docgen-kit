You are running a bounded DocGen page generation stage.

Page manifest entry:
{{PAGE_JSON}}

Delegate exactly this page to the `doc-writer` custom agent.

Quality contract:
- treat the manifest as a content contract, not a suggestion;
- cover every declared required section;
- use every relevant declared evidence/model input;
- explain purpose, mental model, boundaries, lifecycle/flow, invariants, failure behavior, operational implications, and implementation orientation when supported;
- include Mermaid diagrams for declared diagram intents when evidence supports them;
- prefer layered explanation: executive orientation first, then deep technical detail;
- include practical examples, tables, state/sequence flows, caveats, and cross-links when they improve understanding;
- never pad with generic textbook prose or invent behavior.

Write exactly the manifest target path. Do not modify unrelated pages or application source. Validate Markdown structure before finishing.
