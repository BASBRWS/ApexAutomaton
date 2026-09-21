import type { Config } from '../config.js';
import type { AutomatonState } from '../types.js';

/**
 * Phase 2 — state backend abstraction. Phase 1 committed a JSON file under
 * /state; this seam lets the same loop persist to Firestore instead when
 * FIRESTORE_* is configured, without the loop caring which.
 */
export interface StateStore {
  readonly name: string;
  load(cfg: Config): Promise<AutomatonState>;
  save(state: AutomatonState): Promise<void>;
}
