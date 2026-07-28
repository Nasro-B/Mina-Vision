import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Contrat d'honnêteté du discours local/cloud (plan de durcissement T0.4).
//
// Avant ce contrat, trois surfaces laissaient croire que TOUT est local : le README EN
// (« no dependency on any central service »), le README FR (« aucune dépendance à un service
// central ») et l'écran de bienvenue (« Tout se passe sur ce PC »). C'est faux par défaut :
// les DONNÉES sont locales et chiffrées, mais l'INFÉRENCE part chez un fournisseur cloud gouverné
// tant que LM Studio n'est pas activé. Ce test rend la distinction obligatoire et vérifiable —
// une régression vers le discours flou redevient un échec de test, pas une promesse tacite.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function textOf(relativePath) {
  return (await readFile(join(ROOT, relativePath), 'utf8')).toLowerCase();
}

// Surfaces vues par un humain qui décide d'installer ou non : les deux READMEs et le premier
// écran. Chacune doit porter la distinction, pas seulement l'une d'elles.
const SURFACES = [
  { label: 'README EN', path: 'README.md', local: 'lm studio', cloud: 'cloud' },
  { label: 'README FR', path: 'README.fr.md', local: 'lm studio', cloud: 'cloud' },
  { label: 'écran de bienvenue', path: 'src/ui/index.html', local: 'lm studio', cloud: 'cloud' },
];

// Formules qui affirment un « tout local » SANS la nuance d'inférence. Tolérées uniquement si la
// phrase parle explicitement de données/mémoire (le vrai périmètre local), pas de la totalité.
const OVERCLAIMS = [
  'no dependency on any central service',
  'aucune dépendance à un service central',
  'everything runs on your machine',
];

describe('honnêteté local/cloud — T0.4', () => {
  for (const surface of SURFACES) {
    it(`${surface.label} distingue données locales et inférence cloud`, async () => {
      const text = await textOf(surface.path);
      // La possibilité d'une inférence 100 % locale est nommée (LM Studio)...
      expect(text, `${surface.label} : mention LM Studio`).toContain(surface.local);
      // ...ET le recours au cloud par défaut est nommé, pas caché.
      expect(text, `${surface.label} : mention cloud`).toContain(surface.cloud);
      // Le socle local, lui, reste affirmé : les données/mémoire sont chiffrées localement.
      expect(text, `${surface.label} : donnée locale`).toMatch(/chiffr|encrypt/u);
    });
  }

  it('aucune surface ne réaffirme un « tout local » sans nuance', async () => {
    for (const surface of SURFACES) {
      const text = await textOf(surface.path);
      for (const overclaim of OVERCLAIMS) {
        expect(text.includes(overclaim), `${surface.label} : « ${overclaim} »`).toBe(false);
      }
    }
  });
});
