import { randomUUID } from 'node:crypto';

const CHANNELS = new Set(['email', 'phone', 'telegram']);
const VALUE_PATTERN = Object.freeze({
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/u,
  phone: /^\+[1-9]\d{1,14}$/u,
  telegram: /^\d+$/u,
});

function endpointsEqual(a, b) {
  return a.channel === b.channel && a.value === b.value;
}

export function createContactService({ repository, hub, identityGraph = null, confirmationService, clock } = {}) {
  if (!repository?.get || !repository?.put) throw new TypeError('contact_service_repository_required');
  if (!hub?.adapter) throw new TypeError('contact_service_hub_required');
  if (!confirmationService?.confirm) throw new TypeError('contact_service_confirmation_service_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('contact_service_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());
  const pendingLinks = new Map();

  async function requireConfirmation(reason) {
    const confirmed = await confirmationService.confirm({ reason });
    if (!confirmed) throw new Error('confirmation_refused');
  }

  async function requirePerson(personId) {
    const person = await repository.get(personId);
    if (!person || person.tombstoned) throw new Error('contact_not_found');
    return person;
  }

  return Object.freeze({
    async list() {
      return Object.freeze(await repository.list());
    },

    async sync(providerId) {
      const provider = hub.adapter(providerId);
      const page = await provider.sync({ cursor: null, resource: 'contacts' });
      for (const item of page.items) {
        // eslint-disable-next-line no-await-in-loop
        await repository.put(item);
      }
      for (const removedId of page.removedIds) {
        // eslint-disable-next-line no-await-in-loop
        await repository.delete(removedId);
      }
      return Object.freeze({ synced: page.items.length, removed: page.removedIds.length });
    },

    async resolveEndpoint({ personId, channel, purpose }) {
      const person = await requirePerson(personId);
      const candidates = person.endpoints.filter((endpoint) => endpoint.channel === channel);
      const verified = candidates.find((endpoint) => endpoint.verified);
      if (purpose === 'send') {
        return verified ? Object.freeze({ status: 'resolved', value: verified.value }) : Object.freeze({ status: 'unverified' });
      }
      if (verified) return Object.freeze({ status: 'resolved', value: verified.value });
      if (candidates.length > 0) return Object.freeze({ status: 'candidate', value: candidates[0].value });
      return Object.freeze({ status: 'unverified' });
    },

    async proposeLink({ personId, channel, value, proof = null }) {
      if (!CHANNELS.has(channel)) throw new Error('contact_link_channel_invalid');
      if (!VALUE_PATTERN[channel].test(String(value ?? ''))) throw new Error('contact_link_value_invalid');
      await requirePerson(personId);
      const linkId = randomUUID();
      pendingLinks.set(linkId, Object.freeze({ linkId, personId, channel, value, proof, proposedAt: now() }));
      return Object.freeze({ linkId, status: 'pending', personId, channel, value });
    },

    async confirmLink(linkId) {
      const link = pendingLinks.get(linkId);
      if (!link) throw new Error('contact_link_not_found');
      await requireConfirmation(`Relier ${link.channel}:${link.value} au contact ${link.personId}`);
      pendingLinks.delete(linkId);
      const person = await requirePerson(link.personId);
      const endpoint = Object.freeze({ channel: link.channel, value: link.value, verified: true });
      const endpoints = person.endpoints.some((existing) => endpointsEqual(existing, endpoint))
        ? person.endpoints.map((existing) => (endpointsEqual(existing, endpoint) ? endpoint : existing))
        : [...person.endpoints, endpoint];
      const updated = Object.freeze({ ...person, endpoints: Object.freeze(endpoints) });
      return repository.put(updated);
    },

    async merge({ intoPersonId, fromPersonId, reason }) {
      if (typeof reason !== 'string' || reason.trim().length === 0) throw new Error('contact_merge_reason_required');
      const into = await requirePerson(intoPersonId);
      const from = await requirePerson(fromPersonId);
      await requireConfirmation(`Fusionner ${fromPersonId} dans ${intoPersonId} : ${reason}`);

      const merged = [...into.endpoints];
      for (const endpoint of from.endpoints) {
        if (!merged.some((existing) => endpointsEqual(existing, endpoint))) merged.push(endpoint);
      }
      const updatedInto = Object.freeze({ ...into, endpoints: Object.freeze(merged) });
      await repository.put(updatedInto);
      await repository.put(Object.freeze({
        personId: fromPersonId, tombstoned: true, mergedInto: intoPersonId, mergedAt: now(), reason,
      }));
      return updatedInto;
    },

    async split({ personId, endpoint }) {
      const person = await requirePerson(personId);
      const found = person.endpoints.find((existing) => endpointsEqual(existing, endpoint));
      if (!found) throw new Error('contact_endpoint_not_found');

      const remaining = person.endpoints.filter((existing) => !endpointsEqual(existing, endpoint));
      const updatedOriginal = Object.freeze({ ...person, endpoints: Object.freeze(remaining) });
      await repository.put(updatedOriginal);

      const newPersonId = randomUUID();
      const newPerson = Object.freeze({
        personId: newPersonId, providerId: person.providerId, displayName: person.displayName,
        endpoints: Object.freeze([found]), revision: `split:${now()}`, splitFrom: personId,
      });
      await repository.put(newPerson);
      return Object.freeze({ original: updatedOriginal, newPerson });
    },
  });
}
