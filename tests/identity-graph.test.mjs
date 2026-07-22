import { describe, expect, it } from 'vitest';
import { createIdentityGraph } from '../src/memory/identity-graph.mjs';

describe('identity graph', () => {
  it('requires a verified local pairing proof for remote identifiers', () => {
    const graph = createIdentityGraph();
    graph.registerOwner({ id: 'nasro' });

    expect(() => graph.link({
      ownerId: 'nasro', kind: 'telegram', value: '12345', proof: { verified: false },
    })).toThrow('identity_pairing_proof_required');
    expect(graph.resolve({ kind: 'telegram', value: '12345' })).toBeNull();
  });

  it('refuses a phone collision between two owners', () => {
    const graph = createIdentityGraph();
    graph.registerOwner({ id: 'nasro' });
    graph.registerOwner({ id: 'other' });
    graph.link({
      ownerId: 'nasro', kind: 'phone', value: '+33612345678',
      proof: { verified: true, method: 'local_pairing' },
    });

    expect(() => graph.link({
      ownerId: 'other', kind: 'phone', value: '+33612345678',
      proof: { verified: true, method: 'local_pairing' },
    })).toThrow('identity_link_collision');
    expect(graph.resolve({ kind: 'phone', value: '+33612345678' }).id).toBe('nasro');
  });
});
