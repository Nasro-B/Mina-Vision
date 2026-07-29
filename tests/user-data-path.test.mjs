import { describe, expect, it } from 'vitest';
import { resolveUserDataStrategy } from '../src/ui/user-data-path.mjs';

describe('user data path strategy', () => {
  it('preserves an explicit equals-form Electron user-data profile', () => {
    expect(resolveUserDataStrategy({
      argv: ['electron', '.', '--mina-smoke', '--user-data-dir=C:\\tmp\\mina'],
      appDataPath: 'C:\\Users\\Nasro\\AppData\\Roaming',
    })).toEqual({
      preserveExplicitUserData: true,
      namedUserData: 'C:\\Users\\Nasro\\AppData\\Roaming\\Mina Vision',
    });
  });

  it('preserves an explicit separated Electron user-data profile', () => {
    expect(resolveUserDataStrategy({
      argv: ['electron', '.', '--user-data-dir', 'C:\\tmp\\mina'],
      appDataPath: 'C:\\Users\\Nasro\\AppData\\Roaming',
    })).toMatchObject({
      preserveExplicitUserData: true,
      namedUserData: 'C:\\Users\\Nasro\\AppData\\Roaming\\Mina Vision',
    });
  });

  it('keeps the named Mina profile for a normal launch', () => {
    expect(resolveUserDataStrategy({
      argv: ['electron', '.'],
      appDataPath: 'C:\\Users\\Nasro\\AppData\\Roaming',
    })).toEqual({
      preserveExplicitUserData: false,
      namedUserData: 'C:\\Users\\Nasro\\AppData\\Roaming\\Mina Vision',
    });
  });
});
