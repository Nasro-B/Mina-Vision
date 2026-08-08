# Mina Vision — Ledger de périmètre du chat natif

> **Statut : option A autorisée, implémentation incomplète.** Nasro a choisi le chat natif complet. Ce ledger remesure le périmètre disque au 2026-08-08 13:01 ; il ne transforme pas la présence d’un fichier en validation fonctionnelle.

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
| 18 — notifications privées/confidentialité | 7 | 0 | 7 | non commencée sur ces livrables |
| 19 — approbations APK biométriques | 13 | 0 | 13 | non commencée sur ces livrables |
| 20 — notes vocales/PTT | 7 | 0 | 7 | non commencée sur ces livrables |
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
du 2026-08-08 donne toujours `102` chemins déclarés, `9` présents et `93` absents pour les tâches
13–25. Cela ne masque pas le travail effectué dans le module réellement compilé
`fr.mina.gateway.feature.chat` :

- [x] `ChatRepository.sendText` trim les bornes sans modifier les retours à la ligne internes et
  refuse un texte de plus de 32 KiB UTF-8 avant toute écriture Room.
- [x] `ChatDraftController` conserve le brouillon après un échec de persistance, interdit le
  double envoi pendant la transaction et n'efface que le brouillon effectivement persisté.
- [x] `ChatScreen` source le brouillon et l'état d'envoi depuis le ViewModel ; le clic ne vide
  plus localement le champ avant la confirmation du dépôt.
- [ ] pagination bornée, gestion complète des fils, streaming ordonné/final, retry/cancel/stop,
  recherche locale et test d'intégration PC↔Android restent ouverts.

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

## Absences déterminantes vérifiées

- Les coordinateurs de fond restants : `FcmRegistrationCoordinator.kt`, `HuaweiRealtimeCoordinator.kt`.
- Le shell Compose : `MinaApplication.kt`, le `ChatScreen.kt` et le test de navigation aux chemins historiques restent absents ; `MinaApp.kt`, `MinaNavigation.kt`, `MinaTheme.kt` et les écrans sous le namespace réel `feature.chat` existent avec les preuves ci-dessus.
- Les médias, notes vocales et live : les chemins `attachments/*`, `VoiceNote*`, `LiveAudioCapture.kt`, `LiveVoiceSession.kt`, `LiveVoiceScreen.kt`, `src/voice/native-chat-live-bridge.mjs`.
- Les approbations et la révocation : `approval-store.mjs`, `app-approval-adapter.mjs`, `chat-device-revocation.mjs`, `chat-repair-service.mjs`, `chat-thread-purge.mjs`.
- Les gates : `scripts/verify-native-chat-release.mjs`, les tests `native-chat-*` listés en tâche 24, la recette manuelle et les runbooks/data map requis.

## Option active

| Option choisie | Effet autorisé |
|---|---|
| A — chat natif complet | Exécuter les tâches 13–25 en vagues indépendantes avec tests Node/Kotlin, Emulator et appareils physiques. |

Le statut correct reste `partiellement implémenté`, jamais « chat Android complet », tant que les 93 livrables littéraux absents, leurs tests et leurs recettes ne sont pas clos avec preuve.
