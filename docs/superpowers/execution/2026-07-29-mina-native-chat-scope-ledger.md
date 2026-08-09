# Mina Vision — Ledger de périmètre du chat natif

> **Statut : option A autorisée, implémentation incomplète.** Nasro a choisi le chat natif complet. Ce ledger remesure le périmètre disque au 2026-08-09 00:44 ; il ne transforme pas la présence d’un fichier en validation fonctionnelle.

## Méthode et résultat brut

Source lue : `docs/superpowers/plans/2026-07-22-mina-vision-native-chat-implementation.md`.

La commande read-only suivante a extrait tous les chemins `Create:` des tâches 13 à 25, puis a testé leur présence avec `Test-Path` :

```powershell
$lines = Get-Content 'docs/superpowers/plans/2026-07-22-mina-vision-native-chat-implementation.md'
$task = $null
$paths = foreach ($line in $lines) {
  if ($line -match '^### Task (\d+):') { $task = [int]$Matches[1] }
  if ($task -ge 13 -and $task -le 25 -and $line -match '^- Create: ') {
    ($line -replace '^- Create: ', '').Trim().Trim('`')
  }
}
[PSCustomObject]@{
  DeclaredCreatePaths = @($paths).Count
  Present = @($paths | Where-Object { Test-Path -LiteralPath $_ }).Count
  Absent = @($paths | Where-Object { -not (Test-Path -LiteralPath $_) }).Count
} | ConvertTo-Json -Compress
```

Sortie :

```json
{"DeclaredCreatePaths":102,"Present":9,"Absent":93}
```

Cette mesure ne déduit pas l’état fonctionnel d’un fichier présent. Elle établit seulement que les livrables source explicitement demandés par les tâches 13–25 ne sont pas tous sur disque.

## Tâches 0–12

Le plan historique les décrit comme livrées. Le contrôle 2026-08-08 a cependant ajouté les règles owner/device locales de Task 10 (`335d8e9`), prouvées seulement dans les émulateurs : Functions owner/App Check et adaptateurs owner-scopés des Tasks 11–12 restent absents. Ce ledger ne re-certifie donc pas les tâches 0–12 comme release complète ; les tâches 13–25 ci-dessous restent le périmètre qui empêche de présenter le chat natif complet comme achevé.

## Tâches 13–25 — inventaire exact des chemins `Create:`

| Tâche | Chemins déclarés | Présents | Absents | Conclusion factuelle |
|---|---:|---:|---:|---|
| 13 — FCM, WorkManager, Huawei | 9 | 4 | 5 | incomplète |
| 14 — historique, ACK, cursors, GC | 8 | 2 | 6 | incomplète |
| 15 — shell Compose | 9 | 3 | 6 | shell partiel : trois chemins littéraux et des écrans sous le namespace réel `feature.chat` |
| 16 — texte/streaming Compose | 10 | 0 | 10 | partielle : correctifs sous le namespace réel `feature.chat`, chemins littéraux toujours absents |
| 17 — pièces jointes/caméra/documents | 11 | 0 | 11 | non commencée sur ces livrables |
| 18 — notifications privées/confidentialité | 7 | 0 | 7 | partielle : défauts privés durcis sous le namespace réel, chemins littéraux toujours absents |
| 19 — approbations APK biométriques | 13 | 0 | 13 | non commencée sur ces livrables |
| 20 — notes vocales/PTT | 7 | 0 | 7 | partielle : migration PCM chiffrée sous les namespaces réels, hors des chemins littéraux historiques ; validation physique en attente |
| 21 — voix live LAN/VPN | 7 | 0 | 7 | non commencée sur ces livrables |
| 22 — révocation/réparation | 8 | 0 | 8 | non commencée sur ces livrables |
| 23 — budgets/santé/diagnostics | 2 | 0 | 2 | non commencée sur ces livrables |
| 24 — vérificateur, Emulator et recette | 7 | 0 | 7 | non commencée sur ces livrables |
| 25 — documentation/runbooks/rollback | 4 | 0 | 4 | non commencée sur ces livrables |

Les neuf chemins littéralement présents sont :

- Tâche 13 : `android/app/src/main/kotlin/fr/mina/gateway/chat/MinaChatMessagingService.kt`, `android/app/src/main/kotlin/fr/mina/gateway/chat/ChatSyncWorker.kt`, `android/app/src/main/kotlin/fr/mina/gateway/chat/ChatSyncScheduler.kt`, `tests/android-chat-background-contract.test.mjs`.
- Tâche 14 : `src/devices/chat-history-snapshot.mjs`, `tests/chat-history-snapshot.test.mjs`.
- Tâche 15 : `android/app/src/main/kotlin/fr/mina/gateway/ui/MinaApp.kt`, `android/app/src/main/kotlin/fr/mina/gateway/ui/MinaNavigation.kt`, `android/app/src/main/kotlin/fr/mina/gateway/ui/MinaTheme.kt`.

Ils ne suffisent pas à valider leurs tâches complètes, car les autres livrables déclarés de ces tâches sont absents.

### État partiel vérifié de la tâche 20

La remesure du 2026-08-09 confirme les comptes `102` chemins `Create:` déclarés, `9`
présents et `93` absents. Les sept chemins `Create:` historiques de la tâche 20 restent
donc littéralement absents ; ils utilisent le namespace `fr.mina.gateway.voice`, alors que
les chemins réellement compilés sont :

- `android/feature/voice/src/main/kotlin/fr/mina/gateway/feature/voice/VoiceNoteRecorder.kt`,
  `VoiceNoteViewModel.kt` et `PcmVoicePlayer.kt` ;
- `android/feature/chat/src/main/kotlin/fr/mina/gateway/feature/chat/ChatScreen.kt` et
  `ChatViewModel.kt` ;
- `src/chat/voice-pcm.mjs`, `voice-transcriber.mjs`, `chat-media-handler.mjs`, puis
  `src/devices/chat-server.mjs`, `chat-relay.mjs` et `chat-channel.mjs` pour le traitement PC.

Preuves automatisées réellement obtenues le 2026-08-09 :

- `android\\gradlew.bat :core:protocol:testDebugUnitTest :core:chat:testDebugUnitTest :feature:voice:testDebugUnitTest :feature:chat:testDebugUnitTest :app:testDebugUnitTest :app:lintDebug :app:assembleDebug --no-daemon --max-workers=1 --console=plain` a fini par `BUILD SUCCESSFUL in 4m 27s` (`343` tâches actionnables).
- `npx vitest run tests/voice-pcm.test.mjs tests/media-chunker.test.mjs tests/voice-transcriber.test.mjs tests/chat-media-handler.test.mjs tests/chat-server.test.mjs tests/chat-relay.test.mjs tests/chat-channel.test.mjs tests/chat-media-perception.test.mjs --no-file-parallelism` a fini avec `8` fichiers et `75` tests verts.
- Le scan `createTempFile|MediaPlayer|setOutputFile|setOutputFormat|setAudioEncoder|\\.m4a|\\.wav|\\.pcm` dans `android/feature/chat`, `android/feature/voice` et `android/core/chat` n'a retourné aucune correspondance. Un scan séparé de `MediaRecorder` retourne seulement son import et `MediaRecorder.AudioSource.VOICE_RECOGNITION`, constante utilisée pour construire `AudioRecord`.
- `adb devices -l` a retourné seulement `List of devices attached` : aucun appareil n'était attaché et aucune recette physique, installation ou réinstallation APK n'a été exécutée.

Cette preuve rend la migration notes/PTT partielle ; elle ne valide pas les chemins
historiques absents, une recette physique, ni la tâche 21 de voix live LAN/VPN.

### Écart de namespace et preuve fonctionnelle de la tâche 15

Le plan historique attendait les écrans sous `fr/mina/gateway/chat/ui/`. Le module réellement
présent porte le namespace `fr.mina.gateway.feature.chat`, donc les écrans livrés sont :

- `android/feature/chat/src/main/kotlin/fr/mina/gateway/feature/chat/ui/ConversationListScreen.kt`
- `android/feature/chat/src/main/kotlin/fr/mina/gateway/feature/chat/ui/DeviceScreen.kt`
- `android/feature/chat/src/main/kotlin/fr/mina/gateway/feature/chat/ui/SettingsScreen.kt`
- `android/feature/chat/src/androidTest/kotlin/fr/mina/gateway/feature/chat/ui/ConversationListScreenTest.kt`

Ils ne sont volontairement **pas** comptés comme chemins littéraux du plan. Le shell ajoute les
routes stables, conserve le provisioning sous `gateway` et délègue `chat/{threadId}` à
`ChatActivity`, seule frontière actuelle du verrou biométrique. Il ne crée ni `MinaApplication.kt`
sans responsabilité réelle ni un doublon de `ChatScreen.kt`.

Preuves obtenues le 2026-08-08 :

- `npx vitest run tests/android-bootstrap.test.mjs tests/android-chat-bootstrap.test.mjs --maxWorkers=1 --no-file-parallelism` : 3 tests verts.
- `android\\gradlew.bat :app:testDebugUnitTest` : 12 tests verts.
- `android\\gradlew.bat :feature:chat:connectedDebugAndroidTest` : 3 tests Compose verts sur le Huawei `MAR-LX1A` ; le paquet de test temporaire a ensuite été retiré.
- `android\\gradlew.bat :app:lintDebug :app:assembleDebug` : vert ; APK généré sans réinstallation.

### État partiel vérifié de la tâche 16

Les dix chemins `Create:` historiques de la tâche 16 restent littéralement absents : la remesure
du 2026-08-09 donne toujours `102` chemins déclarés, `9` présents et `93` absents pour les tâches
13–25. Cela ne masque pas le travail effectué dans le module réellement compilé
`fr.mina.gateway.feature.chat` :

- [x] `ChatRepository.sendText` trim les bornes sans modifier les retours à la ligne internes et
  refuse un texte de plus de 32 KiB UTF-8 avant toute écriture Room.
- [x] `ChatDraftController` conserve le brouillon après un échec de persistance, interdit le
  double envoi pendant la transaction et n'efface que le brouillon effectivement persisté.
- [x] `ChatScreen` source le brouillon et l'état d'envoi depuis le ViewModel ; le clic ne vide
  plus localement le champ avant la confirmation du dépôt.
- [x] `ChatRepository.observeThread` conserve uniquement les `200` messages visibles les plus
  récents ; les chunks `stream` sont exclus par Room avant déchiffrement et ne peuvent donc pas
  réduire cette fenêtre.
- [x] le chargement explicite des messages anciens utilise des pages de `50` et un curseur strict
  `(created_at_ms, event_id)`. `ChatHistoryWindow` conserve au plus `200` objets déchiffrés dans
  l'état UI, bloque une seconde demande pendant le chargement et l'écran propose l'action explicite
  « Charger les messages précédents » sans revenir automatiquement en bas après une page ancienne.
- [ ] la gestion complète des fils, le streaming ordonné/final, retry/cancel/stop, la recherche
  locale et le test d'intégration PC↔Android restent ouverts.

Preuves locales de cette tranche :

- rouge attendu : `:core:chat:testDebugUnitTest --tests fr.mina.gateway.chat.ChatRepositoryTest`
  a produit deux échecs ciblés (normalisation multiline et limite UTF-8) avant l'implémentation ;
  `:feature:chat:testDebugUnitTest --tests fr.mina.gateway.feature.chat.ChatDraftControllerTest`
  a échoué sur la référence absente au contrôleur.
- vert : `:core:chat:testDebugUnitTest :feature:chat:testDebugUnitTest` a fini avec
  `BUILD SUCCESSFUL`.
- vert : `:feature:chat:assembleDebugAndroidTest` a compilé l'APK de test avec
  `BUILD SUCCESSFUL`, sans installation.
- vert : `:app:lintDebug :app:assembleDebug` a fini avec `BUILD SUCCESSFUL`, sans installation.
- non exécuté : l'instrumentation physique `:feature:chat:connectedDebugAndroidTest`. La commande
  `adb devices -l` ne listait aucun appareil le 2026-08-08 ; aucun résultat appareil ne lui est
  attribué.
- rouge attendu 2026-08-09 : après ajout du test de fenêtre, `:core:chat:testDebugUnitTest --tests
  fr.mina.gateway.chat.ChatRepositoryTest` a produit `20 tests completed, 1 failed` à la nouvelle
  assertion de limite. Après le correctif minimal, le test des chunks média a produit `21 tests
  completed, 1 failed` : les chunks consommaient encore la fenêtre brute.
- vert 2026-08-09 : la même classe `ChatRepositoryTest` a fini avec `BUILD SUCCESSFUL in 43s`.
  La gate Android complète (`protocol`, `core:chat`, `feature:voice`, `feature:chat`, tests app,
  lint et APK Debug) a fini avec `BUILD SUCCESSFUL in 3m 7s` (`343` tâches actionnables).
- rouge attendu 2026-08-09 : le test de pagination a d'abord échoué sur les références absentes
  `observeThreadPage`/`loadOlderPage`, puis `ChatHistoryWindowTest` sur le contrôleur absent et
  `:feature:chat:assembleDebugAndroidTest` sur les paramètres UI absents.
- vert 2026-08-09 : `ChatRepositoryTest` contient `23` tests (`0` échec, `0` erreur), dont le
  départage de messages à la même milliseconde ; `ChatHistoryWindowTest` contient `3` tests
  (`0` échec, `0` erreur), dont la borne `200`, l'arrivée d'un nouveau message, le double clic et
  le marqueur qui inhibe le scroll après une page ancienne.
  La compilation de `:feature:chat:assembleDebugAndroidTest` a retourné `GRADLE_EXIT=0`.
- vert 2026-08-09 : la gate fraîche
  `:core:protocol:testDebugUnitTest :core:chat:testDebugUnitTest :feature:voice:testDebugUnitTest
  :feature:chat:testDebugUnitTest :app:testDebugUnitTest :app:lintDebug :app:assembleDebug`
  a retourné `GRADLE_EXIT=0`; l'APK généré est
  `android/app/build/outputs/apk/debug/app-debug.apk` (`53 926 022` octets).
- non exécuté 2026-08-09 : `adb devices -l` a retourné seulement `List of devices attached`.
  Le test Compose a été compilé mais aucune instrumentation ni recette sur téléphone ne lui est
  attribuée.

### État partiel vérifié de la tâche 18

Les chemins littéraux historiques de la tâche 18 restent absents de la remesure : les correctifs
ci-dessous sont dans les modules réellement utilisés et ne changent pas le compte `9/93`.

- [x] le démarrage de la passerelle ne demande plus `POST_NOTIFICATIONS` avec les permissions SMS ;
  cette permission ne conditionne donc plus le démarrage de la passerelle.
- [x] `ChatNotifier` ne reçoit plus de plaintext en paramètre et construit une notification privée
  statique ; son test inspecte la notification Android réelle sous Robolectric.
- [x] `ChatActivity` active `FLAG_SECURE` au démarrage ; un test Robolectric vérifie le flag de la
  fenêtre.
- [x] le coordonnateur de permission ne rend `POST_NOTIFICATIONS` demandable qu'après appairage
  sur Android 13+ et uniquement depuis le bouton visible Réglages. API 29–32 reste
  `not_required` ; les états `denied` et `denied_permanently` n'ouvrent aucun prompt automatique.
- [x] les defaults non sensibles de confidentialité et les marqueurs de tentative/refus observé
  sont modélisés dans le DataStore `mina-chat-privacy`. Le test JVM couvre les defaults et la
  politique pure ; la persistance DataStore et le dialogue système ne sont pas encore exécutés sur
  appareil.
- [ ] aperçu opt-in avec avertissement, purge des buffers au verrouillage/révocation, tests de
  navigation PendingIntent et instrumentation physique restent ouverts.

Preuves de cette tranche : les trois tests rouges ont d'abord échoué par référence absente ou
signature non conforme, puis `:app:testDebugUnitTest` ciblant `ChatNotifierTest`,
`ChatWindowPrivacyTest` et `GatewayRuntimePermissionsTest` a fini avec `BUILD SUCCESSFUL`.
Le complément de consentement a aussi démarré rouge avec les références de
`NotificationPermissionCoordinator` absentes, puis `:core:chat:testDebugUnitTest` et
`:feature:chat:testDebugUnitTest`, `:feature:chat:assembleDebugAndroidTest` et
`:app:testDebugUnitTest :app:lintDebug :app:assembleDebug` ont fini verts. L'instrumentation
physique reste non exécutée : aucun appareil n'était présent dans `adb devices -l`.

## Absences déterminantes vérifiées

- Les coordinateurs de fond restants : `FcmRegistrationCoordinator.kt`, `HuaweiRealtimeCoordinator.kt`.
- Le shell Compose : `MinaApplication.kt`, le `ChatScreen.kt` et le test de navigation aux chemins historiques restent absents ; `MinaApp.kt`, `MinaNavigation.kt`, `MinaTheme.kt` et les écrans sous le namespace réel `feature.chat` existent avec les preuves ci-dessus.
- Les médias, notes vocales et live : la migration notes/PTT partielle est sous `feature/voice` et `feature/chat`, avec les preuves automatisées ci-dessus. Les sept chemins historiques de la tâche 20 et `LiveAudioCapture.kt`, `LiveVoiceSession.kt`, `LiveVoiceScreen.kt`, `src/voice/native-chat-live-bridge.mjs` sont absents ; aucune validation sur appareil n'a été obtenue. La tâche 21 reste non commencée sur ses livrables littéraux.
- Les approbations et la révocation : `approval-store.mjs`, `app-approval-adapter.mjs`, `chat-device-revocation.mjs`, `chat-repair-service.mjs`, `chat-thread-purge.mjs`.
- Les gates : `scripts/verify-native-chat-release.mjs`, les tests `native-chat-*` listés en tâche 24, la recette manuelle et les runbooks/data map requis.

## Option active

| Option choisie | Effet autorisé |
|---|---|
| A — chat natif complet | Exécuter les tâches 13–25 en vagues indépendantes avec tests Node/Kotlin, Emulator et appareils physiques. |

Le statut correct reste `partiellement implémenté`, jamais « chat Android complet », tant que les 93 livrables littéraux absents, leurs tests et leurs recettes ne sont pas clos avec preuve.
