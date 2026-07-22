import { hkdfSync } from 'node:crypto';
import { openMemoryDatabase } from './database.mjs';
import { createEventRepository } from './event-repository.mjs';
import { createForgetService } from './forget-service.mjs';
import { createIdentityGraph } from './identity-graph.mjs';
import { createIdentityRepository } from './identity-repository.mjs';
import { createMemoryService } from './memory-service.mjs';
import { createSalienceTracker } from './memory-ranking.mjs';
import { createTombstoneRepository } from './tombstone-repository.mjs';
import { createFilePolicy } from '../research/file-policy.mjs';
import { createFileReader } from '../research/file-reader.mjs';
import { createResearchService } from '../research/research-service.mjs';
import { createWebReader } from '../research/web-reader.mjs';
import { createVectorStore } from '../rag/vector-store.mjs';

const KEY_SALT = Buffer.from('Mina Vision local memory v1', 'utf8');

function derive(masterKey, purpose) {
  return Buffer.from(hkdfSync('sha256', masterKey, KEY_SALT, Buffer.from(purpose, 'utf8'), 32));
}

export async function createMemoryServices({
  masterKey,
  databasePath,
  approvedRoots = [],
  getWebPage,
  backupConfigured = false,
  securePermissions,
  nativeBinding,
  embedder = null,
} = {}) {
  const rootKey = Buffer.from(masterKey ?? []);
  if (rootKey.length !== 32 || !databasePath || typeof getWebPage !== 'function') {
    throw new TypeError('memory_composition_configuration_required');
  }
  const encryptionKey = derive(rootKey, 'record-encryption');
  const indexKey = derive(rootKey, 'blind-index');
  rootKey.fill(0);
  let db;
  try {
    db = openMemoryDatabase({
      filename: databasePath,
      ...(securePermissions ? { securePermissions } : {}),
      ...(nativeBinding ? { nativeBinding } : {}),
    });
    const identityRepository = createIdentityRepository({ db, encryptionKey, indexKey });
    const identityGraph = createIdentityGraph({ identityRepository });
    if (!identityRepository.readIdentity('owner')) {
      identityGraph.registerOwner({ id: 'owner', displayName: 'Nasro', createdAt: Date.now() });
    }
    const eventRepository = createEventRepository({ db, encryptionKey, indexKey });
    const tombstoneRepository = createTombstoneRepository({ db, encryptionKey, indexKey });
    const vectorStore = embedder ? createVectorStore({ db, encryptionKey }) : null;
    // Salience active dans le runtime réel : récence + accès répétés pondèrent le CLASSEMENT du
    // rappel (jamais l'existence — plancher garanti par rankScore, aucune expiration).
    const memoryService = createMemoryService({
      eventRepository, identityGraph, embedder, vectorStore, salience: createSalienceTracker(),
    });
    const forgetService = createForgetService({
      db, eventRepository, tombstoneRepository, encryptionKey, indexKey,
    });
    const policy = await createFilePolicy({ approvedRoots });
    const fileReader = createFileReader({ policy });
    const webReader = Object.freeze({
      read: async (input) => createWebReader({ page: await getWebPage() }).read(input),
    });
    const researchService = createResearchService({ fileReader, webReader });
    let closed = false;
    return Object.freeze({
      memoryService,
      forgetService,
      researchService,
      semanticMode: embedder ? 'semantic_local' : 'lexical_degraded',
      backupState: backupConfigured ? 'configured' : 'disabled',
      close() {
        if (closed) return;
        closed = true;
        db.close();
        encryptionKey.fill(0);
        indexKey.fill(0);
      },
    });
  } catch (error) {
    if (db?.open) db.close();
    encryptionKey.fill(0);
    indexKey.fill(0);
    throw error;
  }
}
