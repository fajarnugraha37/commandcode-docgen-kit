import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { guardedAudit, sanitizeAuditInputs } from '../lib/audit-guard.mjs';
import { projectPaths, sha256, writeJson } from '../lib/core.mjs';

function pageText(page) {
  return `---\ntitle: ${JSON.stringify(page.title)}\ndescription: ${JSON.stringify(page.summary)}\npageId: ${JSON.stringify(page.id)}\ncategory: ${JSON.stringify(page.category)}\nmode: "explanation"\ntype: ${JSON.stringify(page.type)}\norder: ${page.order}\n---\n# ${page.title}\n\nIdentical material body.\n`;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docgen-audit-guard-'));
  const paths = projectPaths(root);
  const pages = [
    { id: 'page-a', title: 'Page A', summary: 'First page', category: 'security', path: 'docs/security/page-a.md', type: 'security', order: 1, requiredSections: [], relatedPages: [] },
    { id: 'page-b', title: 'Page B', summary: 'Second page', category: 'security', path: 'docs/security/page-b.md', type: 'security', order: 2, requiredSections: [], relatedPages: [] }
  ];
  fs.mkdirSync(path.join(root, 'docs', 'security'), { recursive: true });
  fs.mkdirSync(path.join(paths.traceability, 'pages'), { recursive: true });
  for (const page of pages) {
    const text = pageText(page);
    fs.writeFileSync(path.join(root, page.path), text);
    writeJson(path.join(paths.traceability, 'pages', `${page.id}.json`), {
      schemaVersion: '2.0', pageId: page.id, pagePath: page.path,
      pageHash: sha256(text), inputHash: `${page.id}-input`, claims: []
    });
  }
  writeJson(paths.project, { schemaVersion: '2.0', kitVersion: '2.0.0' });
  writeJson(paths.config, {
    audit: { llmEnabled: true, llmRiskThreshold: 0, requireLineEvidenceForFacts: true, requireContextBoundEvidence: true },
    execution: { maxPlannedPages: 30 }
  });
  writeJson(paths.inventory, { schemaVersion: '2.0', fingerprint: 'fixture', files: [], excluded: [] });
  writeJson(paths.plan, { schemaVersion: '2.0', pages });
  writeJson(paths.state, {
    schemaVersion: '2.0', stages: {},
    pages: Object.fromEntries(pages.map((page) => [page.id, { status: 'completed', inputHash: `${page.id}-input` }]))
  });
  return { root, paths, pages };
}

test('deterministic failure stops before the costly audit provider', async () => {
  const { root, paths } = fixture();
  let baseAuditCalls = 0;
  await assert.rejects(
    () => guardedAudit(root, async () => { baseAuditCalls++; throw new Error('provider path must not run'); }),
    /Quality failed before LLM audit: deterministicFailures=1, highRiskFindings=0/
  );
  assert.equal(baseAuditCalls, 0);
  const summary = JSON.parse(fs.readFileSync(path.join(paths.audit, 'quality-summary.json'), 'utf8'));
  assert.equal(summary.llmAuditedPages, 0);
  assert.equal(summary.highRiskFindings, 0);
  assert.equal(summary.llmSkippedReason, 'deterministic-fail-fast');
  assert.equal(summary.pass, false);
});

test('sanitizer drops out-of-context evidence and refs and downgrades unsupported FACT', () => {
  const { root, paths, pages } = fixture();
  const page = pages[0];
  const contextFile = path.join(paths.context, 'generate', `${page.id}.json`);
  writeJson(contextFile, { id: 'ctx-a', modelItems: [], facts: [] });
  const traceFile = path.join(paths.traceability, 'pages', `${page.id}.json`);
  const trace = JSON.parse(fs.readFileSync(traceFile, 'utf8'));
  trace.contextId = 'ctx-a';
  trace.claims = [{
    id: 'claim-a', statement: 'Unsupported provider claim', classification: 'FACT', confidence: 1,
    evidence: [{ path: '../../outside.txt', startLine: 999 }], sourceModelRefs: ['missing:model']
  }];
  writeJson(traceFile, trace);
  const result = sanitizeAuditInputs(root, { pages: [page] });
  const sanitized = JSON.parse(fs.readFileSync(traceFile, 'utf8')).claims[0];
  assert.equal(result.traces.droppedEvidence, 1);
  assert.equal(result.traces.droppedRefs, 1);
  assert.equal(sanitized.classification, 'INFERENCE');
  assert.equal(sanitized.confidence, 0.7);
  assert.deepEqual(sanitized.evidence, []);
  assert.deepEqual(sanitized.sourceModelRefs, []);
});
