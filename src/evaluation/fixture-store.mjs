function validateFixture(fixture) {
  if (!fixture || typeof fixture.fixtureId !== 'string' || fixture.fixtureId.length === 0) {
    throw new TypeError('evaluation_fixture_id_required');
  }
  if (typeof fixture.prompt !== 'string' || fixture.prompt.length === 0) {
    throw new TypeError('evaluation_fixture_prompt_required');
  }
  if (typeof fixture.expectedClaimSupported !== 'boolean') {
    throw new TypeError('evaluation_fixture_expected_claim_supported_required');
  }
}

export function createFixtureStore() {
  const suites = new Map();

  return Object.freeze({
    addFixture(suiteId, fixture) {
      validateFixture(fixture);
      const normalized = Object.freeze({
        fixtureId: fixture.fixtureId,
        prompt: fixture.prompt,
        expectedAction: fixture.expectedAction ?? null,
        expectedClaimSupported: fixture.expectedClaimSupported,
        expectedCitations: Object.freeze([...(fixture.expectedCitations ?? [])]),
      });
      const existing = suites.get(suiteId) ?? [];
      suites.set(suiteId, [...existing.filter((entry) => entry.fixtureId !== fixture.fixtureId), normalized]);
      return normalized;
    },

    listFixtures(suiteId) {
      return Object.freeze([...(suites.get(suiteId) ?? [])]);
    },
  });
}
