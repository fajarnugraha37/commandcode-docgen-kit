Audit exactly one documentation page with page id `$1`.

Delegate to the `doc-auditor` custom agent. Load the manifest entry and target page, verify claims against evidence/models, and write `.docgen/audit/pages/$1.json`. Do not modify the documentation page during audit.
