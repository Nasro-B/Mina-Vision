# Profils navigateur — inventaire et migration (Task 21)

> Généré le 2026-07-22. Outil : `node scripts/inventory-browser-profiles.mjs` (read-only :
> chemin, taille, date, catégories — jamais le contenu). **Aucune suppression automatique,
> jamais** : la décision appartient à Nasro, consignée dans le CHANGELOG (« En attente côté
> Nasro »).

## Inventaire du 2026-07-22

| Profil | Taille | Dernière modif | Données présentes | Statut |
|---|---|---|---|---|
| `profiles/` (racine du projet) | 150 Mo | 2026-07-18 | aucune base Chromium détectée à la racine | **legacy, candidat à l'archivage** |
| `userData/mina-chrome-profile` | 118 Mo | 2026-07-22 | Login Data, Web Data, History | **ACTIF** — c'est lui que les missions navigateur utilisent (`browser-profile-auth`) |

## Règles

1. Le profil ACTIF est `userData/mina-chrome-profile` — ne jamais le déplacer app ouverte.
2. `profiles/` (projet) n'est plus référencé par le code actif ; il est ignoré par git.
3. Migration éventuelle : fermer Mina ET tout processus Chromium avant toute copie ; préférer
   les mécanismes d'export officiels du navigateur ; après accord explicite de Nasro, déplacer
   vers une quarantaine récupérable (`profiles.perdu-<date>/`) avant toute suppression réelle.
4. Durcissement ACL du profil actif : app FERMÉE uniquement (leçon de l'incident icacls du
   2026-07-22 — voir CHANGELOG).

## Décision en attente (Nasro)

- [ ] Archiver ou garder `profiles/` (150 Mo, dernier usage 18/07). Si archivage : je le
      déplace en quarantaine récupérable sur ordre, jamais de suppression directe.
