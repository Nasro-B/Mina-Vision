# Mina Vision Remaining Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** terminer Mina Vision comme agent multimodal local/cloud réellement exploitable sur PC, navigateur, Huawei, Samsung, Telegram, SMS, email, fichiers, impression et maison connectée, avec preuves d'exécution, confirmations et reprise fiable après panne.

**Architecture:** conserver Electron comme orchestrateur unique. Les modèles ne touchent jamais directement la souris, le clavier, ADB, les fichiers ou le réseau : ils proposent des actions JSON strictes, `normalizeAction()` les valide, la politique décide confirmation/refus, l'exécuteur agit et un vérificateur produit une preuve. Le Huawei reste la passerelle Android principale. Le transport natif Mina est conservé ; HTTPSMS devient un adaptateur de protocole propre, interchangeable et sans copie de code AGPL. Le stockage local chiffré est primaire ; Firebase est uniquement un fallback chiffré et borné.

**Tech Stack:** Node.js 22, Electron, JavaScript ESM, Vitest, Playwright, SQLite, Android/Kotlin, Room + Android Keystore, ADB USB/Wi-Fi, LM Studio/OpenAI-compatible APIs, Gemini, DeepSeek, OpenRouter, Modal, Firebase, Google APIs, IMAP/SMTP, Home Assistant/MQTT.

## Global Constraints

- TDD obligatoire : test rouge observé, code minimal, test vert, suite impactée, puis suite complète.
- Aucun secret en dur, dans les logs, dans ce plan ou dans Git. Les tokens exposés doivent être révoqués puis remplacés dans le coffre local.
- Ne pas importer le fork HTTPSMS AGPL dans Mina Vision. Implémenter uniquement un client de protocole documenté ou exécuter le service AGPL séparément avec sa licence intacte.
- Ne jamais désactiver le Wi-Fi du PC. L'isolation du code invité ne doit pas modifier la connectivité de l'hôte.
- Le modèle local produit seulement des actions JSON ; le curseur virtuel reste visible et l'orchestrateur conserve confirmation, exécution et vérification.
- Accès écriture sans confirmation seulement dans les dossiers Mina Vision. Toute écriture ailleurs sur `C:` ou `G:` exige confirmation locale explicite ; lecture autorisée selon les racines approuvées.
- Aucune action externe depuis un SMS sans règle explicite. Telegram peut déclencher des outils uniquement après authentification du propriétaire et application de la politique de risque.
- Les données biométriques, SMS, emails, caméra et mémoire sont chiffrées au repos, minimisées, supprimables et jamais envoyées au cloud sans indication visible.
- Ne pas modifier `src/ui/help.html` ni la page d'informations/réglages maintenue parallèlement par Claude avant coordination explicite.
- Aucun `git push`, aucun déploiement automatique. Le dossier courant n'est pas un dépôt Git au moment de cet audit.

---

## 1. État vérifié au 18 juillet 2026

### 1.1 Fonctionnel et déjà présent

- Contrôle PC/navigateur/téléphone avec actions normalisées, confirmations, curseur virtuel visible et vérification.
- ADB USB et ADB Wi-Fi pour Huawei ; sélection Samsung distincte de la télévision ; mécanisme de reconnexion existant.
- Caméra Huawei, capture écran, vision Gemini/LM Studio et routage texte/vision.
- Mémoire courte, mémoire longue, SQLite chiffré, RAG local et embeddings LM Studio.
- `MINA.md`, moteur de skills, installation validée, quatre skills de référence embarqués.
- Routage Gemini, DeepSeek, OpenRouter, Modal et LM Studio ; modes `auto`, `local-first`, `local-only`.
- Comptage d'usage, tokens, coûts, budgets et page Analyses IA.
- Sessions start/during/end, grounding, anti-hallucination, journal technique et corrélation de base.
- Animations vocales Mina et CloudZIR sélectionnables et persistantes.
- Gmail profile navigateur persistant et client YouTube Data API présent.
- Modules de mémoire, mail, documents, impression, calendrier, contacts, automatisation, maison connectée, Firebase et sandbox déjà testés isolément.

### 1.2 Présent mais non raccordé au runtime principal

- `src/printing/print-service.mjs` et `src/printing/printer-registry.mjs` ne sont pas construits dans `src/ui/main.mjs`.
- `src/ui/ipc/document-ipc.mjs` et les services `src/documents/*` ne sont pas enregistrés dans le runtime principal.
- `src/personal/calendar-service.mjs`, `contact-service.mjs`, `daily-briefing-service.mjs` et `src/ui/ipc/personal-ipc.mjs` ne sont pas composés dans `main.mjs`.
- `src/backup/firebase-backup.mjs` et `src/devices/firebase-transport.mjs` existent mais ne sont pas câblés dans `main.mjs`.
- `src/providers/local-stt.mjs`, `local-tts.mjs`, `local-ocr.mjs` existent mais ne sont pas instanciés dans `main.mjs`.
- Les adaptateurs Home Assistant/MQTT existent, mais `main.mjs` démarre avec un registre et une liste de connecteurs vides.
- Les commandes Telegram mail/maison existent comme modules, mais la synchronisation distante appelle seulement le répondeur conversationnel.
- Le moteur biométrique existe, mais `main.mjs` utilise encore un embedder qui lève `face_embedding_pipeline_not_implemented`.

### 1.3 Absent ou incomplet

- Aucun adaptateur HTTPSMS dans `src/`, `android/` ou `tests/`.
- Aucun écran complet d'ajout/test de compte Gmail, IMAP/SMTP ou Microsoft ; les comptes live ne sont pas configurés.
- Aucun SDK Google Home live installé/raccordé ; le connecteur signale `google_home_sdk_unavailable`.
- Aucun mode SMS configurable « confirmation / automatique pour contacts autorisés / jamais ».
- Aucun état durable de dead-letter pour les messages Telegram/SMS définitivement invalides.
- Aucun pipeline réel d'enrôlement/reconnaissance faciale avec modèle local installé.
- Aucun catalogue HF par rôle distinct texte/vision/OCR/STT/TTS avec téléchargement, vérification SHA-256 et sélection dynamique.
- Aucun compte utilisateur de skill installé dans `%APPDATA%\agentvisionsourire\skills`; seuls quatre skills embarqués sont disponibles.

### 1.4 Correctifs réalisés dans cette vague

- Le champ Android Telegram `user_id:chat_id` est maintenant validé et réduit au vrai `chat_id` avant envoi.
- Une cible composite malformée est rejetée avant tout appel à un fournisseur IA.
- Le générateur Telegram est désormais persistant au lieu d'être recréé à chaque synchronisation.
- Un fournisseur en erreur 429 entre en cooldown cinq minutes ; la boucle n'épuise plus Gemini/OpenRouter toutes les cinq secondes.
- Une erreur transitoire 5xx, timeout ou sortie vide place aussi le fournisseur en cooldown court au lieu de le rappeler toutes les cinq secondes.
- Le lanceur PowerShell BOM-less est maintenant ASCII-compatible avec Windows PowerShell 5.1 ; Mina démarre à nouveau via `start-mina.ps1`.
- Tests ciblés actuels : 31 tests verts sur Telegram, bridge téléphone, fallback et contrat du runtime principal.
- Régression complète : 260 fichiers / 1 914 tests unitaires et 13 fichiers / 34 tests d'intégration verts.
- Recette Telegram réelle : envoi `accepted_by_provider`, acquittement exact, puis file Huawei vidée de 7 à 0 messages par la boucle normale après relance.

---

## 2. Ordre d'exécution

1. P0 — fiabilité Telegram/SMS et arrêt de toute boucle coûteuse.
2. P0 — intégration HTTPSMS et politique d'envoi SMS.
3. P0 — composition réelle des capacités déjà codées dans `main.mjs`.
4. P1 — comptes Google/email, Telegram outillé, documents et impression.
5. P1 — modèles locaux spécialisés, biométrie et Firebase.
6. P1 — maison connectée et Google Home.
7. P2 — recette matérielle, redémarrage, observabilité et durcissement.

---

## Task 1: Durcir définitivement la file Telegram/SMS

**Files:**

- Modify: `src/devices/phone-message-sync.mjs`
- Create: `src/messaging/message-delivery-ledger.mjs`
- Create: `src/messaging/message-retry-policy.mjs`
- Modify: `src/ui/main.mjs`
- Modify: `android/app/src/main/kotlin/fr/mina/gateway/messaging/EncryptedMessageRepository.kt`
- Test: `tests/phone-message-sync.test.mjs`
- Create test: `tests/message-delivery-ledger.test.mjs`
- Modify test: `android/app/src/test/kotlin/fr/mina/gateway/messaging/MessagePullFileProcessorTest.kt`

- [ ] Écrire un test rouge prouvant qu'un même `messageId` n'appelle jamais deux fois le LLM lorsque sa réponse est déjà calculée.
- [ ] Écrire un test rouge pour les états `pending`, `generating`, `reply_ready`, `sending`, `sent`, `acked`, `retry_wait`, `dead_letter`.
- [ ] Ajouter un `deliveryKey = channel + deviceId + messageId` unique et persistant dans SQLite.
- [ ] Persister le brouillon de réponse avant l'envoi Telegram/SMS ; un redémarrage reprend à `reply_ready` sans rappeler le modèle.
- [ ] Classer les erreurs : 429 avec `retryAfter`, réseau transitoire, cible invalide permanente, refus propriétaire, appareil absent.
- [ ] Après un nombre borné d'essais, déplacer le message en dead-letter et l'acquitter côté Huawei pour arrêter la boucle, sans perdre le diagnostic.
- [ ] Ajouter dans les logs `correlationId`, `messageId`, `attempt`, `nextRetryAt`, `providerId` et résultat d'acquittement, sans corps du message.
- [ ] Lancer `npm test -- tests/phone-message-sync.test.mjs tests/message-delivery-ledger.test.mjs`; attendu : vert.
- [ ] Lancer `android\gradlew.bat :app:testDebugUnitTest --tests "fr.mina.gateway.messaging.MessagePullFileProcessorTest"`; attendu : vert.
- [ ] Critère : 100 redémarrages/synchronisations du même message produisent au plus une génération et un envoi réussi.

## Task 2: Normaliser les réponses Modal/OpenAI-compatible

**Files:**

- Modify: `src/providers/openai-compatible-text.mjs`
- Modify: `src/providers/fallback-text-generator.mjs`
- Test: `tests/openai-compatible-text.test.mjs`
- Test: `tests/fallback-text-generator.test.mjs`

- [ ] Capturer une réponse Modal structurelle expurgée et ajouter des fixtures pour `message.content` chaîne, tableau de parts, champ reasoning sans contenu final et sortie vide réelle.
- [ ] Écrire le test rouge : un contenu en parts textuelles est concaténé ; un raisonnement seul n'est jamais envoyé comme réponse utilisateur.
- [ ] Ajouter une normalisation unique OpenAI-compatible et conserver `modal_text_empty` uniquement quand aucune sortie finale n'existe réellement.
- [ ] Ajouter un circuit breaker court pour les erreurs vides répétées, distinct du cooldown 429.
- [ ] Respecter `Retry-After` lorsqu'il existe ; borner le cooldown entre 1 seconde et 1 heure.
- [ ] Lancer `npm test -- tests/openai-compatible-text.test.mjs tests/fallback-text-generator.test.mjs`; attendu : vert.
- [ ] Critère : Modal ne bloque jamais LM Studio et ne génère pas une tempête de logs identiques.

## Task 3: Implémenter l'adaptateur HTTPSMS sans contamination AGPL

**Files:**

- Create: `src/messaging/httpsms/contracts.mjs`
- Create: `src/messaging/httpsms/client.mjs`
- Create: `src/messaging/httpsms/webhook-verifier.mjs`
- Create: `src/messaging/httpsms/provider.mjs`
- Create: `src/messaging/sms-router.mjs`
- Modify: `src/config/schema.mjs`
- Modify: `src/security/provider-secret-store.mjs`
- Modify: `src/ui/main.mjs`
- Create test: `tests/httpsms-client.test.mjs`
- Create test: `tests/httpsms-webhook-verifier.test.mjs`
- Create test: `tests/sms-router.test.mjs`
- Create integration test: `tests/integration/httpsms-native-failover.test.mjs`

- [ ] Consigner une spécification propre du protocole public : authentification, `POST /v1/messages/send`, statuts asynchrones, webhooks entrants, expiration, identifiants idempotents et limites de débit.
- [ ] Interdire tout import depuis `C:\Serveurs\httpsms-main.zip`; l'archive reste une référence externe AGPL en lecture seule.
- [ ] Écrire les tests rouges avec un serveur HTTP factice : auth absente, timeout, 202, duplicate ID, webhook falsifié, corps trop grand et rejeu.
- [ ] Implémenter `createHttpsmsClient({ baseUrl, apiKey, fetch, timeoutMs })` avec timeout, taille bornée, redaction et zéro retry implicite non idempotent.
- [ ] Implémenter `createHttpsmsProvider()` derrière l'interface commune `send`, `health`, `getStatus`.
- [ ] Implémenter `createSmsRouter({ nativeProvider, httpsmsProvider, policy, ledger })` avec modes `native-first`, `httpsms-first`, `native-only`, `httpsms-only`.
- [ ] Ne basculer sur le second fournisseur que si le premier n'a pas accepté la commande ; réconcilier par identifiant avant tout nouvel envoi.
- [ ] Stocker les clés dans le coffre local chiffré et afficher seulement `configured: true/false`.
- [ ] Ajouter santé, latence, file, dernier succès et raison de panne aux capacités Mina.
- [ ] Lancer `npm test -- tests/httpsms-client.test.mjs tests/httpsms-webhook-verifier.test.mjs tests/sms-router.test.mjs tests/integration/httpsms-native-failover.test.mjs`; attendu : vert.
- [ ] Critère : envoi et réception fonctionnent via le Huawei avec un seul exemplaire du SMS, même après coupure réseau/redémarrage.

## Task 4: Ajouter la politique SMS confirmation/automatique

**Files:**

- Create: `src/messaging/sms-send-policy.mjs`
- Modify: `src/messaging/conversation-service.mjs`
- Modify: `src/ui/pages/settings-controller.mjs`
- Modify: `src/ui/preload.mjs`
- Modify: `src/ui/renderer.js`
- Modify: `android/app/src/main/kotlin/fr/mina/gateway/messaging/MessagingPolicy.kt`
- Test: `tests/sms-send-policy.test.mjs`
- Test: `tests/settings-ui-contract.test.mjs`
- Test: `android/app/src/test/kotlin/fr/mina/gateway/messaging/MessagingPolicyTest.kt`

- [ ] Définir trois modes : `confirm_every_send`, `auto_allowlisted`, `draft_only`.
- [ ] En mode automatique, exiger propriétaire reconnu, contact allowlisté, fenêtre horaire, limite par minute/jour, contenu non sensible et absence de pièce jointe/action secondaire.
- [ ] Conserver confirmation obligatoire pour nouveau destinataire, numéro court/premium, groupe, réponse ambiguë ou dépassement de budget.
- [ ] Afficher le numéro SIM passerelle lu du téléphone ; ne jamais inventer un numéro virtuel HTTPSMS.
- [ ] Ajouter bouton d'arrêt global et révocation immédiate des règles automatiques.
- [ ] Ajouter reçus locaux consultables et suppression conforme à la rétention choisie.
- [ ] Critère : aucune réponse automatique ne peut partir vers un numéro non autorisé.

## Task 5: Raccorder les documents, fichiers, téléchargements et impression

**Files:**

- Modify: `src/ui/main.mjs`
- Modify: `src/ui/preload.mjs`
- Modify: `src/ui/ipc/document-ipc.mjs`
- Modify: `src/ui/pages/document-controller.mjs`
- Modify: `src/printing/print-service.mjs`
- Modify: `src/printing/printer-registry.mjs`
- Modify: `src/documents/download-service.mjs`
- Test: `tests/document-main-runtime-contract.test.mjs`
- Test: `tests/print-main-runtime-contract.test.mjs`
- Test: `tests/print-service.test.mjs`

- [ ] Écrire des contrats rouges exigeant `registerDocumentIpc()` et `createPrintService()` dans la composition principale.
- [ ] Créer au boot `%USERPROFILE%\Documents\Mina Vision` et `%USERPROFILE%\Documents\Mina Vision\Sandbox` avec erreur visible si la création échoue.
- [ ] Autoriser sans confirmation les écritures dans les racines Mina ; demander confirmation avec chemin absolu, type et taille partout ailleurs sur `C:` ou `G:`.
- [ ] Enregistrer les IPC document via une allowlist de méthodes ; aucune API Node brute dans le renderer.
- [ ] Découvrir les imprimantes Windows/réseau, enregistrer leur identité stable et exiger confirmation avant chaque impression réelle sauf grant explicite révocable.
- [ ] Après impression/téléchargement, vérifier existence, taille et état de spool ; retourner une preuve, pas seulement « fait ».
- [ ] Critère : « crée un fichier erreurs_techniques.md » crée réellement le fichier et Mina annonce son chemin vérifié.

## Task 6: Raccorder Google Tasks, Calendar et People

**Files:**

- Modify: `src/ui/main.mjs`
- Modify: `src/ui/ipc/personal-ipc.mjs`
- Modify: `src/ui/pages/personal-controller.mjs`
- Modify: `src/personal/adapters/google-personal.mjs`
- Modify: `src/personal/task-service.mjs`
- Modify: `src/personal/calendar-service.mjs`
- Modify: `src/personal/contact-service.mjs`
- Test: `tests/personal-main-runtime-contract.test.mjs`
- Test: `tests/personal-adapters.test.mjs`
- Create integration test: `tests/integration/google-personal-runtime.test.mjs`

- [ ] Écrire un contrat rouge exigeant la composition des trois services et `registerPersonalIpc()`.
- [ ] Réutiliser le même compte OAuth Google, avec scopes minimaux et statut de scope détaillé.
- [ ] Implémenter création/lecture/modification/suppression pour Tasks, événements Calendar et contacts People avec identifiants idempotents.
- [ ] Toute création/modification externe exige confirmation, sauf grant local explicite et borné.
- [ ] Ajouter des outils structurés `google_task_create`, `calendar_event_create`, `contact_lookup` au routeur d'actions.
- [ ] Vérifier l'objet créé via l'API après mutation et mémoriser seulement un résumé minimal.
- [ ] Critère : une tâche créée par voix ou Telegram apparaît réellement dans Google Tasks avec le bon compte.

## Task 7: Finaliser Gmail, IMAP/SMTP et Microsoft

**Files:**

- Modify: `src/ui/main.mjs`
- Modify: `src/ui/pages/mail-controller.mjs`
- Modify: `src/ui/ipc/mail-ipc.mjs`
- Modify: `src/mail/mail-account-store.mjs`
- Modify: `src/mail/mail-service.mjs`
- Modify: `src/mail/adapters/imap-smtp.mjs`
- Modify: `src/mail/adapters/gmail.mjs`
- Modify: `src/mail/adapters/microsoft-graph.mjs`
- Test: `tests/mail-account-provisioning.test.mjs`
- Test: `tests/mail-main-runtime-contract.test.mjs`
- Create integration test: `tests/integration/mail-live-contract.test.mjs`

- [ ] Ajouter un assistant d'ajout de compte : Gmail OAuth, Microsoft OAuth, IMAP/SMTP manuel avec test TLS séparé entrant/sortant.
- [ ] Ne jamais afficher ou journaliser mot de passe, refresh token ou OAuth code.
- [ ] Remplacer le stub de recherche vide du runtime par `mailService.search()` réel.
- [ ] Implémenter ou déclarer explicitement non supportés : archive, label, déplacement, spam, corbeille, désabonnement et téléchargement de pièce jointe.
- [ ] Envoyer uniquement après aperçu, destinataires normalisés et confirmation ; conserver `Message-ID` idempotent.
- [ ] Ajouter une recette live opt-in avec compte de test ; elle ne fait pas partie des tests unitaires automatiques.
- [ ] Critère : réception/recherche/rédaction/envoi vérifiés pour au moins Gmail et un compte IMAP/SMTP.

## Task 8: Donner à Telegram les outils autorisés de Mina

**Files:**

- Create: `src/messaging/telegram-command-router.mjs`
- Modify: `src/messaging/telegram-home-commands.mjs`
- Modify: `src/messaging/telegram-mail-commands.mjs`
- Modify: `src/messaging/telegram-conversation-responder.mjs`
- Modify: `src/devices/phone-message-sync.mjs`
- Modify: `src/ui/main.mjs`
- Test: `tests/telegram-command-router.test.mjs`
- Modify test: `tests/telegram-home-commands.test.mjs`
- Modify test: `tests/telegram-mail-commands.test.mjs`
- Create integration test: `tests/integration/telegram-tools.test.mjs`

- [ ] Authentifier à la fois `user_id` et `chat_id`; refuser groupe, canal et utilisateur inconnu par défaut.
- [ ] Router d'abord les commandes déterministes ; utiliser le LLM seulement pour extraire une intention structurée validée.
- [ ] Autoriser en lecture : état système, recherche mémoire, état mail/tâches/maison.
- [ ] Pour toute écriture/action, créer une proposition avec résumé et demander confirmation Telegram signée ou confirmation locale selon le risque.
- [ ] Interdire totalement l'exécution de code, l'installation de skill, la lecture de secrets et les actions bloquées depuis Telegram/SMS.
- [ ] Ajouter expiration, anti-rejeu, limite de débit et journal d'approbation.
- [ ] Critère : « crée une tâche test demain » depuis le Samsung produit une demande de confirmation puis une tâche vérifiée, sans ouvrir la souris.

## Task 9: Raccorder Firebase comme fallback chiffré

**Files:**

- Modify: `src/ui/main.mjs`
- Modify: `src/backup/firebase-backup.mjs`
- Modify: `src/devices/firebase-transport.mjs`
- Modify: `src/config/schema.mjs`
- Modify: `src/ui/pages/settings-controller.mjs`
- Test: `tests/firebase-main-runtime-contract.test.mjs`
- Modify test: `tests/firebase-backup.test.mjs`
- Modify test: `tests/firebase-transport.test.mjs`
- Modify integration test: `tests/integration/messaging-failover.test.mjs`

- [ ] Ajouter une configuration locale guidée pour projet, bucket, app et service account sans exposer les secrets.
- [ ] Chiffrer côté Mina avant Firebase ; Firebase ne reçoit jamais SMS/email/caméra/mémoire en clair.
- [ ] Utiliser Firebase seulement après échec USB puis LAN/ADB Wi-Fi, avec TTL ≤ 30 secondes pour commandes low-risk.
- [ ] Signer les enveloppes avec identité Huawei exacte, nonce et commandId ; rejeter le rejeu.
- [ ] Brancher `firebase-backup` dans la composition mémoire avec sauvegarde, restauration explicite et tombstones.
- [ ] Ajouter santé, dernier backup, volume, rétention et purge testable.
- [ ] Critère : couper USB/LAN n'autorise jamais une commande medium/high via Firebase.

## Task 10: Raccorder les modèles locaux spécialisés et HF

**Files:**

- Create: `src/providers/model-role-registry.mjs`
- Create: `src/providers/hf-model-manifest.mjs`
- Create: `src/providers/hf-model-installer.mjs`
- Modify: `src/providers/local-stt.mjs`
- Modify: `src/providers/local-tts.mjs`
- Modify: `src/providers/local-ocr.mjs`
- Modify: `src/providers/local-vision.mjs`
- Modify: `src/ui/main.mjs`
- Modify: `src/config/schema.mjs`
- Modify: `src/ui/pages/settings-controller.mjs`
- Test: `tests/model-role-registry.test.mjs`
- Test: `tests/hf-model-installer.test.mjs`
- Create integration test: `tests/integration/local-multimodal-routing.test.mjs`

- [ ] Définir les rôles `text`, `reasoning`, `vision`, `ocr`, `embedding`, `stt`, `tts` avec un modèle et endpoint indépendants.
- [ ] Détecter les modèles LM Studio chargés et vérifier leurs capacités réelles avant sélection.
- [ ] Installer les modèles HF uniquement depuis un manifest avec repo, révision immuable, SHA-256, licence, taille et format.
- [ ] Stocker les modèles/caches sous `G:\Programmes Installés\caches\MinaVision`, jamais dans `G:\DevCache`.
- [ ] Ajouter sélection `auto`, `cloud-first`, `local-first`, `local-only` par rôle sans redémarrage complet.
- [ ] Tester le modèle vision/texte chargé et `text-embedding-nomic-embed-text-v1.5` avec fixtures locales.
- [ ] Afficher latence, mémoire, tokens estimés, modèle effectif et fallback par requête.
- [ ] Critère : en `local-only`, voix → STT → raisonnement → action JSON → TTS fonctionne sans clé cloud.

## Task 11: Implémenter la reconnaissance faciale locale

**Files:**

- Modify: `src/biometrics/face-model-loader.mjs`
- Modify: `src/biometrics/face-recognizer.mjs`
- Modify: `src/biometrics/liveness-check.mjs`
- Modify: `src/biometrics/face-profile-store.mjs`
- Modify: `src/ui/main.mjs`
- Modify: `src/ui/pages/camera-controller.mjs`
- Test: `tests/face-model-loader.test.mjs`
- Test: `tests/face-recognizer.test.mjs`
- Create integration test: `tests/integration/face-enrollment-local.test.mjs`

- [ ] Remplacer le stub `face_embedding_pipeline_not_implemented` par un modèle local versionné et vérifié.
- [ ] Ajouter enrôlement volontaire avec plusieurs angles, qualité minimale, consentement visible et confirmation finale.
- [ ] Conserver uniquement des embeddings chiffrés ; ne pas conserver les images brutes après enrôlement.
- [ ] Ajouter seuils calibrés, résultat `unknown`, liveness et anti-photo basique ; ne jamais utiliser le visage comme seul facteur pour une action sensible.
- [ ] Ajouter suppression/export du profil et journal de chaque reconnaissance.
- [ ] Critère : Mina peut personnaliser « Bonjour Nasro » localement, mais une non-correspondance ne bloque pas les fonctions ordinaires.

## Task 12: Activer réellement la maison connectée

**Files:**

- Modify: `src/ui/main.mjs`
- Modify: `src/home/registry.mjs`
- Modify: `src/home/router.mjs`
- Modify: `src/home/policy.mjs`
- Modify: `src/home/adapters/home-assistant.mjs`
- Modify: `src/home/adapters/mqtt.mjs`
- Modify: `android/feature/home/*`
- Test: `tests/home-main-runtime-contract.test.mjs`
- Test: `tests/smart-home.test.mjs`
- Create integration test: `tests/integration/home-live-contract.test.mjs`

- [ ] Charger les connecteurs configurés au boot au lieu d'un registre vide.
- [ ] Chiffrer tokens Home Assistant/MQTT, valider TLS, borner timeout/retry et afficher la santé.
- [ ] Découvrir puis faire approuver chaque appareil ; ne jamais contrôler arbitrairement tout le LAN.
- [ ] Attribuer le risque par `deviceClass`; inconnu = bloqué, jamais light par le nom.
- [ ] Hériter au niveau scène du risque maximal de ses membres.
- [ ] Installer le SDK Google Home officiel séparément après dépôt/licence par Nasro ; ne jamais inventer de dépendance Maven.
- [ ] Mapper seulement les traits réellement exposés et vérifier l'état après commande ; pas de `toggle` lors d'un retry.
- [ ] Critère : une lumière approuvée peut être allumée/éteinte et retourne `state_confirmed`; serrure/alarme/garage restent bloqués.

## Task 13: Vérifier et exposer correctement Sandbox et skills

**Files:**

- Modify: `src/core/capability-brief.mjs`
- Modify: `src/ui/main.mjs`
- Modify: `src/ui/pages/skills-sandbox-controller.mjs`
- Modify: `src/sandbox/sandbox-ui-manager.mjs`
- Test: `tests/capability-brief.test.mjs`
- Test: `tests/sandbox-main-runtime-contract.test.mjs`
- Test: `tests/reference-skills.test.mjs`
- Create integration test: `tests/integration/sandbox-live-smoke.test.mjs`

- [ ] Au démarrage, vérifier feature Windows Sandbox, exécutable, virtualisation, NTFS et digest des trois runtimes.
- [ ] Invalider le cache de capacité après installation/redémarrage ; ne plus afficher « désactivé » si la détection live est verte.
- [ ] Distinguer « 0 skill utilisateur » de « 4 skills embarqués » dans la réponse de Mina.
- [ ] Exposer noms, versions, permissions et statut de validation, sans dire « non configuré » pour un skill embarqué valide.
- [ ] Exécuter un smoke Python/JS/PowerShell borné dans Windows Sandbox, dans un dossier jetable Mina, sans accès aux SMS/secrets.
- [ ] Le réseau invité suit la politique du job ; le Wi-Fi du PC hôte ne doit jamais être modifié.
- [ ] Critère : Mina explique exactement ce qui manque et peut exécuter un exemple local après confirmation.

## Task 14: Finaliser YouTube, navigateur et persistance des comptes

**Files:**

- Modify: `src/media/youtube-data-client.mjs`
- Modify: `src/ui/main.mjs`
- Modify: `src/executors/browser-executor.mjs`
- Modify: `src/ui/pages/settings-controller.mjs`
- Test: `tests/youtube-data-client.test.mjs`
- Test: `tests/browser-profile-persistence.test.mjs`
- Create integration test: `tests/integration/youtube-search-browser.test.mjs`

- [ ] Brancher la clé YouTube Data API depuis le coffre et ajouter un health check `videos.list`/`search.list` à quota minimal.
- [ ] Pour une recherche YouTube, préférer l'API pour identifier les résultats puis ouvrir l'URL vérifiée ; utiliser l'UI seulement si nécessaire.
- [ ] Corriger focus et saisie dans la barre YouTube via sélecteurs accessibles, action clavier réelle et vérification de valeur.
- [ ] Conserver le profil Chromium sous la racine Mina avec singleton et fermeture propre ; vérifier session Gmail après redémarrage.
- [ ] Les téléchargements respectent droits, source et confirmation ; ne pas contourner DRM/conditions de service.
- [ ] Critère : « cherche une chanson sur YouTube » saisit/recherche ou ouvre un résultat API et prouve le titre affiché.

## Task 15: Observabilité, budgets et auto-récupération

**Files:**

- Modify: `src/diagnostics/technical-log.mjs`
- Create: `src/diagnostics/error-aggregator.mjs`
- Create: `src/diagnostics/system-pulse.mjs`
- Modify: `src/ui/pages/analytics-controller.mjs`
- Modify: `src/ui/main.mjs`
- Test: `tests/error-aggregator.test.mjs`
- Test: `tests/system-pulse.test.mjs`
- Test: `tests/analytics-ui-contract.test.mjs`

- [ ] Dédupliquer les erreurs identiques par signature et afficher compteur, première/dernière occurrence, cause et prochaine tentative.
- [ ] Relier une demande utilisateur à tous ses appels provider/actions/preuves via `correlationId`.
- [ ] Afficher quotas/cooldowns Gemini, OpenRouter, Modal, DeepSeek et local ; arrêter les retries quand le budget est épuisé.
- [ ] Ajouter pulse ADB Huawei/Samsung, caméra, Telegram, LM Studio, sandbox, mail, Firebase, maison et imprimante.
- [ ] Ajouter boutons « copier diagnostic expurgé », « retester », « ouvrir le dossier de logs » et « effacer ».
- [ ] Aucun token, email complet, numéro complet, corps SMS ou image caméra dans un export diagnostic.
- [ ] Critère : un échec Telegram explique cible/provider/retry sans 20 lignes identiques par minute.

## Task 16: Rotation des secrets et sécurité finale

**Files:**

- Modify: `src/security/provider-secret-store.mjs`
- Modify: `src/config/env-document.mjs`
- Modify: `.env.example`
- Test: `tests/secret-handling.test.mjs`
- Test: `tests/env-document.test.mjs`

- [ ] Révoquer le token Telegram publié dans la conversation et générer un nouveau token BotFather.
- [ ] Vérifier Modal, Gemini, OpenRouter, DeepSeek, Google OAuth, Firebase, IMAP/SMTP et Home sans imprimer leur valeur.
- [ ] Migrer les secrets encore présents dans `.env` vers le coffre chiffré quand l'API le permet.
- [ ] Ajouter un scanner de logs/configs qui ne retourne que noms de variables et emplacements, jamais les valeurs.
- [ ] Tester permissions de fichiers, redaction, export/suppression mémoire et accès aux racines `C:`/`G:`.
- [ ] Critère : aucun secret utilisable n'apparaît dans les sources, logs, rapports ou plan.

## Task 17: Matrice de recette réelle et redémarrage

**Files:**

- Create: `tests/manual/MINA-VISION-ACCEPTANCE.md`
- Modify: `scripts/verify-mina.mjs`
- Create: `scripts/smoke-live.mjs`
- Modify: `package.json`

- [ ] Ajouter une commande read-only de santé et une commande smoke live explicitement opt-in.
- [ ] Tester PC : fichier Mina, fichier hors Mina avec confirmation, navigateur Google/YouTube, impression factice puis réelle supervisée.
- [ ] Tester Huawei USB puis Wi-Fi : caméra avant/arrière, capture, SMS entrant, SMS confirmé, reconnexion après reboot.
- [ ] Tester Samsung Wi-Fi : Telegram conversation, tâche Google confirmée, état mail, commande lumière low-risk.
- [ ] Tester providers : auto avec 429 simulé, Modal vide simulé, local-first, local-only, LM Studio éteint/rallumé.
- [ ] Tester mémoire cross-channel : SMS mémorisé retrouvé depuis Telegram et interface locale, puis suppression.
- [ ] Tester sandbox Python/JS/PowerShell et refus d'accès hors workspace.
- [ ] Lancer `npm test`; attendu : tous les tests unitaires verts.
- [ ] Lancer `npm run test:integration`; attendu : tous les tests d'intégration verts.
- [ ] Lancer `android\gradlew.bat testDebugUnitTest`; attendu : tous les tests JVM Android verts.
- [ ] Lancer les tests instrumentés Huawei seulement avec appareil branché et accord explicite.
- [ ] Redémarrer Windows, attendre deux minutes et vérifier autostart Mina, ADB Wi-Fi Huawei/Samsung, Telegram, profil Gmail et absence de boucle de logs.

---

## 3. Dépendances humaines/configuration restantes

- Nouveau token Telegram après révocation du token exposé.
- Identifiants HTTPSMS ou décision d'auto-héberger le service AGPL séparément.
- Projet Firebase et credentials déposés via l'écran sécurisé Mina.
- Comptes Gmail/Microsoft/IMAP de test et consentements OAuth donnés par Nasro.
- SDK Google Home officiel téléchargé par Nasro depuis la zone authentifiée et déposé hors dépôt avec licence/hash.
- Choix d'une lumière non critique pour la recette maison.
- Choix et consentement explicite pour l'enrôlement facial.
- Liste des contacts autorisés et choix du mode SMS.

## 4. Définition globale de terminé

- Chaque capacité annoncée par Mina correspond à un service réellement composé et à un health check live.
- Toute action mutante possède proposition, décision de politique, confirmation si requise, reçu et vérification.
- Les redémarrages, coupures USB/Wi-Fi et 429 ne produisent ni doublon, ni boucle coûteuse, ni perte silencieuse.
- Les modes cloud-first/local-first/local-only fonctionnent par rôle avec affichage du modèle réellement utilisé.
- Telegram, SMS, email, tâches, mémoire et UI partagent l'identité du propriétaire et la même mémoire, sans permettre aux canaux distants de contourner les politiques locales.
- Les suites Node et Android sont vertes et la matrice manuelle est signée avec date, appareil, transport et preuve expurgée.

## 5. Auto-revue du plan

- Couverture : tous les écarts vérifiés dans `main.mjs`, les erreurs collées, HTTPSMS, Firebase, Telegram, SMS, mail, Google, impression, documents, skills, sandbox, local/HF, biométrie, maison et reprise après reboot sont assignés à une tâche.
- Cohérence : les modules déjà présents sont raccordés au lieu d'être réécrits ; HTTPSMS est isolé juridiquement ; le modèle ne reçoit aucun accès direct aux exécuteurs.
- Sécurité : confirmations hors racines Mina, secrets chiffrés, canaux distants bornés, biométrie non souveraine et maison à risque bloquée.
- Vérification : chaque tâche contient fichiers, test rouge, commande verte ou critère d'acceptation ; aucune étape indéterminée ne subsiste.
