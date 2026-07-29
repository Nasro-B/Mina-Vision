# Mina Vision — Ledger de périmètre du chat natif

> **Statut : décision produit requise.** Ce ledger constate le périmètre disque du 2026-07-29 ; il n’autorise ni l’option A (chat natif complet), ni l’option B (scope expérimental limité).

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
{"DeclaredCreatePaths":102,"Present":4,"Absent":98}
```

Cette mesure ne déduit pas l’état fonctionnel d’un fichier présent. Elle établit seulement que les livrables source explicitement demandés par les tâches 13–25 ne sont pas tous sur disque.

## Tâches 0–12

Le plan historique les décrit comme livrées. Ce ledger ne les re-certifie pas comme release complète : les preuves runtime/Firebase/appareils physiques ne sont pas rejouées ici. Les tâches 13–25 ci-dessous restent le périmètre qui empêche de présenter le chat natif complet comme achevé.

## Tâches 13–25 — inventaire exact des chemins `Create:`

| Tâche | Chemins déclarés | Présents | Absents | Conclusion factuelle |
|---|---:|---:|---:|---|
| 13 — FCM, WorkManager, Huawei | 9 | 2 | 7 | incomplète |
| 14 — historique, ACK, cursors, GC | 8 | 2 | 6 | incomplète |
| 15 — shell Compose | 9 | 0 | 9 | non commencée sur ces livrables |
| 16 — texte/streaming Compose | 10 | 0 | 10 | non commencée sur ces livrables |
| 17 — pièces jointes/caméra/documents | 11 | 0 | 11 | non commencée sur ces livrables |
| 18 — notifications privées/confidentialité | 7 | 0 | 7 | non commencée sur ces livrables |
| 19 — approbations APK biométriques | 13 | 0 | 13 | non commencée sur ces livrables |
| 20 — notes vocales/PTT | 7 | 0 | 7 | non commencée sur ces livrables |
| 21 — voix live LAN/VPN | 7 | 0 | 7 | non commencée sur ces livrables |
| 22 — révocation/réparation | 8 | 0 | 8 | non commencée sur ces livrables |
| 23 — budgets/santé/diagnostics | 2 | 0 | 2 | non commencée sur ces livrables |
| 24 — vérificateur, Emulator et recette | 7 | 0 | 7 | non commencée sur ces livrables |
| 25 — documentation/runbooks/rollback | 4 | 0 | 4 | non commencée sur ces livrables |

Les quatre chemins présents sont :

- Tâche 13 : `android/app/src/main/kotlin/fr/mina/gateway/chat/MinaChatMessagingService.kt`, `android/app/src/main/kotlin/fr/mina/gateway/chat/ChatSyncWorker.kt`.
- Tâche 14 : `src/devices/chat-history-snapshot.mjs`, `tests/chat-history-snapshot.test.mjs`.

Ils ne suffisent pas à valider leurs tâches complètes, car les autres livrables déclarés de ces tâches sont absents.

## Absences déterminantes vérifiées

- Le scheduler et les coordinateurs de fond : `ChatSyncScheduler.kt`, `FcmRegistrationCoordinator.kt`, `HuaweiRealtimeCoordinator.kt`.
- Le shell Compose et ses écrans : `MinaApplication.kt`, `MinaApp.kt`, `MinaNavigation.kt`, `ConversationListScreen.kt`, `ChatScreen.kt`, `SettingsScreen.kt`.
- Les médias, notes vocales et live : les chemins `attachments/*`, `VoiceNote*`, `LiveAudioCapture.kt`, `LiveVoiceSession.kt`, `LiveVoiceScreen.kt`, `src/voice/native-chat-live-bridge.mjs`.
- Les approbations et la révocation : `approval-store.mjs`, `app-approval-adapter.mjs`, `chat-device-revocation.mjs`, `chat-repair-service.mjs`, `chat-thread-purge.mjs`.
- Les gates : `scripts/verify-native-chat-release.mjs`, les tests `native-chat-*` listés en tâche 24, la recette manuelle et les runbooks/data map requis.

## Décision à prendre avant tout code de chat natif

| Option | Effet autorisé |
|---|---|
| A — chat natif complet | Exécuter les tâches 13–25 en vagues indépendantes avec tests Node/Kotlin, Emulator et appareils physiques. |
| B — scope limité honnête | Conserver le socle direct/relais existant comme expérimental, publier ses limites et retirer les promesses d’historique complet, Firebase, approbations APK et voix live. |

Sans ce choix, le statut correct est `partiellement implémenté`, jamais « chat Android complet ».
