import { describe, expect, it } from 'vitest';
import { classifyBrowserUtterance, routeBrowserCommand } from '../src/browser/browser-intent-router.mjs';

const type = (u) => classifyBrowserUtterance(u)?.type ?? null;

describe('browser-intent-router : table de routage (§9) + recette (§27)', () => {
  it('ouvrir, naviguer, rechercher, historique, onglets → route fast', () => {
    expect(classifyBrowserUtterance('Ouvre le navigateur.')).toMatchObject({ type: 'open', route: 'fast' });
    expect(classifyBrowserUtterance('Va sur wikipedia.org.')).toMatchObject({ type: 'navigate', route: 'fast' });
    expect(classifyBrowserUtterance('Ouvre https://developer.mozilla.org/fr/.')).toMatchObject({ type: 'navigate' });
    expect(type('Reviens en arrière puis actualise la page.')).toBe('back');
    expect(type('Avance.')).toBe('forward');
    expect(type('Actualise.')).toBe('reload');
    expect(type('Ferme cet onglet.')).toBe('close_tab');
    expect(classifyBrowserUtterance('Ouvre un nouvel onglet et va sur example.com.')).toMatchObject({ type: 'new_tab', route: 'fast' });
  });

  it('recherche visible → fast/search avec URL Google encodée, jamais la barre d’adresse', () => {
    const command = routeBrowserCommand('Ouvre Google et cherche dentifrice sans fluor.', { commandId: 'c1' });
    expect(command).toMatchObject({ type: 'search', route: 'fast', query: 'dentifrice sans fluor' });
    expect(command.searchUrl).toBe('https://www.google.com/search?q=dentifrice%20sans%20fluor');
    expect(type('Cherche dentifrice sans fluor dans le navigateur.')).toBe('search');
  });

  it('recherche documentaire / « sans ouvrir Chrome » → route research', () => {
    expect(classifyBrowserUtterance('Trouve-moi des informations récentes sur Playwright sans ouvrir Chrome.'))
      .toMatchObject({ type: 'research', route: 'research' });
    expect(type('Cherche la météo de Paris sans ouvrir le navigateur.')).toBe('research');
  });

  it('champs, boutons, cases, listes → route semantic', () => {
    expect(classifyBrowserUtterance('Écris Mina Vision dans le champ de recherche et valide.')).toMatchObject({ type: 'semantic_action', route: 'semantic', semanticAction: 'fill' });
    expect(classifyBrowserUtterance('Clique sur le bouton Connexion.')).toMatchObject({ semanticAction: 'click' });
    expect(classifyBrowserUtterance('Coche les conditions générales.')).toMatchObject({ semanticAction: 'check' });
    expect(classifyBrowserUtterance('Sélectionne France dans la liste.')).toMatchObject({ semanticAction: 'select' });
  });

  it('canvas → route vision', () => {
    expect(classifyBrowserUtterance('Utilise cette carte interactive.')).toMatchObject({ type: 'visual_mission', route: 'vision' });
  });
});

describe('browser-intent-router : ambiguïté (§9.3) et non-commandes', () => {
  it('« fais le nécessaire » est ambigu, jamais deviné', () => {
    expect(routeBrowserCommand('Fais le nécessaire.', { commandId: 'c' })).toMatchObject({ ambiguous: true });
  });

  it('« cherche example.com » (domaine OU requête) est ambigu', () => {
    expect(classifyBrowserUtterance('Cherche example.com')).toMatchObject({ type: 'ambiguous', reason: 'domaine_ou_requete' });
  });

  it('un énoncé non-navigateur retourne null', () => {
    expect(classifyBrowserUtterance('Quelle heure est-il ?')).toBeNull();
    expect(classifyBrowserUtterance('Mets de la musique.')).toBeNull();
  });

  it('la commande normalisée est gelée et porte un commandId', () => {
    const command = routeBrowserCommand('Va sur wikipedia.org', { commandId: 'x1', source: 'voice' });
    expect(command).toMatchObject({ commandId: 'x1', type: 'navigate', targetUrl: 'https://wikipedia.org/' });
    expect(Object.isFrozen(command)).toBe(true);
  });
});
