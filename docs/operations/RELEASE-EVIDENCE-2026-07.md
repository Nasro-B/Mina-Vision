# Preuve de release — Mina Vision (2026-07)

> **Statut automatisé : passé lors du run lancé le 2026-07-29 à 11:13 (Africa/Lagos).** Les recettes matérielles, comptes et isolation restent `unrun` : ce document ne les présente pas comme validées.

## Commande reproductible

```powershell
npm run verify:release
```

Le runner lance chaque commande avec un exécutable et un tableau d'arguments (sans shell applicatif), borne et masque sa sortie, puis échoue si une commande échoue ou si une capacité explicitement requise n'est pas `available`.

## Résultat constaté

| Vérification | Sortie | Preuve bornée |
|---|---:|---|
| Tests unitaires | `0` | 406 fichiers, 3 310 tests passés en `665.46 s` |
| Tests d'intégration | `0` | 17 fichiers, 48 tests passés en `181.45 s` |
| Smoke Electron | `0` | fenêtre principale confirmée, fermeture propre |
| Smoke SQLite/Electron | `0` | `{"ok":true,"electron":"43.1.0","abi":"148"}` |
| Diagnostic runtime | `0` | rapport JSON produit ; il reste informatif tant qu'aucune capacité n'est passée dans `requiredCapabilities` |

## État runtime observé lors de cette preuve

| Capacité | État | Raison vérifiée |
|---|---|---|
| `models.lm_studio` | `degraded` | Gemma n'était pas chargé pendant ce run; le diagnostic informatif a retourné `lm_studio_models_not_ready` |
| `computer_use.android` | `available` | le correctif testé rapporte le transport LAN réellement observé |
| Google Home SDK | non prêt | `google_home_sdk_unavailable` |
| Mail | `degraded` | `mail_accounts_not_yet_configurable_from_cli` |
| `backup.firebase` | `degraded` | `firebase_unconfigured` |

## Ré-observation runtime — 10:08 (Africa/Lagos)

Cette ré-observation ne remplace pas la preuve automatisée de 08:58 ; elle corrige la qualification du transport et vérifie le runtime local après le lancement de LM Studio.

| Vérification | Sortie | Limite exacte |
|---|---:|---|
| ADB autorisé | `0` | `adb devices -l` a listé un endpoint réseau autorisé. Le nouveau test rouge/vert de `parseAuthorizedAdbTransports()` interdit de le déclarer USB ; `npm run verify` rapporte `transports:["lan"]`. |
| LM Studio | `0` | serveur sur `1234`, Gemma configuré et embedder chargés. |
| Texte Mina loopback | `0` | `createLmStudioProvider` a renvoyé exactement `MINA_LOCAL_RELOAD_OK` en `8 683 ms`. |
| Diagnostic Mina | `0` | `models.lm_studio: available`; Home et mail restent non prêts, Firebase reste non configuré. |

La santé vision ne vaut pas une validation fonctionnelle : le routeur Mina local-only conserve son état dégradé après l'échec antérieur sur JPEG valide. La chaîne vocale locale complète demeure `unrun` : le style Kokoro local existe, mais aucun chemin microphone STT local -> modèle -> TTS avec réseau désactivé n'a été exécuté.

## Ré-observation runtime finale — 11:32 (Africa/Lagos)

Cette vérification est distincte du gate de code de 11:13 : elle a été exécutée après le rechargement du modèle configuré, que le runner avait correctement déclaré absent.

| Vérification | Sortie | Limite exacte |
|---|---:|---|
| `lms ps` | `0` | Gemma configuré et l'embedder sont listés comme chargés. |
| Texte Mina loopback | `0` | `createLmStudioProvider` a renvoyé exactement `MINA_LOCAL_RELOAD_OK`. |
| Diagnostic Mina | `0` | texte, vision et embedding configurés chargés; `models.lm_studio: available`; Android LAN disponible; Home et mail non prêts, Firebase non configuré. |

Cette santé ne revalide pas la route caméra : le seul test réel de cette route sur JPEG valide a échoué auparavant. Elle ne revalide pas non plus un tour vocal local complet.

## Incident runtime local documenté — 08:25–08:34 (Africa/Lagos)

Cet incident précède la release de 08:58 : il ne contredit pas le diagnostic de santé final, mais interdit de présenter le routeur vision comme validé.

| Capacité | État observé | Preuve directe |
|---|---|---|
| `models.lm_studio` | `available` | Après le rechargement JIT, `npm run verify` voit les modèles texte, vision et embedding chargés; les fournisseurs Mina ont retourné `MINA_LOCAL_OK`, `MINA_TEXT_RECOVERY_OK` et des embeddings finis de 768 dimensions. |
| Vision locale | `degraded` | Le vrai routeur Mina local-only a reçu HTTP 400 de LM Studio sur un JPEG valide : le modèle configuré a crashé puis a été déchargé. Aucune cause n'est déduite; un appel texte a ensuite rechargé le modèle. |
| Voix locale complète | `unrun` | aucun tour microphone/STT -> modèle -> TTS avec réseau désactivé n'a été exécuté. |

## Validation Android isolée complémentaire — 09:17 (Africa/Lagos)

Cette validation est postérieure au runner `npm run verify:release` de 08:58. Elle ne modifie pas son résultat Node/Electron ; elle couvre le code Android ajouté ensuite.

| Vérification | Sortie | Limite exacte |
|---|---:|---|
| `:app:connectedDebugAndroidTest` sur Samsung | `0` | 5 tests terminés, `BUILD SUCCESSFUL in 2m 37s`; cycle de service isolé uniquement |
| `test :app:assembleDebug :app:assembleDebugAndroidTest` | `0` | `BUILD SUCCESSFUL in 25s`, 391 tâches, 3 exécutées, 388 à jour |
| Conservation de l'application existante | confirmée par ADB | `fr.mina.gateway` v`0.1.0` était toujours installé après le runner; `.debug` et `.debug.test` avaient été nettoyés |

La variante instrumentée utilise `fr.mina.gateway.debug` et `fr.mina.gateway.debug.test`; elle ne peut donc pas remplacer le paquet `fr.mina.gateway`. Son flag explicite isole le service avant les boucles Telegram, et le manifeste debug retire le receiver de boot. Cela ne constitue pas une preuve de parcours fonctionnel Mina, d'absence générale de trafic système, de permissions caméra/micro, de SMS, de Telegram, de Home ou de Firebase.

## Recettes qui restent explicitement non exécutées

- recette fonctionnelle Android/phone (parcours app, permissions, SMS et Telegram) ;
- SDK Google Home signé et action supervisée sur une lumière non critique ;
- comptes de test dédiés pour les fournisseurs ;
- preuve réelle d'isolation Windows Sandbox ;
- tour vocal local, microphone et réseau désactivé.

Les preuves détaillées et les commandes précédentes sont consignées dans [`2026-07-29-mina-reconciliation-log.md`](../superpowers/execution/2026-07-29-mina-reconciliation-log.md).
