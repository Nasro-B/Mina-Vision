import { describe, expect, it } from 'vitest';
import { createRuntimeCapabilityCatalog } from '../src/runtime/capability-catalog.mjs';

describe('runtime capability catalog (Task 8)', () => {
  it('publie l\'état réel et requireAvailable refuse un domaine indisponible', () => {
    const catalog = createRuntimeCapabilityCatalog({ clock: () => 1 });
    catalog.report({ id: 'biometrics.face', status: 'unavailable', reason: 'face_embedding_pipeline_not_implemented', evidence: ['unit'] });
    expect(() => catalog.requireAvailable('biometrics.face')).toThrow('capability_unavailable:biometrics.face');
    expect(catalog.get('biometrics.face')).toMatchObject({ status: 'unavailable', reason: 'face_embedding_pipeline_not_implemented' });
  });

  it('un domaine jamais rapporté est indisponible ; degraded reste utilisable', () => {
    const catalog = createRuntimeCapabilityCatalog({ clock: () => 1 });
    expect(() => catalog.requireAvailable('inconnu')).toThrow('capability_unavailable:inconnu');
    catalog.report({ id: 'home', status: 'degraded', reason: 'aucun_connecteur_configure' });
    expect(catalog.requireAvailable('home').status).toBe('degraded');
  });

  it('exige une raison hors available et refuse toute preuve sensible', () => {
    const catalog = createRuntimeCapabilityCatalog({ clock: () => 1 });
    expect(() => catalog.report({ id: 'x', status: 'degraded' })).toThrow('capability_reason_required');
    expect(() => catalog.report({ id: 'x', status: 'degraded', reason: 'token=abc' })).toThrow('capability_evidence_sensitive');
    catalog.report({ id: 'mail', status: 'available' });
    expect(JSON.stringify(catalog.list())).not.toMatch(/token|secret|private_key/iu);
  });

  it('list est trié, gelé, avec horodatage', () => {
    const catalog = createRuntimeCapabilityCatalog({ clock: () => 42 });
    catalog.report({ id: 'voice', status: 'available' });
    catalog.report({ id: 'code', status: 'available' });
    const list = catalog.list();
    expect(list.map((entry) => entry.id)).toEqual(['code', 'voice']);
    expect(list[0].reportedAt).toBe(42);
    expect(Object.isFrozen(list)).toBe(true);
  });
});
