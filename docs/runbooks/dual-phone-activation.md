# Runbook — Activation dual-phone (appels + SMS + Google Tasks)

Ce runbook transforme en checklist EXÉCUTABLE tout ce qui reste pour passer le domaine communications
de « code écrit + dormant » à « live ». Le code est fait, testé et câblé (voir la spec
[../superpowers/specs/2026-07-29-mina-dual-phone-calls-sms-google-tasks-design.md] « État d'avancement »).
Rien ici ne s'active seul (§19) : chaque étape est une action explicite de Nasro. Les preuves matérielles
sont des constats **au clavier**, pas des tests automatisés.

> Discipline : un `fail` bloque l'activation de l'étape suivante. La porte HFP §6 est le prérequis au
> décrochage — tant qu'elle n'est pas `PASS`, `compose-call-handling` reste en observation par construction.

---

## A. Audio HFP — RÉSOLU sans dépendance native ✅

Décision prise (2026-08-21) : **zéro dépendance native**. L'I/O audio HFP réutilise la stack Web Audio du
renderer (Chromium `getUserMedia` + `AudioContext`), exactement comme la voix. Code fait + testé :
`src/telephony/hfp-web-audio.mjs` (`enumerateHfpAudioEndpoints` par groupId, `openHfpScoLink` capture RX +
TX, santé). Aucun risque `npm install` / rebuild Electron.

Reste (câblage, exercé par la porte B) : brancher `openHfpScoLink` côté renderer à `windows-hfp-audio-port`
(main) via IPC — le port devient async ; le stream RX alimente le STT, la TTS alimente le TX. Ce câblage se
fait EN MÊME TEMPS que la porte HFP live (il n'a de sens qu'avec le matériel présent).

---

## B. Porte de faisabilité HFP §6 (13 scénarios, les 2 téléphones)

Prérequis : A fait, PC Bluetooth ON, Samsung ET Huawei appairés SÉPARÉMENT au PC.

- [ ] Tél 1 seul : RX distant capturé.
- [ ] Tél 1 seul : TTS Mina reçu par l'appelant.
- [ ] Tél 2 seul : RX distant capturé.
- [ ] Tél 2 seul : TTS Mina reçu par l'appelant.
- [ ] Les deux appairés, aucun appel : endpoints stables (même `deviceId`, pas un nom BT).
- [ ] Appel tél 1 pendant que tél 2 reste connecté (aucune fuite audio croisée).
- [ ] Appel tél 2 pendant que tél 1 reste connecté.
- [ ] Perte Bluetooth pendant un appel → `mustStop` (jamais un appel muet).
- [ ] Reconnexion Bluetooth après veille → même `deviceId`.
- [ ] Reboot d'un téléphone → re-résolution correcte.
- [ ] Reboot Windows → re-résolution correcte.
- [ ] Mesure d'écho avec la TTS active.
- [ ] Barge-in : l'appelant coupe Mina sans boucle audio.

**PASS** = les 13 verts sur les DEUX téléphones. **FAIL** = aucun contournement acoustique ; les appels
restent en observation ; présenter le brut à Nasro pour redécider l'architecture (§6.3).

---

## C. Rôle dialer on-device + dépendance app

- [x] Ajouter `implementation(project(":feature:telephony"))` au `android/app/build.gradle.kts` — FAIT (InCallService fusionné, `:app:assembleDebug` vert, vérifié dans le merged manifest).
- [ ] Réinstaller l'APK sur les 2 tél (`.\gradlew.bat packageMinaApk` puis `adb install -r`).
- [ ] Sur chaque tél : accorder le rôle dialer via l'intent `DialerRole.requestIntent(context)` (écran système « application Téléphone par défaut »).
- [ ] Vérifier `DialerRole.isHeld(context) == true`.

**Porte Phase 5** : contrôle Android fonctionnel (détecter/refuser/raccrocher), média encore désactivé.

---

## D. Google OAuth `mina-vision` (drain SMS→Tasks réel)

Repris de l'ordre de reprise du tracker Codex ([../superpowers/execution/2026-08-02-mina-remaining-work.md]) :

- [ ] Configurer Google Auth Platform dans le projet `mina-vision`, audience de test.
- [ ] Ajouter `mina.vision.ai@gmail.com` comme testeur.
- [ ] Créer/télécharger un client OAuth **Desktop** `mina-vision` → `env/client_secret_*.json`.
- [ ] `npm run connect:google` (dans un **Chrome normal non piloté** — Google refuse les navigateurs contrôlés).
- [x] Brancher `createGoogleTasksListAdapter` comme `taskApi` du domaine communications — FAIT (exposé par
  `google-runtime-adapters`, résolu paresseusement par le domaine ; devient réel dès la connexion, sans redémarrage).

Tant que le compte n'est pas connecté : le domaine est `degraded`, les tâches s'accumulent dans l'outbox durable (jamais perdues).

---

## E. Validation juridique du message d'accueil (§17)

- [ ] Faire valider juridiquement le texte de base `DISCLOSURE_BASE_TEXT` (§8.3) — ou fournir le texte définitif.
- [ ] Passer `legallyValidated=true` au `createCallDisclosure` composé.

Tant que non fait : `canGoLive()==false` → `compose-call-handling` reste en observation (Mina ne décroche pas).

---

## F. Pilote §19 — données de Nasro

- [ ] Fournir la liste des **contacts connus** (numéros E.164) autorisés au niveau pilote.
- [ ] Fournir les **horaires ouvrés** (startHour/endHour) du pilote.

---

## G. Activation par niveau (§19) — le dernier interrupteur

- [ ] SMS→tâche : poser `MINA_SMS_TASK_INGEST=true` (User env) → chaque SMS entrant devient une tâche différée.
- [ ] Choisir le niveau d'appel (`observe`→`assisted`→`pilot`→`dual`→`unknown_numbers`) et le fournir à `evaluateIncomingCall`.

> Aucun niveau ne s'active seul. Commencer par `assisted` avec un seul contact connu, valider, puis monter.

---

## Ordre recommandé

**A → B (porte, le déblocage central) → C → E → F → G(appels)** pour la voix ; **D → G(`MINA_SMS_TASK_INGEST`)**
en parallèle pour les SMS→Tasks. D et E/F sont indépendants de la porte HFP et peuvent se faire d'abord.
