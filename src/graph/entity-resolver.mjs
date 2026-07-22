const STRONG_FIELDS = Object.freeze(['email', 'phone']);

export function createEntityResolver({ repository } = {}) {
  if (!repository?.findByAttribute) throw new TypeError('entity_resolver_repository_required');

  return Object.freeze({
    async resolve({ name = null, email = null, phone = null } = {}) {
      for (const field of STRONG_FIELDS) {
        const value = field === 'email' ? email : phone;
        if (!value) continue;
        // eslint-disable-next-line no-await-in-loop
        const matches = await repository.findByAttribute(field, value);
        if (matches.length === 1) return Object.freeze({ status: 'exact', entityId: matches[0].entityId });
        if (matches.length > 1) return Object.freeze({ status: 'ambiguous', candidates: Object.freeze(matches.map((m) => m.entityId)) });
      }

      if (name) {
        const nameMatches = await repository.findByAttribute('name', name);
        if (nameMatches.length > 0) {
          return Object.freeze({ status: 'ambiguous', candidates: Object.freeze(nameMatches.map((m) => m.entityId)) });
        }
      }

      return Object.freeze({ status: 'new' });
    },
  });
}
