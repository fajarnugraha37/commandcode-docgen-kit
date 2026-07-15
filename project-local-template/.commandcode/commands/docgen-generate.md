Generate exactly one documentation page with page id `$1`.

Delegate to the `doc-writer` custom agent. Load the matching entry from `.docgen/plan/manifest.json`, read only its declared evidence/model inputs plus necessary supporting files, and write exactly the target page under `docs/**`. Validate Markdown structure before finishing.
