# Mina v2 — plan passerelle Android SMS, Telegram et Firebase

> **Statut : ne pas exécuter.** Ce plan Java est remplacé intégralement par [Mina Android Kotlin Gateway Implementation Plan](2026-07-14-mina-v3-android-kotlin-gateway-plan.md), qui conserve SMS/Telegram/Firebase et ajoute l’identité physique USB/LAN requise par CameraX et Google Home.

> **Pour l’agent d’exécution :** utiliser `superpowers:executing-plans`. Aucun code du zip AGPL `C:\Serveurs\httpsms-main.zip` ne doit être copié. Il sert seulement à comprendre le problème métier.

**Objectif :** créer `fr.mina.gateway`, installé sur le Huawei connecté, seul consommateur du Bot API Telegram et seule autorité SMS. L’app met en file, chiffre, déduplique et transporte les messages vers Mina PC par USB, LAN ou Firebase.

**Architecture :** application Android Java 17. Un foreground service supervise Telegram long-polling et transport local. Les SMS passent par `BroadcastReceiver` puis Room. WorkManager reprend les files persistantes et réveille le service, mais ne porte pas une boucle longue. Le token Telegram est chiffré par une clé AES non exportable Android Keystore. Aucune Cloud Function ne voit le plaintext.

---

## Tâche 1 — squelette Android reproductible

**Fichiers :**

- Créer `android/settings.gradle.kts`
- Créer `android/build.gradle.kts`
- Créer `android/gradle.properties`
- Créer `android/app/build.gradle.kts`
- Créer `android/app/src/main/AndroidManifest.xml`
- Créer `android/app/src/main/java/fr/mina/gateway/MainActivity.java`
- Créer `android/app/src/test/java/fr/mina/gateway/BuildContractTest.java`
- Créer `android/gradle/wrapper/*`

1. Générer le wrapper depuis la distribution Gradle 8.13 déjà en cache :

```powershell
$gradle = Get-ChildItem "$env:USERPROFILE\.gradle\wrapper\dists\gradle-8.13-bin" -Recurse -Filter gradle.bat | Select-Object -First 1 -ExpandProperty FullName
& $gradle -p android wrapper --gradle-version 8.13 --distribution-type bin
```

2. Plugins : `com.android.application 8.13.2`, `com.google.gms.google-services 4.5.0`. Repositories `google()` et `mavenCentral()` seulement.
3. Config : namespace/applicationId `fr.mina.gateway`, min 23, target/compile 35, buildTools 35.0.0, Java 17, release minify true.
4. Dépendances : Room 2.8.4 + annotation processor, WorkManager 2.11.2, Firebase BoM 34.15.0 avec `firebase-auth`, `firebase-database`, `firebase-appcheck`, JUnit 4.13.2, AndroidX test ext JUnit 1.3.0 et runner 1.7.0.
5. Ne pas committer `google-services.json`, keystore de signature, `local.properties`, APK ni token ; ajouter aux ignores.
6. Exécuter `.\android\gradlew.bat -p android testDebugUnitTest lintDebug assembleDebug`; attendu `BUILD SUCCESSFUL`.

## Tâche 2 — contrats Java et crypto Android

**Fichiers :**

- Créer `android/app/src/main/java/fr/mina/gateway/protocol/MinaEnvelope.java`
- Créer `android/app/src/main/java/fr/mina/gateway/protocol/EnvelopeCodec.java`
- Créer `android/app/src/main/java/fr/mina/gateway/crypto/DeviceKeyStore.java`
- Créer `android/app/src/main/java/fr/mina/gateway/crypto/EnvelopeCrypto.java`
- Créer tests unitaires correspondants

1. Reproduire sémantiquement le contrat Node version 1 avec validation stricte et tailles bornées ; partager des fixtures JSON dans `contracts/fixtures/`.
2. Tests croisés : enveloppe produite en Node vérifiée/déchiffrée en Java et inversement, via vecteurs déterministes de test uniquement.
3. Android Keystore aliases : `mina-device-sign-v1`, `mina-local-wrap-v1`, `mina-telegram-token-v1`. AES-GCM 256 et signature EC P-256 si Ed25519 matériel n’est pas garanti par le Huawei ; le champ d’algorithme est versionné.
4. Les clés privées et token ne sont jamais exportés/loggés. Sauvegarde Android automatique exclue pour les préférences et DB de Mina.
5. Compteurs entrants/sortants persistés par pair ; rejeter duplicate, expiration, signature/tag invalide et rollback compteur.

## Tâche 3 — Room, files et migrations

**Fichiers :**

- Créer `android/app/src/main/java/fr/mina/gateway/db/GatewayDatabase.java`
- Créer entités/DAO `InboundMessage`, `OutboundMessage`, `IdentityLink`, `TransportState`, `ReplayCounter`, `AuditEvent`
- Créer `android/app/schemas/`
- Créer tests Room instrumentés et migration

1. États : `RECEIVED`, `QUEUED`, `LEASED`, `DELIVERED_TO_PC`, `DRAFT_READY`, `AWAITING_CONFIRMATION`, `SENDING`, `ACCEPTED_REMOTE`, `FAILED_RETRYABLE`, `FAILED_FINAL`, `EXPIRED`.
2. Unicité : `(channel, remoteMessageId)` et `envelopeId`. Lease atomique avec expiration pour éviter double traitement après crash.
3. Le body, numéro, username, token et réponse sont ciphertext ; les index nécessaires sont HMAC pseudonymisés.
4. Exporter schémas Room et tester toutes migrations ; destructive migration interdite.
5. Test kill/restart : un élément `LEASED` expiré revient `QUEUED`, un élément `ACCEPTED_REMOTE` n’est jamais renvoyé.

## Tâche 4 — réception et identité SMS

**Fichiers :**

- Créer `sms/SmsReceiver.java`, `sms/SmsRepository.java`, `sms/SmsSender.java`, `identity/PhoneIdentityVerifier.java`
- Modifier manifest pour `RECEIVE_SMS`, `READ_SMS`, `SEND_SMS` et receiver exporté selon API
- Créer tests unitaires + instrumentés

1. Réassembler multipart SMS, normaliser E.164 avec région configurée, dédupliquer par digest/adresse/date/body.
2. Demander permissions runtime dans l’Activity avec explication explicite. Sans permission, statut `sms_unavailable`, jamais de boucle.
3. Appairage : code à 6 chiffres, 10 min, cinq essais, comparaison constante, événement audit. Le code n’est pas mémorisé après succès/expiration.
4. Fallback même téléphone : contact Telegram partagé + device Huawei physiquement appairé + confirmation locale PC ; aucune preuve unique ne suffit.
5. `SmsSender` retourne l’état via PendingIntents `SENT` et `DELIVERED`; accepter que `DELIVERED` dépende de l’opérateur. Ne pas annoncer livré si seul `SENT` existe.

## Tâche 5 — politique brouillon/confirmation/auto-réponse

**Fichiers :**

- Créer `sms/ReplyPolicy.java`, `sms/ReplyStateMachine.java`, `sms/AutoReplyGuard.java`
- Créer tests table-driven

1. Mode par défaut : Mina PC prépare, téléphone notifie, Nasro confirme sur PC ou téléphone, puis envoi.
2. Auto-réponse est désactivée par défaut et activable par contact/règle/plage horaire avec aperçu et interrupteur d’urgence.
3. Toujours confirmation : OTP/secrets, banque/paiement, juridique/médical, contenu hostile, numéro inconnu, pièce jointe/lien sensible, confiance insuffisante.
4. Anti-boucle : pas de réponse aux short codes, sender alphanumérique, propres messages, doublons ; max 1 auto-réponse/contact/15 min et 10/h global.
5. Si PC hors ligne, aucun LLM sur téléphone : conserver et notifier `Mina est hors ligne, message enregistré` dans l’UI, pas en SMS automatique.
6. Aucun SMS entrant ne crée une capability PC/skill/sandbox.

## Tâche 6 — provisionnement et client Telegram

**Fichiers :**

- Créer `telegram/TelegramTokenStore.java`, `TelegramApiClient.java`, `TelegramPoller.java`, `TelegramUpdateParser.java`
- Modifier `MainActivity.java` pour provisionnement local
- Créer tests serveur HTTP fixture

1. Écran local : saisir token BotFather, appeler `getMe`, montrer uniquement nom/id du bot, puis envelopper token avec Keystore. Aucun token via ADB, Firebase ou logs.
2. Une seule boucle `getUpdates` sur le téléphone ; offset persistant avancé après transaction Room, jamais avant.
3. Timeout long-poll 50 s, timeout réseau 60 s, backoff exponentiel jitteré 1 s à 5 min, respect `retry_after`.
4. Parser uniquement messages privés textuels, notes vocales et contact en v1. Taille texte 8 KiB ; voix 10 MiB/2 min.
5. Les updates Telegram peuvent expirer au bout de 24 h : exposer cette limite dans le statut, sans promesse de récupération infinie.

## Tâche 7 — appairage propriétaire Telegram

**Fichiers :**

- Créer `identity/TelegramPairing.java`, `identity/OwnerIdentity.java`, `telegram/TelegramCommands.java`
- Créer tests de sécurité

1. PC génère un token aléatoire 256 bits, valide 10 min et usage unique ; `/start <token>` doit venir d’un chat privé.
2. Persister `telegram_user_id` numérique et `chat_id`; nom/username ne sont jamais une identité.
3. Exiger `request_contact` dont `contact.user_id` égale l’expéditeur, puis confirmation locale PC.
4. Lier ensuite le numéro E.164 par challenge SMS de la tâche 4.
5. Commandes : `/help`, `/status`, `/memory`, `/forget`, `/end`. `/forget` crée une proposition ; suppression sur PC après confirmation locale.
6. Tout autre utilisateur reçoit une réponse générique bornée puis est ignoré/rate-limité ; aucun détail système.

## Tâche 8 — service de premier plan et reprise EMUI

**Fichiers :**

- Créer `service/MinaGatewayService.java`, `service/BootReceiver.java`, `work/RecoveryWorker.java`, `work/QueueWorker.java`
- Modifier manifest : foreground service dataSync, boot completed, notification channel
- Créer tests lifecycle

1. Notification permanente claire avec états Telegram/SMS/PC et action Stop.
2. Le foreground service porte polling/transport. WorkManager effectue reprise bornée, nettoyage, retry de files et relance autorisée ; aucun worker > 10 min.
3. Au boot/package replaced : programmer RecoveryWorker ; ne pas démarrer aveuglément une action interdite par l’OS.
4. Écran d’aide Huawei/EMUI : retirer optimisation batterie et autoriser démarrage auto, comme étape manuelle visible et révocable.
5. Arrêt utilisateur stoppe polling/transport/auto-réponse mais conserve les files chiffrées.

## Tâche 9 — transport USB et LAN authentifié

**Fichiers Android :** `transport/LocalTransportServer.java`, `transport/PairingProtocol.java`.

**Fichiers PC :** `src/messaging/android-transport.mjs`, `src/messaging/device-pairing.mjs`, tests.

1. Appairage physique initial : PC vérifie un seul ADB autorisé, échange clés publiques par canal ADB, Nasro confirme les empreintes sur les deux écrans.
2. USB utilise `adb forward tcp:27183 tcp:27183`; protocole applicatif reste chiffré/signé même sur tunnel USB.
3. LAN écoute seulement si explicitement activé, port 27183, handshake mutuel, aucune route non authentifiée sauf health minimal sans données.
4. Framing longueur 4 octets + JSON UTF-8, frame max 1 MiB, timeout, compteur et ack par envelope ID.
5. Priorité : USB > LAN. Changement de transport ne change pas message ID ni permissions.
6. Tests : replay, split frame, grosse frame, faux certificat, coupure milieu d’enveloppe, ack perdu puis retry dédupliqué.

## Tâche 10 — fallback Firebase chiffré

**Fichiers :**

- Créer Android `transport/FirebaseTransport.java`
- Créer PC `src/messaging/firebase-transport.mjs`
- Créer `firebase/database.rules.json`, `firebase/firebase.json`
- Créer tests avec Firebase Emulator

1. Namespaces `queues/{ownerUid}/{deviceId}/{direction}/{envelopeId}` ; valeur = enveloppe ciphertext + métadonnées minimales.
2. TTL applicatif 24 h et cleanup des ack ; messages expirés jamais traités. La mémoire backup durable utilise un autre namespace/règles.
3. Auth propriétaire/device, App Check en enforcement après validation. Règles refusent lecture/écriture cross-owner et mutation d’un message existant.
4. Transport activé seulement après échec USB/LAN ; retour local draine puis supprime les items ackés.
5. Emulator tests : unauthorized, cross-owner, overwrite, expiry, duplicate et coupure.
6. Aucun Cloud Function plaintext, aucun secret de service dans les apps.

## Tâche 11 — voix Telegram et politique distante

**Fichiers :**

- Créer Android `telegram/VoiceNoteFetcher.java`
- Créer PC `src/messaging/telegram-router.mjs`, `src/messaging/voice-note-asr.mjs`
- Créer tests

1. Télécharger la voix sur téléphone avec limites, chiffrer dans enveloppe, supprimer temporaire après ack.
2. ASR local PC avec timeout 120 s ; si indisponible, répondre proprement sans envoyer l’audio à un cloud par défaut.
3. Session Telegram : 30 min d’inactivité ou `/end`; message suivant crée nouvelle session tout en gardant mémoire longue.
4. Limites : 20 messages/min et 200/h propriétaire ; réponse Telegram divisée sous limites Bot API.
5. Bot API `sendMessage` réussi = `accepted_remote`; livré/lu reste `unknown`.
6. Capability broker bloque outils PC, fichiers, skills d’action et sandbox avant traitement du texte.

## Tâche 12 — build, installation et essai Huawei

1. Exécuter :

```powershell
.\android\gradlew.bat -p android testDebugUnitTest lintDebug assembleDebug
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices -l
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r ".\android\app\build\outputs\apk\debug\app-debug.apk"
```

2. Attendu : un seul Huawei `device`, installation `Success`.
3. Accorder les permissions via UI du téléphone, jamais `pm grant` caché dans le script de livraison.
4. Tester réception SMS, brouillon, refus, confirmation, auto-réponse sûre, redémarrage téléphone.
5. Après création du token par Nasro : provisionner via UI et tester `/start`, contact, challenge SMS, texte, voix, `/end`.
6. Couper successivement USB, Wi-Fi et Internet ; relever transitions réelles et stdout/logcat expurgé.

## Gate de fin du plan 4

- Builds/tests/lint verts et APK installé.
- Aucun token/numéro/body en clair dans Room, prefs, logs ou Firebase export de test.
- Telegram n’a qu’un poller téléphone.
- SMS/Telegram survivent au crash sans doublon.
- Les capacités distantes interdites sont refusées côté PC même si le téléphone est compromis.
- Firebase live reste inactif jusqu’à configuration explicite de Nasro.
