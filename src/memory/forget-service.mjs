import { randomUUID } from 'node:crypto';
import { blindHash, sealRecord } from './record-codec.mjs';

function normalize(text) {
  return String(text ?? '').normalize('NFKC').toLocaleLowerCase('fr-FR');
}

function matches(event, criteria) {
  if (criteria.eventId) return event.id === criteria.eventId;
  if (criteria.subject) return normalize(event.content).includes(normalize(criteria.subject));
  if (criteria.identity) return event.identity === criteria.identity;
  if (criteria.from !== undefined || criteria.to !== undefined) {
    return (criteria.from === undefined || event.createdAt >= criteria.from)
      && (criteria.to === undefined || event.createdAt <= criteria.to);
  }
  return false;
}

function validateCriteria(criteria) {
  const selectors = ['eventId', 'subject', 'identity'].filter((key) => criteria?.[key] !== undefined);
  const hasInterval = criteria?.from !== undefined || criteria?.to !== undefined;
  if (selectors.length + Number(hasInterval) !== 1) throw new TypeError('invalid_forget_criteria');
  if (hasInterval && criteria.from !== undefined && criteria.to !== undefined && criteria.from > criteria.to) {
    throw new TypeError('invalid_forget_interval');
  }
}

export function createForgetService({
  db,
  eventRepository,
  tombstoneRepository,
  encryptionKey,
  indexKey,
  idGenerator = randomUUID,
  now = Date.now,
} = {}) {
  if (!db || !eventRepository?.listAll || !eventRepository?.deleteByIds
    || !tombstoneRepository?.write || !tombstoneRepository?.hasTarget
    || Buffer.from(encryptionKey ?? []).length !== 32 || Buffer.from(indexKey ?? []).length !== 32) {
    throw new TypeError('forget_service_dependencies_required');
  }
  const proposals = new Map();
  const insertOutbox = db.prepare(`
    INSERT INTO outbox_backup (
      outbox_id, entity_type_hash, entity_id_hash, ciphertext, created_at, sync_state
    ) VALUES (?, ?, ?, ?, ?, 0)
  `);

  function proposeForget({ criteria, requester = 'local' } = {}) {
    validateCriteria(criteria);
    const proposal = Object.freeze({
      id: idGenerator(),
      criteria: structuredClone(criteria),
      requester,
      status: 'awaiting_local_confirmation',
    });
    proposals.set(proposal.id, proposal);
    return structuredClone(proposal);
  }

  const commitForget = db.transaction((proposal) => {
    const allEvents = eventRepository.listAll();
    const selected = new Set(allEvents.filter((event) => matches(event, proposal.criteria)).map(({ id }) => id));
    let changed = true;
    while (changed) {
      changed = false;
      for (const event of allEvents) {
        if (!selected.has(event.id) && event.sourceEventIds?.some((sourceId) => selected.has(sourceId))) {
          selected.add(event.id);
          changed = true;
        }
      }
    }
    const eventIds = [...selected].filter((id) => !tombstoneRepository.hasTarget(`event:${id}`));
    const completedAt = now();
    for (const eventId of eventIds) {
      const target = `event:${eventId}`;
      const tombstoneId = idGenerator();
      tombstoneRepository.write({
        id: tombstoneId,
        target,
        createdAt: completedAt,
        reason: { criteria: proposal.criteria, requester: proposal.requester },
      });
      const outboxId = idGenerator();
      insertOutbox.run(
        outboxId,
        blindHash(indexKey, 'outbox_entity_type', 'tombstone'),
        blindHash(indexKey, 'outbox_entity_id', tombstoneId),
        sealRecord({
          key: encryptionKey,
          type: 'backup_outbox',
          id: outboxId,
          value: { operation: 'delete', target, tombstoneId, createdAt: completedAt },
        }),
        completedAt,
      );
    }
    const deleted = eventRepository.deleteByIds(eventIds);
    return Object.freeze({
      matched: eventIds.length,
      deleted,
      backupPending: eventIds.length,
      completedAt,
    });
  });

  function confirmForget({ proposalId, confirmedLocally } = {}) {
    const proposal = proposals.get(proposalId);
    if (!proposal) throw new Error('forget_proposal_not_found');
    if (confirmedLocally !== true) throw new Error('local_forget_confirmation_required');
    const report = commitForget(proposal);
    proposals.delete(proposalId);
    return report;
  }

  function filterRestorable(events) {
    return events.filter((event) => !tombstoneRepository.hasTarget(`event:${event.id}`));
  }

  return Object.freeze({ proposeForget, confirmForget, filterRestorable });
}
