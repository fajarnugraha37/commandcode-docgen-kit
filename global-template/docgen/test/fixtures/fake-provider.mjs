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

if (process.env.DOCGEN_TEST_FAIL_BEFORE_WRITE_STAGE === stage) {
  console.error(`simulated provider failure before writing ${stage} artifacts`);
  process.exit(8);
}

if (stage === 'modelCore') {
  write(target, {
    system: {
      components: [{ id: 'resource', kind: 'component', name: 'Resource', statement: 'Source component', classification: 'FACT', confidence: 1, evidence: [{ path: 'src/Resource.java', startLine: 1 }] }],
      relationships: [], workflows: [], unknowns: []
    },
    business: { actors: [], capabilities: [], concepts: [], businessRules: [], decisions: [], branchConditions: [], lifecycles: [], invariants: [], useCases: [], unknowns: [] },
    flows: { businessFlows: [], controlFlows: [], requestFlows: [], trafficFlows: [], dataFlows: [], eventFlows: [] },
    catalogs: { interfaces: [], contracts: [], endpoints: [], messageHandlers: [], dependencies: [], externalDependencies: [], dataAssets: [], dataStores: [], automations: [], scheduledJobs: [], buildArtifacts: [], configurationSurfaces: [] }
  });
} else if (stage === 'modelEnterprise') {
  write(target, {
    security: { unknowns: [] }, operations: { unknowns: [] }, testing: { unknowns: [] },
    'data-governance': { unknowns: [] }, decisions: { unknowns: [] }, configuration: { unknowns: [] },
    'change-impact': { unknowns: [] }, ownership: { unknowns: [] }
  });
} else if (stage === 'plan') {
  const pageCount = Math.max(1, Number(process.env.DOCGEN_TEST_PAGE_COUNT || 1));
  write(target, {
    schemaVersion: '2.0', metadata: { description: 'Fixture docs' },
    pages: Array.from({ length: pageCount }, (_, index) => ({
      id: index === 0 ? 'overview' : `detail-${index + 1}`,
      title: index === 0 ? 'System Overview' : `System Detail ${index + 1}`,
      summary: index === 0 ? 'Fixture overview.' : `Fixture detail ${index + 1}.`,
      category: 'orientation', mode: 'explanation', type: 'overview', order: index + 1,
      audience: ['engineer'], coverageTags: ['architecture'], query: 'resource architecture',
      requiredSections: [], risk: 'low', relatedPages: []
    }))
  });
} else if (stage === 'generate') {
  const json = between(prompt, 'Page contracts:\n', '\n\nFor every contract:');
  const contracts = JSON.parse(json);
  const partialMarker = path.join(cwd, '.docgen', 'test-partial-generate.marker');
  const partialFirstAttempt = process.env.DOCGEN_TEST_PARTIAL_GENERATE === '1' && !fs.existsSync(partialMarker);
  const selected = partialFirstAttempt ? contracts.slice(0, 1) : contracts;
  for (const contract of selected) {
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

The repository contains a source component.
`;
    const output = path.join(cwd, contract.outputPath);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, md);
    write(contract.traceabilityPath, {
      schemaVersion: '2.0', pageId: page.id, pagePath: contract.outputPath,
      claims: [{
        id: `${page.id}:resource`, section: page.title,
        statement: 'The repository contains a source component.', classification: 'FACT', confidence: 1,
        evidence: [{ path: 'src/Resource.java', startLine: 1 }], sourceModelRefs: ['system:resource']
      }]
    });
  }
  if (partialFirstAttempt) {
    fs.writeFileSync(partialMarker, 'partial\n');
    console.error('simulated provider exit after partial valid generation');
    process.exit(8);
  }
} else if (stage === 'audit') {
  const output = between(prompt, `report: ${tick}`, tick) || '.docgen/audit/llm-risk.json';
  write(output, { schemaVersion: '2.0', pages: [] });
} else {
  console.error(`unexpected stage ${stage}`);
  process.exitCode = 2;
}


if (process.env.DOCGEN_TEST_EXIT_AFTER_WRITE_STAGE === stage) {
  console.error(`simulated provider exit after valid ${stage} artifacts`);
  process.exit(8);
}
