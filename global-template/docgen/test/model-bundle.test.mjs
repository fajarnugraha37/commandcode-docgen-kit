import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalModelName,
  extractModelObjects,
  resolveModelObjects,
  safeModelPlaceholder
} from '../lib/model-bundle.mjs';

const expected = ['security', 'operations', 'testing', 'data-governance', 'decisions', 'configuration', 'change-impact', 'ownership'];

test('canonical model names tolerate punctuation, extensions, camel case, and singular/plural forms', () => {
  assert.equal(canonicalModelName('decisions.json'), canonicalModelName('decisionModel'));
  assert.equal(canonicalModelName('dataGovernanceModel'), canonicalModelName('data-governance'));
  assert.equal(canonicalModelName('change_impact_document'), canonicalModelName('change-impact'));
});

test('extracts exact top-level objects without changing their payload', () => {
  const source = Object.fromEntries(expected.map((name) => [name, { marker: name }]));
  const result = extractModelObjects(source, expected);
  assert.deepEqual(result.missing, []);
  for (const name of expected) assert.equal(result.objects[name].marker, name);
});

test('extracts recursively through common and unknown provider wrappers', () => {
  const source = {
    response: {
      payload: {
        artifacts: {
          enterpriseModels: {
            decisions: { items: [{ id: 'd1' }] },
            ownership: { items: [{ id: 'o1' }] }
          }
        }
      }
    }
  };
  const result = extractModelObjects(source, ['decisions', 'ownership']);
  assert.deepEqual(result.missing, []);
  assert.equal(result.objects.decisions.items[0].id, 'd1');
});

test('accepts filename keys, camel-case keys, arrays, and JSON-string payloads', () => {
  const source = {
    outputs: {
      'decisions.json': '[{"id":"d1"}]',
      dataGovernanceModel: '{"rules":[{"id":"r1"}]}',
      changeImpactDocument: { effects: [] }
    }
  };
  const result = extractModelObjects(source, ['decisions', 'data-governance', 'change-impact']);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.objects.decisions.items, [{ id: 'd1' }]);
  assert.equal(result.objects['data-governance'].rules[0].id, 'r1');
});

test('accepts descriptor arrays used by artifact-oriented providers', () => {
  const source = {
    artifacts: [
      { id: 'artifact-1', filename: 'decisions.json', content: { decisions: [{ id: 'd1' }] } },
      { id: 'artifact-2', modelName: 'ownership', payload: '{"teams":[{"id":"team-a"}]}' }
    ]
  };
  const result = extractModelObjects(source, ['decisions', 'ownership']);
  assert.deepEqual(result.missing, []);
  assert.equal(result.objects.decisions.items[0].id, 'd1');
  assert.equal(result.objects.ownership.teams[0].id, 'team-a');
});


test('does not mistake a nested concern field for an omitted top-level model object', () => {
  const source = {
    security: { decisions: [{ id: 'security-decision' }], controls: [] },
    operations: { runbooks: [] }
  };
  const result = extractModelObjects(source, ['security', 'operations', 'decisions']);
  assert.deepEqual(result.missing, ['decisions']);
  assert.equal(result.objects.security.decisions[0].id, 'security-decision');
});

test('accepts a direct singleton object during per-object repair', () => {
  const direct = { items: [{ id: 'd1' }], unknowns: [] };
  const result = extractModelObjects(direct, ['decisions']);
  assert.deepEqual(result.missing, []);
  assert.equal(result.objects.decisions.items[0].id, 'd1');
});


test('does not accept error or status metadata as a direct singleton model', () => {
  assert.deepEqual(extractModelObjects({ message: 'cannot comply', status: 'error' }, ['decisions']).missing, ['decisions']);
});

test('prefers explicitly named objects over lower-confidence descriptor candidates', () => {
  const source = {
    decisions: { selected: 'top-level' },
    artifacts: [{ name: 'decisions', value: { selected: 'descriptor' } }]
  };
  const result = extractModelObjects(source, ['decisions']);
  assert.equal(result.objects.decisions.selected, 'top-level');
});

test('bounded reconciliation fills only unresolved objects across attempts', () => {
  const first = { models: { security: { id: 's' }, operations: { id: 'o' } } };
  const batchRepair = { result: { 'decisions.json': { id: 'd' } } };
  const singleRepair = { id: 'owner-direct', teams: [] };
  const result = resolveModelObjects(['security', 'operations', 'decisions', 'ownership'], [first, batchRepair, singleRepair]);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.degraded, []);
  assert.equal(result.objects.ownership.id, 'owner-direct');
});

test('unresolved objects become explicit UNKNOWN placeholders instead of fatal missing-object errors', () => {
  const result = resolveModelObjects(['security', 'decisions'], [{ security: { controls: [] } }]);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.degraded, ['decisions']);
  assert.equal(result.objects.decisions.providerOutputStatus, 'missing');
  assert.equal(result.objects.decisions.classification, 'UNKNOWN');
  assert.equal(result.objects.decisions.evidence.length, 0);
  assert.match(result.objects.decisions.unknowns[0].statement, /omitted|recovery/i);
});

test('strict missing policy remains available for environments that require a hard gate', () => {
  const result = resolveModelObjects(['security', 'decisions'], [{ security: {} }], { missingPolicy: 'fail' });
  assert.deepEqual(result.missing, ['decisions']);
  assert.deepEqual(result.degraded, []);
});

test('placeholder never fabricates repository evidence', () => {
  const placeholder = safeModelPlaceholder('decisions');
  assert.equal(placeholder.classification, 'UNKNOWN');
  assert.equal(placeholder.confidence, 0);
  assert.deepEqual(placeholder.evidence, []);
  assert.deepEqual(placeholder.unknowns[0].evidence, []);
});
