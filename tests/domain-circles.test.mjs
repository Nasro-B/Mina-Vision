import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CIRCLES, circleOf, describeCircle, domainCircleMap, isExperimental } from '../src/core/domain-circles.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('domain-circles — T0.1/T0.2', () => {
  it('les 5 domaines CŒUR de la décision sont bien au cercle cœur', () => {
    // Voix/conversation, missions navigateur, bureau Windows, mémoire/coffre, diagnostic.
    for (const id of ['voice', 'computer_use.browser', 'computer_use.desktop', 'memory', 'diagnostic']) {
      expect(circleOf(id), id).toBe('coeur');
      expect(isExperimental(id), id).toBe(false);
    }
  });

  it('les domaines MAINTENU de la décision sont gelés en fonctionnalités, pas expérimentaux', () => {
    for (const id of ['computer_use.android', 'code', 'documents']) {
      expect(circleOf(id), id).toBe('maintenu');
      expect(isExperimental(id), id).toBe(false);
    }
  });

  it('les domaines GELÉS nommés par la décision sont marqués expérimentaux', () => {
    for (const id of ['mail', 'home', 'personal', 'biometrics.face', 'telegram', 'sandbox']) {
      expect(circleOf(id), id).toBe('gele');
      expect(isExperimental(id), id).toBe(true);
      expect(describeCircle(id).note, id).toMatch(/non vérifié en usage réel/u);
    }
  });

  it('un domaine inconnu retombe sur GELÉ sans lever (affichage jamais cassé)', () => {
    expect(circleOf('domaine_invente_2099')).toBe('gele');
    expect(isExperimental('domaine_invente_2099')).toBe(true);
    expect(() => describeCircle(undefined)).not.toThrow();
  });

  it('chaque cercle porte un libellé et une note ; seul GELÉ est expérimental', () => {
    expect(CIRCLES.coeur.experimental).toBe(false);
    expect(CIRCLES.maintenu.experimental).toBe(false);
    expect(CIRCLES.gele.experimental).toBe(true);
    for (const circle of Object.values(CIRCLES)) {
      expect(typeof circle.label).toBe('string');
      expect(circle.label.length).toBeGreaterThan(0);
      expect(circle.note.length).toBeGreaterThan(0);
    }
  });

  it('EXHAUSTIVITÉ : tout domaine réellement publié au catalogue runtime est classé', async () => {
    // Extraction des identifiants réels depuis la SOURCE de main.mjs — les `reportCapability('id', …)`
    // littéraux et la liste des domaines de gouvernance. Si un domaine est ajouté au produit sans
    // entrée dans la table des cercles, il tomberait en GELÉ par défaut : ce test l'exige NOMMÉ,
    // pour qu'un nouveau domaine soit classé consciemment, pas « expérimental » par oubli.
    const main = await readFile(join(ROOT, 'src/ui/main.mjs'), 'utf8');
    const reported = new Set();
    for (const match of main.matchAll(/reportCapability\('([a-z_.]+)'/gu)) reported.add(match[1]);
    // La liste de repli de gouvernance : `for (const domain of ['automation', …])`.
    const governance = main.match(/for \(const domain of \[([^\]]+)\]\)/u);
    if (governance) {
      for (const match of governance[1].matchAll(/'([a-z_.]+)'/gu)) reported.add(match[1]);
    }

    expect(reported.size, 'aucun identifiant extrait — la regex a décroché du code').toBeGreaterThan(8);
    const map = domainCircleMap();
    const unclassified = [...reported].filter((id) => !(id in map));
    expect(unclassified, `domaines publiés mais non classés : ${unclassified.join(', ')}`).toEqual([]);
  });

  it('EXHAUSTIVITÉ : chaque capacité permanente du brief est classée', async () => {
    const catalog = await readFile(join(ROOT, 'src/core/capability-catalog.mjs'), 'utf8');
    // On ne classe QUE les capacités permanentes (ce que Mina sait faire), pas les identifiants de
    // santé runtime (phone, googleTasks…) qui vivent ailleurs dans le fichier. La table des cercles
    // décrit des DOMAINES, pas des indicateurs d'état — d'où l'extraction bornée au bloc.
    const block = catalog.match(/PERMANENT_CAPABILITIES = Object\.freeze\(\[([\s\S]*?)\]\);/u);
    expect(block, 'bloc PERMANENT_CAPABILITIES introuvable').not.toBeNull();
    const ids = [...block[1].matchAll(/id: '([a-z_]+)'/gu)].map((match) => match[1]);
    expect(ids.length).toBeGreaterThan(5);
    const map = domainCircleMap();
    const unclassified = ids.filter((id) => !(id in map));
    expect(unclassified, `capacités permanentes non classées : ${unclassified.join(', ')}`).toEqual([]);
  });
});
