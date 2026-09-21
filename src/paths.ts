import path from 'node:path';

/**
 * Filesystem locations, all resolved from the current working directory (the
 * repo root, where `npm run tick` is invoked). Avoids ESM `__dirname` pitfalls.
 */
export const REPO_ROOT = process.cwd();

export const STATE_DIR = path.resolve(REPO_ROOT, 'state');
export const STATE_FILE = path.join(STATE_DIR, 'state.json');
export const JOURNAL_FILE = path.join(STATE_DIR, 'journal.ndjson');
export const OBITUARY_DIR = path.join(STATE_DIR, 'obituaries');
export const CHILDREN_SECRET_DIR = path.join(STATE_DIR, 'children');
export const KILL_FILE = path.join(STATE_DIR, 'KILL');

export const SOUL_FILE = path.resolve(REPO_ROOT, 'SOUL.md');
export const CONSTITUTION_DIR = path.resolve(REPO_ROOT, 'src', 'constitution');
