import fs from 'node:fs';
import path from 'node:path';
import { CONSTITUTION_DIR } from '../paths.js';

/**
 * Loads the read-only constitution law files, freshly each cycle. Nothing here
 * ever writes: the constitution is operator-owned and immutable to the agent.
 * All `.md` files in this directory are concatenated in filename order.
 */
export function loadConstitution(): string {
  let files: string[];
  try {
    files = fs
      .readdirSync(CONSTITUTION_DIR)
      .filter((f) => f.endsWith('.md'))
      .sort();
  } catch {
    return '';
  }
  return files
    .map((f) => fs.readFileSync(path.join(CONSTITUTION_DIR, f), 'utf8').trim())
    .join('\n\n');
}
