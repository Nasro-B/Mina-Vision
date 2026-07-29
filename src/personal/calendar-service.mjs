import { randomUUID } from 'node:crypto';

function fieldsEqual(a, b, fields) {
  return fields.every((field) => a[field] === b[field]);
}

function requireProviderCapability(provider, capability) {
  if (!Array.isArray(provider?.capabilities) || !provider.capabilities.includes(capability)) {
    throw new Error(`personal_action_unsupported_by_provider:${capability}`);
  }
}

export function createCalendarService({
  hub, repository, capabilityBroker, actionVerifier, confirmationService, clock,
} = {}) {
  if (!hub?.adapter) throw new TypeError('calendar_service_hub_required');
  if (!repository?.put) throw new TypeError('calendar_service_repository_required');
  if (!capabilityBroker?.authorize) throw new TypeError('calendar_service_capability_broker_required');
  if (!actionVerifier?.verify) throw new TypeError('calendar_service_action_verifier_required');
  if (!confirmationService?.confirm) throw new TypeError('calendar_service_confirmation_service_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('calendar_service_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());
  const proposals = new Map();

  async function requireConfirmation(reason) {
    const confirmed = await confirmationService.confirm({ reason });
    if (!confirmed) throw new Error('confirmation_refused');
  }

  return Object.freeze({
    async sync(providerId) {
      const provider = hub.adapter(providerId);
      const cursor = await repository.getCursor(providerId);
      let page;
      try {
        page = await provider.sync({ cursor, resource: 'calendar' });
      } catch (error) {
        if (error.message !== 'personal_sync_resync_required') throw error;
        page = await provider.sync({ cursor: null, resource: 'calendar' });
      }
      for (const item of page.items) {
        // eslint-disable-next-line no-await-in-loop
        await repository.put(item);
      }
      for (const removedId of page.removedIds) {
        // eslint-disable-next-line no-await-in-loop
        await repository.delete(removedId);
      }
      await repository.setCursor(providerId, page.cursor);
      return Object.freeze({ synced: page.items.length, removed: page.removedIds.length, cursor: page.cursor });
    },

    list: (filters) => repository.list(filters),
    get: (eventId) => repository.get(eventId),

    async proposeCreate(input) {
      const proposalId = randomUUID();
      proposals.set(proposalId, Object.freeze({ type: 'create', input, createdAt: now() }));
      return Object.freeze({ proposalId, status: 'proposed', type: 'create', input });
    },

    async proposeUpdate({ eventId, patch }) {
      const current = await repository.get(eventId);
      if (!current) throw new Error('calendar_event_not_found');
      const proposalId = randomUUID();
      proposals.set(proposalId, Object.freeze({ type: 'update', eventId, patch, baselineRevision: current.revision, createdAt: now() }));
      return Object.freeze({ proposalId, status: 'proposed', type: 'update', eventId, patch });
    },

    async commitProposal(proposalId) {
      const proposal = proposals.get(proposalId);
      if (!proposal) throw new Error('proposal_not_found');

      const providerId = proposal.type === 'create' ? proposal.input.providerId : (await repository.get(proposal.eventId)).providerId;
      const provider = hub.adapter(providerId);
      if (proposal.type === 'create') {
        requireProviderCapability(provider, 'createEvent');
        requireProviderCapability(provider, 'getEvent');
      } else {
        requireProviderCapability(provider, 'updateEvent');
        requireProviderCapability(provider, 'getEvent');
      }
      proposals.delete(proposalId);

      await capabilityBroker.authorize({ capability: 'personal.calendar', effect: proposal.type === 'create' ? 'write' : 'write' });
      await requireConfirmation(proposal.type === 'create' ? 'Créer un événement calendrier' : 'Modifier un événement calendrier');

      if (proposal.type === 'create') {
        const receipt = await provider.createEvent(proposal.input);
        const verified = await provider.getEvent(receipt.eventId);
        const evidence = await actionVerifier.verify({
          action: { name: 'calendar.create', expectedEffect: proposal.input }, receipt, expectedEffect: proposal.input,
        });
        if (!evidence.confirmed || !fieldsEqual(verified, proposal.input, ['title'])) throw new Error('action_unverified');
        return repository.put(verified);
      }

      const currentRemote = await provider.getEvent(proposal.eventId);
      if (currentRemote.revision !== proposal.baselineRevision) throw new Error('sync_conflict');

      const receipt = await provider.updateEvent({ eventId: proposal.eventId, patch: proposal.patch, expectedRevision: proposal.baselineRevision });
      const verified = await provider.getEvent(proposal.eventId);
      const evidence = await actionVerifier.verify({
        action: { name: 'calendar.update', expectedEffect: proposal.patch }, receipt, expectedEffect: proposal.patch,
      });
      const patchApplied = Object.keys(proposal.patch).every((field) => verified[field] === proposal.patch[field]);
      if (!evidence.confirmed || !patchApplied) throw new Error('action_unverified');
      return repository.put(verified);
    },

    async cancel(eventId) {
      const current = await repository.get(eventId);
      if (!current) throw new Error('calendar_event_not_found');
      const provider = hub.adapter(current.providerId);
      requireProviderCapability(provider, 'cancelEvent');
      await capabilityBroker.authorize({ capability: 'personal.calendar', effect: 'write' });
      await requireConfirmation('Annuler un événement calendrier');
      await provider.cancelEvent(eventId);
      await repository.delete(eventId);
      return Object.freeze({ eventId, cancelled: true });
    },
  });
}
