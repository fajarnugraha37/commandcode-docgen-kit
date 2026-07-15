# Documentation Style Guide

## Reader Model

Assume the reader is technically capable but unfamiliar with this repository.

## Page Shape

Prefer this order when applicable:

1. purpose and answer-first summary
2. mental model
3. responsibilities and boundaries
4. interactions or lifecycle
5. failure behavior and important edge cases
6. implementation references and next links

Guides are task-oriented; reference pages are lookup-oriented. Do not force this outline when it does not fit the page type.

## Prose

- Be precise and concrete.
- Prefer system behavior over code narration.
- Explain why a boundary matters when evidence supports the reasoning.
- Keep `FACT`, `INFERENCE`, and `UNKNOWN` distinctions truthful, but do not litter user-facing prose with labels when ordinary wording can communicate uncertainty clearly.
- Do not say "the code simply" or "obviously".
- Avoid repeating the same concept across pages; link instead.

## Markdown

- Standard Markdown only.
- One H1 per page.
- Use relative links for repository-local docs.
- Use fenced code blocks with language identifiers.
- Mermaid diagrams must agree with prose and evidence.
- Do not embed local absolute filesystem paths.

## Source References

When useful, cite repository paths using inline code, for example `src/main/java/.../QuoteResource.java`. Avoid noisy line-by-line citations in conceptual prose; preserve precise evidence in `.docgen/evidence/**` and use source references where they help verification or navigation.
