# Recette manuelle Mina Vision — backlog exhaustif (2026-07-18)

Ce runbook est à exécuter par Nasro. Chaque étape s'enregistre comme `pass`, `fail` ou `not_run` avec une preuve (capture, sortie console, ou observation). Aucune étape n'est cochée sans avoir été réellement exécutée. Ne jamais tester serrures, garage, alarme, caméra domotique, four, chauffage ou paiement.

Ce fichier complète (ne remplace pas) `docs/runbooks/mina-v3-acceptance.md` : il couvre uniquement les capacités ajoutées/raccordées par le plan `docs/superpowers/plans/2026-07-18-mina-vision-backlog-exhaustif.md`. Exécuter le v3 en premier si ce n'est pas déjà fait.

Prérequis avant de commencer : `npm test`, `npm run test:integration` verts, gate Android vert.

## Gates automatisés

```powershell
Set-Location 'C:\Serveurs\Mina Vision'
npm test
npm run test:integration
Set-Location '.\android'
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

## Matrice

| # | Étape | Commande / action | Résultat attendu | Statut | Preuve |
|---|---|---|---|---|---|
| 1 | Impression PC | Fichier local existant, imprimante approuvée, « imprime ce fichier » | Confirmation locale demandée, job accepté par le spooler Windows réel, statut `completed`/`printing` observé | `not_run` | |
| 2 | Impression — refus imprimante non approuvée | Demander l'impression sur une imprimante jamais approuvée | Erreur `printer_not_approved`, aucun job soumis | `not_run` | |
| 3 | HTTPSMS configuré — native-first | Couper le Huawei (USB+ADB Wi-Fi), envoyer un SMS confirmé | Bascule vers httpSMS, un seul envoi (jamais de doublon) | `not_run` | Nécessite un compte HTTPSMS configuré — item Pour Nasro |
| 4 | Politique SMS — mode confirm_every_send | Recevoir un SMS d'un contact allowlisté | Confirmation demandée quand même (mode par défaut) | `not_run` | |
| 5 | Politique SMS — mode auto_allowlisted | Passer en `auto_allowlisted`, contact allowlisté, message anodin, heures ouvrées | Envoi automatique, sans confirmation | `not_run` | |
| 6 | Politique SMS — arrêt d'urgence | Cliquer « Arrêt d'urgence SMS auto » pendant que auto_allowlisted est actif | Tout redevient confirmation systématique immédiatement | `not_run` | |
| 7 | Google Tasks — création vocale | « Mina, crée une tâche : rappeler le fournisseur » | Confirmation locale, tâche visible dans Google Tasks (app ou web) | `not_run` | Nécessite compte Google connecté — item Pour Nasro |
| 8 | Google Agenda — création vocale | « Mina, crée un rendez-vous demain 10h avec Untel » | Confirmation locale, événement visible dans Google Agenda | `not_run` | Nécessite compte Google connecté |
| 9 | Contact — recherche vocale | « Mina, cherche le contact Untel » (déjà synchronisé) | Résultat lu à voix haute, jamais un contact inventé | `not_run` | Nécessite un `sync` de contacts au moins une fois |
| 10 | Telegram — commande /home | Depuis le Samsung, `/home "lampe salon" on` | Commande déterministe exécutée, jamais passée au LLM | `not_run` | |
| 11 | Telegram — commande refusée pour un non-propriétaire | Envoyer `/home` depuis un autre compte Telegram | « Commande refusée. », aucune action | `not_run` | |
| 12 | Telegram — tentative de code bloquée | Envoyer « exécute ce code python: ... » | Réponse de refus fixe, jamais transmis au LLM ni exécuté | `not_run` | |
| 13 | Redélivrance Telegram après coupure réseau | Couper le réseau PC pendant la génération d'une réponse Telegram, relancer | Un seul message généré et envoyé au final, jamais deux | `not_run` | |
| 14 | Resilience — panne transitoire | Simuler un timeout réseau pendant une mission (couper le Wi-Fi 2s) | Réessai automatique, mission continue | `not_run` | |
| 15 | Resilience — refus de sécurité jamais réessayé | Refuser une confirmation sensible pendant une mission | Mission s'arrête proprement, aucun réessai automatique de cette action | `not_run` | |
| 16 | Sandbox — refus d'accès hors workspace | Lancer un script sandbox qui tente de lire un fichier hors du dossier jetable | Accès refusé, sandbox reste isolée | `not_run` | Nécessite Bac à sable Windows actif (déjà activé au 2026-07-18) |
| 17 | Sandbox — smoke Python/JS/PowerShell | Exécuter un exemple simple dans chaque langage via Mina | Sortie correcte, aucun accès réseau/SMS/secret depuis l'invité | `not_run` | |
| 18 | YouTube — recherche via API | « Mina, mets [chanson précise] » | URL exacte ouverte (pas de recherche UI à l'aveugle), lecture démarrée | `not_run` | Nécessite `YOUTUBE_API_KEY` configurée |
| 19 | Diagnostic — dédoublonnage d'erreurs | Provoquer une erreur répétée (ex. couper LM Studio pendant un appel) | Compteur qui augmente sur UNE entrée, jamais 20 lignes identiques | `not_run` | |
| 20 | Redémarrage complet | Redémarrer Windows, attendre 2 min | Mina redémarre seule, ADB Wi-Fi Huawei/Samsung reconnecté, Telegram actif, profil Gmail conservé, aucune boucle de logs | `not_run` | |

## Dépendances humaines restantes avant recette complète

- Compte HTTPSMS (ou décision d'auto-héberger le service AGPL séparément).
- Compte Google connecté (`npm run connect:google`) — bloque les étapes 7, 8, 9.
- Contact de test allowlisté pour la politique SMS automatique (étape 5).
- SDK Google Home officiel — hors scope de ce fichier, voir `docs/runbooks/mina-v3-acceptance.md` étape 21.

## Récapitulatif

- Date d'exécution :
- Étapes `pass` :
- Étapes `fail` (avec cause) :
- Étapes `not_run` (avec raison) :
- Décision : capacités du backlog exhaustif prêtes à l'usage quotidien / reste bloqué sur :
