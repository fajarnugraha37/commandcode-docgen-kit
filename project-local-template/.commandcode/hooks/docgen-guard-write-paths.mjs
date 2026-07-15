import path from 'node:path';
import { active, readStdinJson, resolveWorkspacePath, isWithin, deny } from './docgen-common.mjs';
const payload = await readStdinJson();
if (!active()) process.exit(0);
const cwd = path.resolve(payload.cwd ?? process.env.COMMANDCODE_PROJECT_DIR ?? process.cwd());
const raw = payload.tool_input?.file_path;
const target = resolveWorkspacePath(raw, cwd);
if (!target) {
  deny('DocGen could not determine the write target. Use write_file/edit_file with an explicit path under docs/** or .docgen/**.');
  process.exit(0);
}
const allowed = [path.join(cwd, 'docs'), path.join(cwd, '.docgen')];
if (!allowed.some((root) => isWithin(target, root))) {
  deny(`DocGen workflows may write only under docs/** or .docgen/**. Blocked target: ${raw}`);
}
