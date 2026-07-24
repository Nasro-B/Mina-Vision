// La protection du nom est un invariant du projet, pas une intention : si quelqu'un retire la
// clause ou l'attribution de l'auteur, la suite échoue. Vaut aussi contre une suppression
// accidentelle lors d'un refactor de documentation.

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');

describe('protection du nom et de l\'attribution', () => {
  it('la licence existe et nomme l\'auteur et le produit', async () => {
    const license = await read('LICENSE');
    expect(license).toContain('Nasro Berkoun');
    expect(license).toContain('Mina Vision');
    expect(license).toMatch(/Copyright \(c\) 2026 Nasro Berkoun/u);
  });

  it('la clause de protection des noms est intacte et non optionnelle', async () => {
    // La licence est mise en forme sur plusieurs lignes : on compare le texte à espaces
    // normalisés pour que le contrat porte sur le SENS, pas sur la largeur des colonnes.
    const license = (await read('LICENSE')).replace(/\s+/gu, ' ');
    expect(license).toContain('CLAUSE INTANGIBLE');
    // Le nom de l'auteur ne peut être ni retiré, ni remplacé.
    expect(license).toMatch(/ne peut être ni retiré, ni remplacé/u);
    // Une œuvre dérivée doit porter un nom distinct et créditer l'origine.
    expect(license).toMatch(/nom distinct/u);
    expect(license).toContain('Basé sur Mina Vision, créé par Nasro Berkoun');
    // La violation met fin aux droits.
    expect(license).toContain('RÉSILIATION');
  });

  it('le produit lui-même affiche l\'attribution à l\'utilisateur', async () => {
    const help = await read('src/ui/help.html');
    expect(help).toContain('Nasro Berkoun');
  });

  it('le manifeste npm déclare l\'auteur et la licence', async () => {
    const pkg = JSON.parse(await read('package.json'));
    expect(String(pkg.author ?? '')).toContain('Nasro Berkoun');
    expect(pkg.license).toBe('SEE LICENSE IN LICENSE');
  });
});
