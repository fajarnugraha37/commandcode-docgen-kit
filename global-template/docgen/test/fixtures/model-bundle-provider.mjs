#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const prompt = fs.readFileSync(0, 'utf8').replace(/\r\n?/g, '\n');
const stage = process.env.DOCGEN_STAGE;
const cwd = process.cwd();
const tick = String.fromCharCode(96);
const between = (text, start, end) => { const tail = text.split(start)[1]; return tail ? tail.split(end)[0] : null; };
const target = between(prompt, `Write exactly one JSON file: ${tick}`, tick);
const write = (rel, value) => {
  if (!rel) throw new Error(`missing output path for ${stage}`);
  const file = path.join(cwd, rel); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
};

if (stage === 'modelCore') {
  write(target, {
    models: {
      system: { components: [{ id: 'resource', name: 'Resource', statement: 'Source component', classification: 'FACT', confidence: 1, evidence: [{ path: 'src/Resource.java', startLine: 1 }] }] },
      business: { unknowns: [] }, flows: { unknowns: [] }, catalogs: { unknowns: [] }
    }
  });
} else if (stage === 'modelEnterprise') {
  const isInitial = target?.endsWith('modelEnterprise-bundle.json');
  const isBatchRepair = target?.includes('modelEnterprise-repair-') && target?.endsWith('-bundle.json');
  const neverReturn = process.env.DOCGEN_TEST_NEVER_RETURN_MODEL === '1';
  if (isInitial && process.env.DOCGEN_TEST_EMPTY_INITIAL === '1') {
    write(target, { message: 'no requested model objects were emitted' });
  } else if (isInitial) {
    write(target, { result: { models: {
      security: { unknowns: [] }, operations: { unknowns: [] }, testing: { unknowns: [] },
      dataGovernanceModel: { unknowns: [] }, configuration: { unknowns: [] },
      changeImpactDocument: { unknowns: [] }, ownership: { unknowns: [] }
    } } });
  } else if (isBatchRepair || neverReturn) {
    write(target, { response: { payload: { note: 'requested object still omitted' } } });
  } else {
    write(target, { items: [{ id: 'decision-1', name: 'Explicit decision', statement: 'Recovered independently.', classification: 'UNKNOWN', confidence: 0, evidence: [] }] });
  }
} else {
  console.error(`unexpected stage ${stage}`); process.exit(2);
}
