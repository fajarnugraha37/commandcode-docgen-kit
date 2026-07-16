import { active, readStdinJson, deny } from './docgen-common.mjs';
const payload = await readStdinJson();
if (!active()) process.exit(0);
const command = String(payload.tool_input?.command ?? '').trim();
if (!command) process.exit(0);

// Conservative: no chaining, redirection, command substitution, or known mutators.
const forbiddenSyntax = /(?:&&|\|\||[;><`]|\$\(|\r|\n)/;
const mutators = /\b(?:rm|rmdir|del|erase|mv|move|cp|copy|mkdir|md|touch|tee|chmod|chown|git\s+(?:checkout|restore|reset|clean|switch|commit|merge|rebase|cherry-pick|apply)|sed\s+-i|perl\s+-pi|npm\s+(?:install|i|uninstall)|pnpm\s+(?:install|add|remove)|yarn\s+(?:add|remove|install)|mvn\s+clean|gradle\s+clean)\b/i;
if (forbiddenSyntax.test(command) || mutators.test(command)) {
  deny('DocGen shell policy allows only ignore-safe inspection. Repository-wide source search must use `docgen source-grep`; source enumeration must use `docgen source-list`. Use filesystem tools for reads and write_file/edit_file for outputs under docs/** or .docgen/**.');
  process.exit(0);
}

const allowedStart = /^(?:ls|dir|git\s+(?:status|log|branch|rev-parse|ls-files)|java\s+-version|javac\s+-version|mvn\s+(?:-version|--version)|gradle\s+(?:-version|--version)|node\s+(?:-v|--version)|docgen\s+(?:source-list|source-grep|ignore)\b)/i;
if (!allowedStart.test(command)) {
  deny(`DocGen shell command is outside the read-only allowlist: ${command}`);
}
