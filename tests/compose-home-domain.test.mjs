import { describe, expect, it, vi } from 'vitest';
import { composeHomeDomain } from '../src/home/compose-home-domain.mjs';

describe('compose home domain (maison connectée — connecteurs réels)', () => {
  it('sans configuration → disabled, aucun connecteur, raison honnête', () => {
    const result = composeHomeDomain({ env: {} });
    expect(result).toMatchObject({ state: 'disabled', reason: 'aucun_connecteur_configure' });
    expect(Object.keys(result.connectors)).toEqual([]);
  });

  it('Home Assistant configuré (URL locale HTTPS + jeton) → connecteur réel construit', () => {
    const result = composeHomeDomain({
      env: { HOME_ASSISTANT_BASE_URL: 'https://homeassistant.local:8123', HOME_ASSISTANT_TOKEN: 'tok-abc' },
      fetchImpl: vi.fn(),
    });
    expect(result.state).toBe('configured');
    expect(result.connectors['home-assistant']?.id).toBe('home-assistant');
    expect(typeof result.connectors['home-assistant'].discoverEntities).toBe('function');
  });

  it('config Home Assistant incomplète (jeton manquant) → disabled avec raison', () => {
    const result = composeHomeDomain({ env: { HOME_ASSISTANT_BASE_URL: 'https://homeassistant.local:8123' } });
    expect(result).toMatchObject({ state: 'disabled', reason: 'home_assistant_config_incomplete' });
  });

  it('URL Home Assistant non-HTTPS-locale → rejetée par l\'adaptateur, notée, jamais un crash', () => {
    const result = composeHomeDomain({ env: { HOME_ASSISTANT_BASE_URL: 'http://8.8.8.8', HOME_ASSISTANT_TOKEN: 'x' }, fetchImpl: vi.fn() });
    expect(result.state).toBe('disabled');
    expect(result.reason).toMatch(/home_assistant_invalide/u);
  });

  it('MQTT configuré → signalé indisponible (dépendance retirée R-16), jamais faussement branché', () => {
    const result = composeHomeDomain({ env: { MQTT_BROKER_URL: 'mqtts://broker.local:8883' } });
    expect(result.state).toBe('disabled');
    expect(result.reason).toMatch(/mqtt_indisponible_dependance_retiree/u);
    expect(result.connectors.mqtt).toBeUndefined();
  });
});
