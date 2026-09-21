import type { Config } from '../config.js';
import { FileStateStore } from './fileStore.js';
import { FirestoreStateStore } from './firestoreStore.js';
import type { StateStore } from './store.js';

export type { StateStore } from './store.js';
export { FileStateStore } from './fileStore.js';
export { FirestoreStateStore } from './firestoreStore.js';

/**
 * Choose the state backend. Defaults to the committed file store; uses the
 * Firestore scaffold only when FIRESTORE_PROJECT_ID is present (Phase 2).
 */
export function makeStateStore(cfg: Config): StateStore {
  if (cfg.firestore.enabled) {
    return new FirestoreStateStore(cfg);
  }
  return new FileStateStore();
}
