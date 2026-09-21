import type { Config } from '../config.js';
import type { AutomatonState } from '../types.js';
import type { StateStore } from './store.js';

/**
 * Phase 2 SCAFFOLD — Firestore state backend. Off unless FIRESTORE_PROJECT_ID
 * is set. Not implemented: the methods throw with a clear pointer so nobody
 * mistakes the scaffold for a working backend. Wiring it up is deliberately
 * left as a Phase 2 task.
 *
 * To implement: add `@google-cloud/firestore`, construct a client from
 * cfg.firestore.projectId, and read/write a single document
 * (cfg.firestore.collection / cfg.firestore.documentId) holding AutomatonState.
 */
export class FirestoreStateStore implements StateStore {
  readonly name = 'firestore';

  constructor(private readonly cfg: Config) {
    if (!cfg.firestore.enabled || !cfg.firestore.projectId) {
      throw new Error('FirestoreStateStore requires FIRESTORE_PROJECT_ID');
    }
  }

  async load(_cfg: Config): Promise<AutomatonState> {
    throw new Error(
      'FirestoreStateStore.load is a Phase 2 scaffold — not implemented. ' +
        'Add @google-cloud/firestore and read the state document, or unset ' +
        'FIRESTORE_PROJECT_ID to use the file store.',
    );
  }

  async save(_state: AutomatonState): Promise<void> {
    throw new Error(
      'FirestoreStateStore.save is a Phase 2 scaffold — not implemented. ' +
        'Add @google-cloud/firestore and write the state document.',
    );
  }
}
