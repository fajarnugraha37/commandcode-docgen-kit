Run the deterministic DocGen publishing experience stage from the current repository root.

Execute:

```bash
docgen publish
```

This generates canonical YAML frontmatter, `docs/llms.txt`, optional `docs/llms-full.txt`, navigation/search/backlink/redirect/orphan/example indexes under `.docgen/publish/`. It does not call the LLM provider.
