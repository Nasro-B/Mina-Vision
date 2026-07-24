import { describe, it, expect } from 'vitest';
import { createUserProfileStore } from '../src/personal/user-profile-store.mjs';

function harness() {
  const files = new Map();
  let counter = 0;
  const store = createUserProfileStore({
    filename: 'C:/data/mina-profiles.json',
    readFile: async (p) => { if (!files.has(p)) { const e = new Error('none'); e.code = 'ENOENT'; throw e; } return files.get(p); },
    writeFile: async (p, c) => { files.set(p, c); },
    now: () => 1_784_900_000_000,
    makeId: () => `profile-${++counter}`,
  });
  return { store, files };
}

describe('createUserProfileStore', () => {
  it('état vide au départ, accueil non passé', async () => {
    const { store } = harness();
    const state = await store.read();
    expect(state.profiles).toEqual([]);
    expect(state.welcomeCompleted).toBe(false);
    expect(await store.active()).toBeNull();
  });

  it('crée un profil, le rend actif, borne et nettoie les champs', async () => {
    const { store } = harness();
    const p = await store.upsert({ name: '  Nasro  ', theme: 'dark', tone: 'direct', language: 'fr', preferences: 'aime le concis' });
    expect(p.id).toBe('profile-1');
    expect(p.name).toBe('Nasro');
    expect(p.theme).toBe('dark');
    expect(p.tone).toBe('direct');
    expect((await store.active()).id).toBe('profile-1');
  });

  it('valeurs invalides => valeurs sûres par défaut', async () => {
    const { store } = harness();
    const p = await store.upsert({ name: '', theme: 'neon', tone: 'agressif', language: 'zzzz' });
    expect(p.name).toBe('Utilisateur');
    expect(p.theme).toBe('system');
    expect(p.tone).toBe('chaleureux');
    expect(p.language).toBe('fr');
  });

  it('met à jour un profil existant sans le dupliquer', async () => {
    const { store } = harness();
    const p = await store.upsert({ name: 'Nasro' });
    const updated = await store.upsert({ id: p.id, name: 'Nasro', theme: 'light', preferences: 'nouveau' });
    expect(updated.id).toBe(p.id);
    expect((await store.read()).profiles).toHaveLength(1);
    expect(updated.theme).toBe('light');
    expect(updated.preferences).toBe('nouveau');
  });

  it('multi-utilisateurs : bascule du profil actif', async () => {
    const { store } = harness();
    const a = await store.upsert({ name: 'Nasro' });
    const b = await store.upsert({ name: 'Invité', theme: 'light' });
    expect((await store.active()).id).toBe(b.id);
    await store.setActive(a.id);
    expect((await store.active()).id).toBe(a.id);
    await expect(store.setActive('profile-inconnu')).rejects.toThrow('profil_inconnu');
  });

  it('completeWelcome masque l’accueil au prochain lancement', async () => {
    const { store } = harness();
    expect((await store.read()).welcomeCompleted).toBe(false);
    await store.completeWelcome();
    expect((await store.read()).welcomeCompleted).toBe(true);
  });

  it('personaContext dérive du profil actif, sans rien de sensible', async () => {
    const { store } = harness();
    expect(await store.personaContext()).toBe('');
    await store.upsert({ name: 'Nasro', tone: 'direct', preferences: 'réponses courtes', pronouns: 'il' });
    const ctx = await store.personaContext();
    expect(ctx).toContain('Nasro');
    expect(ctx).toContain('réponses courtes');
    expect(ctx).toContain('direct');
  });

  it('fichier corrompu => état vide, jamais un crash', async () => {
    const { store, files } = harness();
    files.set('C:/data/mina-profiles.json', '{pas du json');
    expect((await store.read()).profiles).toEqual([]);
  });
});
