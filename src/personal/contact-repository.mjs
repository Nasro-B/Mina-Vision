export function createContactRepository({ repository } = {}) {
  if (!repository?.put || !repository?.get || !repository?.list) {
    throw new TypeError('contact_repository_backing_store_required');
  }

  return Object.freeze({
    async put(person) {
      await repository.put(person.personId, person);
      return person;
    },

    async get(personId) {
      return (await repository.get(personId)) ?? null;
    },

    async list() {
      return Object.freeze(await repository.list());
    },

    async delete(personId) {
      if (repository.delete) await repository.delete(personId);
    },
  });
}
