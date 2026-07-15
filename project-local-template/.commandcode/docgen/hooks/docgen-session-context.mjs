import { active, readStdinJson, jsonOut } from './docgen-common.mjs';
await readStdinJson();
if (!active()) process.exit(0);
const stage = process.env.DOCGEN_STAGE ?? 'unknown';
const target = process.env.DOCGEN_TARGET ?? '';
jsonOut({
  suppressOutput: true,
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: [
      'DOCGEN_MODE is active.',
      `Current stage: ${stage}.`,
      target ? `Current target: ${target}.` : '',
      'Writes are restricted to docs/** and .docgen/**. Do not modify application source or configuration.',
      'Prefer read_file/read_multiple_files/read_directory/glob/grep. Shell use is intentionally conservative and read-only.',
    ].filter(Boolean).join(' '),
  },
});
