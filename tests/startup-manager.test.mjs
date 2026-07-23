import { describe, expect, it, vi } from 'vitest';
import { createStartupManager, STARTUP_HIDDEN_ARG } from '../src/system/startup-manager.mjs';

const harness = ({ openAtLogin = false, wasOpenedAtLogin = false, applyFails = false, ...rest } = {}) => {
  let state = { openAtLogin, wasOpenedAtLogin };
  const setLoginItemSettings = vi.fn((settings) => {
    if (applyFails) return;
    state = { ...state, openAtLogin: settings.openAtLogin };
  });
  const getLoginItemSettings = vi.fn(() => ({ ...state }));
  return {
    setLoginItemSettings,
    getLoginItemSettings,
    manager: createStartupManager({
      getLoginItemSettings, setLoginItemSettings, executablePath: 'C:\\Mina\\Mina.exe', ...rest,
    }),
  };
};

describe('démarrage automatique Windows', () => {
  it('exige ses dépendances', () => {
    expect(() => createStartupManager({})).toThrow('startup_manager_dependencies_required');
  });

  it('rapporte l\'état réel, désactivé par défaut', () => {
    const { manager } = harness();
    expect(manager.status()).toMatchObject({ enabled: false, startedAtLogin: false });
  });

  it('active le démarrage avec lancement discret et argument dédié', () => {
    const { manager, setLoginItemSettings } = harness();
    expect(manager.set(true)).toMatchObject({ enabled: true, requested: true, applied: true });
    expect(setLoginItemSettings).toHaveBeenCalledWith(expect.objectContaining({
      openAtLogin: true,
      openAsHidden: true,
      path: 'C:\\Mina\\Mina.exe',
      args: [STARTUP_HIDDEN_ARG],
    }));
  });

  it('désactive et le prouve en relisant Windows', () => {
    const { manager } = harness({ openAtLogin: true });
    expect(manager.status().enabled).toBe(true);
    expect(manager.set(false)).toMatchObject({ enabled: false, applied: true });
    expect(manager.status().enabled).toBe(false);
  });

  it('dit la vérité quand Windows n\'applique pas le réglage', () => {
    const { manager } = harness({ applyFails: true });
    expect(manager.set(true)).toMatchObject({ enabled: false, requested: true, applied: false });
  });

  it('refuse une valeur non booléenne — jamais de supposition', () => {
    const { manager } = harness();
    expect(() => manager.set('oui')).toThrow('startup_enabled_must_be_boolean');
    expect(() => manager.set(1)).toThrow('startup_enabled_must_be_boolean');
  });

  it('en développement, repasse le dossier du projet à electron.exe', () => {
    const { manager, setLoginItemSettings } = harness({
      isPackaged: false, launchArgs: ['C:\\Serveurs\\Mina Vision'],
    });
    manager.set(true);
    expect(setLoginItemSettings).toHaveBeenCalledWith(expect.objectContaining({
      args: ['C:\\Serveurs\\Mina Vision', STARTUP_HIDDEN_ARG],
    }));
  });

  it('détecte un lancement par le démarrage automatique', () => {
    const { manager } = harness();
    expect(manager.launchedByStartup(['electron.exe', '.', STARTUP_HIDDEN_ARG])).toBe(true);
    expect(manager.launchedByStartup(['electron.exe', '.'])).toBe(false);
  });
});
