# Recette manuelle Mina Vision v3

Ce runbook est à exécuter par Nasro. Chaque étape s'enregistre comme `pass`, `fail` ou `not_run` avec une preuve (capture, sortie console, ou observation). Aucune étape n'est cochée sans avoir été réellement exécutée. Ne jamais tester serrures, garage, alarme, caméra domotique, four, chauffage ou paiement.

Prérequis avant de commencer : `npm run verify` exécuté, `npm test` et `npm run test:integration` verts.

| # | Étape | Commande / action | Résultat attendu | Statut | Preuve |
|---|---|---|---|---|---|
| 1 | Démarrage `local-only` sans clé cloud | `npm run start:local-only` | Fenêtre Mina Vision visible, aucun appel réseau cloud | `not_run` | |
| 2 | Mission texte locale | Donner un objectif texte simple dans l'UI | Réponse produite sans fournisseur cloud | `not_run` | |
| 3 | Lecture fichier autorisé | Demander la lecture d'un fichier sous une racine approuvée | Contenu lu avec preuve (chemin, extrait) | `not_run` | |
| 4 | Lecture DOM web | Demander la lecture d'une page web locale/contrôlée | Texte/structure retournés, secrets masqués | `not_run` | |
| 5 | OCR | Fournir une image avec texte | Texte extrait avec confiance | `not_run` | |
| 6 | Computer Use local (fixture) | Déclencher une action Computer Use sur une fenêtre de test | Action exécutée après confirmation, vérifiée par capture | `not_run` | |
| 7 | Démarrage `auto` avec fournisseur configuré | `npm run start:auto` (après avoir tourné/reposé une clé) | Une ligne d'usage par tentative, budget respecté | `not_run` | |
| 8 | Voix locale | Dire « Salut Mina », donner un ordre court | Mina répond, transcription visible | `not_run` | |
| 9 | Interruption vocale | Couper la parole en cours de réponse | Session vocale se termine proprement | `not_run` | |
| 10 | Flux caméra Huawei | Démarrer le flux caméra depuis l'UI | Image visible, arrêt propre à la fermeture | `not_run` | |
| 11 | Fusion observation | Déclencher une fusion caméra+écran | `synchronization: aligned` si dans la fenêtre 750 ms | `not_run` | |
| 12 | Reconnaissance faciale (facultatif) | Après enrôlement, tester une reconnaissance | Statut `recognized`/`unknown`/`uncertain`, jamais d'autorisation accordée | `not_run` | |
| 13 | Réception SMS | Envoyer un SMS au Huawei | Message visible côté Mina, brouillon de réponse proposé | `not_run` | |
| 14 | Envoi SMS confirmé | Confirmer l'envoi d'un brouillon | État `queued`/`accepted_by_provider`, jamais invention de « délivré » | `not_run` | |
| 15 | Auto-send politique | Tester l'envoi automatique avec un message anodin à soi-même | Comportement conforme à la politique choisie | `not_run` | |
| 16 | Telegram — mémoire/statut | Depuis le Samsung, demander un statut ou une recherche mémoire | Réponse bornée, aucune capacité PC générale | `not_run` | |
| 17 | Telegram — mail | `/mail status` depuis Telegram | Statuts de comptes affichés (propriétaire uniquement) | `not_run` | |
| 18 | Telegram — maison bas risque | Commander une lumière bas risque, après activation locale | `state_confirmed` observé | `not_run` | |
| 19 | Synchronisation Gmail/IMAP réels | Connecter un compte de test dédié, synchroniser | Messages importés, dédupliqués | `not_run` | |
| 20 | Envoi e-mail confirmé | Envoyer un message de test | `accepted_by_provider`, jamais `delivered` | `not_run` | |
| 21 | Lumière Google Home réelle | Allumer/éteindre une lumière non critique, retry même `commandId` | `state_confirmed`, jamais d'inversion sur retry | `not_run` | |
| 22 | Priorité Home Assistant | Si HA configuré et validé, confirmer qu'il prime sur Google Home | Connecteur HA choisi en premier | `not_run` | |
| 23 | Arrêt d'urgence pendant une action | Déclencher `Ctrl+Alt+Échap` en pleine mission | Toutes les sessions actives se terminent, souris/clavier relâchés | `not_run` | |

## Gates automatisés (à exécuter avant la recette manuelle)

```powershell
Set-Location 'C:\Serveurs\Mina Vision'
npm test
npm run test:integration
npm run verify
Set-Location '.\android'
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

Tous doivent sortir en code `0` avant de commencer la recette manuelle ci-dessus.

## Récapitulatif

- Date d'exécution :
- Étapes `pass` :
- Étapes `fail` (avec cause) :
- Étapes `not_run` (avec raison) :
- Décision : Mina Vision v3 prêt à l'usage quotidien / reste bloqué sur :
