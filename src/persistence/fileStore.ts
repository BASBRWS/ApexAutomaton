import type { Config } from '../config.js';
import { loadState, saveState } from '../state.js';
import type { AutomatonState } from '../types.js';
import type { StateStore } from './store.js';

/**
 * The Phase 1 default: state lives in a committed JSON file under /state. The
 * heartbeat workflow commits it back to the repo each cycle.
 */
export class FileStateStore implements StateStore {
  readonly name = 'file';

  async load(cfg: Config): Promise<AutomatonState> {
    return loadState(cfg);
  }

  async save(state: AutomatonState): Promise<void> {
    saveState(state);
  }
}
