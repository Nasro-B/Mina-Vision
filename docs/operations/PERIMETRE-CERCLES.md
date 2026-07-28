# Périmètre & cercles de maturité des domaines

Ce document est la **règle de discipline** du projet Mina Vision : ce qu'on autorise à ajouter, et
ce qu'on s'interdit tant que le cœur n'est pas fini. Décision de Nasro du 2026-07-28 (plan de
durcissement, T0.1/T5.2). La source de vérité exécutable est [`src/core/domain-circles.mjs`](../../src/core/domain-circles.mjs) ;
le panneau **Config → Capacités** affiche le cercle de chaque domaine à côté de son état runtime.

## Les trois cercles

| Cercle | Sens | Ce qu'on lui demande |
|---|---|---|
| **Cœur** | fini, vérifié en usage réel | l'amener à 100 %, prouvé live ; ne jamais régresser |
| **Maintenu** | fonctionnel, gelé en fonctionnalités | correctifs de sécurité et de bugs **seulement** — zéro nouvelle feature |
| **Expérimental (gelé)** | non vérifié en usage réel | marqué tel quel dans l'UI et les docs ; jamais présenté comme fiable |

## Classement (2026-07-28)

- **Cœur** : voix / conversation, missions navigateur, bureau Windows, mémoire / coffre,
  diagnostic / journal.
- **Maintenu** : Android / chat, agent de code, documents PDF / DOCX.
- **Expérimental** : mail, domotique, organisation personnelle / graphe, biométrie faciale,
  Telegram, sandbox — plus, par défaut prudent, tout domaine non nommé (sauvegarde, personnalité,
  gouvernance) tant que Nasro ne l'a pas reclassé.

## La règle anti-étalement (T5.2)

> **Aucun nouveau domaine** tant que les cinq domaines **Cœur** ne sont pas à 100 % — finis et
> **prouvés en usage réel** (recettes live datées). Un domaine **Expérimental** ne reçoit que des
> correctifs de **sécurité**, jamais de nouvelles fonctionnalités qui étaleraient encore la surface.

Pourquoi : la surface du projet a grandi plus vite que la vérification. Le fini remplace le neuf —
un domaine cœur prouvé en vrai vaut mieux que trois domaines expérimentaux qui « marchent en test ».
Cette règle protège cet ordre de priorité, et le cercle affiché dans le produit la rend honnête :
un utilisateur voit « expérimental — non vérifié en usage réel » au lieu de le découvrir en panne.

## Contrat exécutable

`tests/domain-circles.test.mjs` échoue si un domaine réellement publié au catalogue runtime n'est
pas classé : un domaine ajouté sans cercle tomberait en **Expérimental** par défaut, ce que le test
exige d'assumer **nommément** — pour qu'aucun domaine ne devienne « fiable » par simple oubli.
