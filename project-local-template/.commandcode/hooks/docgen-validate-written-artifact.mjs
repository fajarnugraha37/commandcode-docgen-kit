import fs from 'node:fs';
import path from 'node:path';
import { active, readStdinJson, resolveWorkspacePath, advisory } from './docgen-common.mjs';
const payload = await readStdinJson();
if (!active()) process.exit(0);
const cwd = path.resolve(payload.cwd ?? process.env.COMMANDCODE_PROJECT_DIR ?? process.cwd());
const raw = payload.tool_input?.file_path;
const file = resolveWorkspacePath(raw, cwd);
if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) process.exit(0);

try {
  const text = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.json')) JSON.parse(text);
  if (file.endsWith('.md')) {
    if (!text.trim()) throw new Error('Markdown file is empty');
    const fences = (text.match(/```/g) ?? []).length;
    if (fences % 2 !== 0) throw new Error('Markdown has an unclosed fenced code block');
    if (file.includes(`${path.sep}docs${path.sep}`) && !/^#\s+\S/m.test(text)) {
      throw new Error('Published documentation page must contain an H1 heading');
    }
  }
} catch (error) {
  advisory(`Artifact validation failed for ${raw}: ${error.message}. Fix the file before completing the task.`);
}
