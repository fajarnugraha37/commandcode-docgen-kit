#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const maxTurnsIndex = process.argv.indexOf('--max-turns');
const maxTurns = maxTurnsIndex >= 0 ? Number(process.argv[maxTurnsIndex + 1]) : 0;
if (!Number.isFinite(maxTurns) || maxTurns < 30) {
  console.error(`Warning: Reached maximum conversation turns (${maxTurns || 'missing'}). Retry with --max-turns 30.`);
  process.exit(8);
}

const prompt = fs.readFileSync(0, 'utf8');
const stage = process.env.DOCGEN_STAGE;
const cwd = process.cwd();
const tick = String.fromCharCode(96);
const between = (text, start, end) => {
  const tail = text.split(start)[1];
  return tail ? tail.split(end)[0] : null;
};
const target = between(prompt, `Write exactly one JSON file: ${tick}`, tick);
const write = (rel, value) => {
  if (!rel) throw new Error(`missing output path for ${stage}`);
  const file = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
};

if (stage === 'modelCore') {
  write(target, {
    system: {
      components: [{ id: 'resource', kind: 'component', name: 'Resource', statement: 'HTTP resource', classification: 'FACT', confidence: 1, evidence: [{ path: 'src/Resource.java', startLine: 1 }] }],
      relationships: [], workflows: [], unknowns: []
    },
    business: { actors: [], capabilities: [], concepts: [], businessRules: [], decisions: [], branchConditions: [], lifecycles: [], invariants: [], useCases: [], unknowns: [] },
    flows: { businessFlows: [], controlFlows: [], requestFlows: [], trafficFlows: [], dataFlows: [], eventFlows: [] },
    catalogs: { endpoints: [], messageHandlers: [], externalDependencies: [], dataStores: [], scheduledJobs: [] }
  });
} else if (stage === 'modelEnterprise') {
  write(target, {
    security: { unknowns: [] }, operations: { unknowns: [] }, testing: { unknowns: [] },
    'data-governance': { unknowns: [] }, decisions: { unknowns: [] }, configuration: { unknowns: [] },
    'change-impact': { unknowns: [] }, ownership: { unknowns: [] }
  });
} else if (stage === 'plan') {
  write(target, {
    schemaVersion: '2.0', metadata: { description: 'Fixture docs' },
    pages: [{
      id: 'overview', title: 'System Overview', summary: 'Fixture overview.', category: 'orientation',
      mode: 'explanation', type: 'overview', order: 1, audience: ['engineer'], coverageTags: ['architecture'],
      query: 'resource architecture', requiredSections: [], risk: 'low', relatedPages: []
    }]
  });
} else if (stage === 'generate') {
  const json = between(prompt, 'Page contracts:\n', '\n\nFor every contract:');
  const contracts = JSON.parse(json);
  for (const contract of contracts) {
    const page = contract.page;
    const md = `---
title: ${JSON.stringify(page.title)}
description: ${JSON.stringify(page.summary)}
pageId: ${JSON.stringify(page.id)}
category: ${JSON.stringify(page.category)}
mode: ${JSON.stringify(page.mode)}
type: ${JSON.stringify(page.type)}
order: ${page.order}
---
# ${page.title}

${page.summary}

The repository exposes an HTTP resource.
`;
    const output = path.join(cwd, contract.outputPath);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, md);
    write(contract.traceabilityPath, {
      schemaVersion: '2.0', pageId: page.id, pagePath: contract.outputPath,
      claims: [{
        id: `${page.id}:resource`, section: page.title,
        statement: 'The repository exposes an HTTP resource.', classification: 'FACT', confidence: 1,
        evidence: [{ path: 'src/Resource.java', startLine: 1 }], sourceModelRefs: ['system:resource']
      }]
    });
  }
} else if (stage === 'audit') {
  const output = between(prompt, `report: ${tick}`, tick) || '.docgen/audit/llm-risk.json';
  write(output, { schemaVersion: '2.0', pages: [] });
} else {
  console.error(`unexpected stage ${stage}`);
  process.exitCode = 2;
}
