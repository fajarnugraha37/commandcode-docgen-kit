You are running a bounded DocGen batched independent audit stage.

Pages to audit, including their current content hashes:
{{PAGES_JSON}}

Delegate to `doc-auditor`. For every page, verify claims against declared evidence/models and write one report to `.docgen/audit/pages/<page-id>.json`. Each report must contain `schemaVersion`, `pageId`, `pagePath`, `pageHash` copied from the batch input, and `findings`. Do not skip a page.
