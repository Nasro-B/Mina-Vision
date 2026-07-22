import { describe, expect, it } from 'vitest';
import { analyzeEntries, analyzeError } from '../src/diagnostics/error-analyst.mjs';

describe('error-analyst', () => {
  it.each([
    ["Error invoking remote method 'mina:start': Error: memory_locked", 'bloquant', /Déverrouiller/u],
    ['Error while decrypting the ciphertext provided to safeStorage.decryptString.', 'bloquant', /phrase de récupération/u],
    ['keyring_already_initialized', 'info', /pas « Initialiser »/u],
    ['sandbox_unavailable:windows_sandbox_feature_disabled', 'dégradé', /Windows Sandbox/u],
    ['git_not_a_repository', 'info', /git init/u],
    ['web_answer_http_429', 'transitoire', /quelques minutes/u],
    ['Connection error.', 'transitoire', /connexion internet/u],
    ['Session Gemini Live non connectée.', 'transitoire', /reprise est automatique/u],
    ['samsung_adb_wifi_reconnect_pending — adb_mdns_peer_not_discovered', 'dégradé', /débogage sans fil/u],
    ['page.screenshot: Target page, context or browser has been closed', 'transitoire', /Relancer la mission/u],
    ['domain_degraded mail', 'dégradé', /Re-saisir/u],
  ])('analyse « %s » → %s avec remède', (message, gravite, remedePattern) => {
    const analysis = analyzeError(message);
    expect(analysis.connue).toBe(true);
    expect(analysis.gravite).toBe(gravite);
    expect(analysis.remede).toMatch(remedePattern);
    expect(analysis.explication.length).toBeGreaterThan(10);
  });

  it('erreur inconnue → honnête, jamais inventée', () => {
    const analysis = analyzeError('zorglub_flux_capacitor_panic');
    expect(analysis.connue).toBe(false);
    expect(analysis.gravite).toBe('inconnue');
    expect(analysis.explication).toContain('non répertoriée');
  });

  it('analyzeEntries enrichit chaque entrée du journal technique sans la modifier', () => {
    const entries = [
      { at: 1, severity: 'error', code: 'mission_request_failed', message: 'Error: memory_locked' },
      { at: 2, severity: 'warning', code: 'inconnu_total', message: 'mystère' },
    ];
    const enriched = analyzeEntries(entries);
    expect(enriched[0].code).toBe('mission_request_failed');
    expect(enriched[0].analyse.gravite).toBe('bloquant');
    expect(enriched[1].analyse.connue).toBe(false);
    expect(Object.isFrozen(enriched)).toBe(true);
    expect(Object.isFrozen(enriched[0])).toBe(true);
  });
});
