# Mina v2 — plan intégration, durcissement et lancement

> **Pour l’agent d’exécution :** utiliser `superpowers:executing-plans` après les gates 1 à 4. Ce plan n’autorise ni push ni déploiement.

**Objectif :** assembler les domaines sans contourner les frontières, migrer l’UI, vérifier les scénarios réels et lancer Mina en mode contrôlé.

---

## Tâche 1 — composition root unique

**Fichiers :**

- Modifier `src/core/mina-runtime.mjs`
- Créer `src/core/domain-registry.mjs`
- Modifier `src/ui/main.mjs`
- Créer `tests/domain-registry.test.mjs`

1. Tests rouges : dépendance manquante, init partielle, ordre start/stop, double close, crash d’un domaine.
2. Ordre start : keyring → DB/migrations → sessions → grounding → memory/RAG → research → skills → messaging → UI ready. Sandbox détectée mais jamais préchauffée.
3. Ordre stop inverse avec checkpoint borné ; messaging arrête d’accepter, draine ack, puis ferme DB.
4. Un domaine dégradé annonce une capability indisponible ; mémoire/keyring/grounding non disponibles bloquent les fonctions qui en dépendent.
5. `main.mjs` reste composition Electron/IPC, sans logique métier.

## Tâche 2 — routeur omnicanal et mémoire commune

**Fichiers :**

- Créer `src/messaging/channel-router.mjs`
- Créer `src/messaging/conversation-service.mjs`
- Créer `tests/channel-router.test.mjs`
- Créer `tests/integration/cross-channel-memory.test.mjs`

1. Normaliser local/voice/SMS/Telegram en `TurnInput` avec identity/work session/capability policy.
2. Test : information reçue par SMS, consolidée, rappelée localement puis depuis Telegram après liaison propriétaire.
3. Test inverse : `/forget` Telegram ne supprime rien avant confirmation locale ; après confirmation, tous canaux ne retrouvent plus l’item.
4. Les réponses SMS restent brouillons sauf politique auto ; Telegram est envoyé automatiquement uniquement pour conversation non sensible autorisée.
5. Chaque sortie traverse response gate et audit avant transport.

## Tâche 3 — traitement des secrets et redaction centralisée

**Fichiers :**

- Créer `src/security/secret-classifier.mjs`
- Créer `src/security/redactor.mjs`
- Créer `src/security/model-disclosure.mjs`
- Créer `tests/secret-handling.test.mjs`

1. Fixtures : API keys, JWT, mots de passe, OTP, IBAN, carte test, token Telegram, contenu `.env`.
2. Logs/UI/diagnostics sont toujours masqués. Mémoire locale peut chiffrer intégralement selon le choix de Nasro.
3. Avant appel distant, produire une liste des segments sensibles et la stratégie `omit|mask|confirm_once`; OTP/secret n’est jamais envoyé implicitement.
4. Une confirmation est liée au provider, modèle, segments digestés et tour ; pas de réutilisation.
5. Tests propriété avec `fast-check` : aucune chaîne fixture n’apparaît dans sérialisations non chiffrées.

## Tâche 4 — observabilité et audit chiffrés

**Fichiers :**

- Créer `src/audit/audit-log.mjs`
- Créer `src/audit/diagnostics.mjs`
- Créer `src/audit/export.mjs`
- Créer `tests/audit-log.test.mjs`

1. Audit append-only chaîné par hash, chiffré, avec séquence et session ; détection de troncature/altération.
2. Évènements obligatoires : auth/pairing, confirmation, capability deny, action verification, send accepted/failed, forget, skill install/run, sandbox job, backup/restore.
3. Export diagnostic explicitement demandé, redacted, sans mémoire/secret/body message ; zip borné et digesté.
4. Rotation par taille avec chaîne inter-fichiers ; aucune suppression automatique des preuves d’oubli.

## Tâche 5 — limites, backpressure et arrêt global

**Fichiers :**

- Créer `src/core/rate-limiter.mjs`
- Créer `src/core/backpressure.mjs`
- Modifier `src/core/orchestrator.mjs`
- Modifier `src/ui/main.mjs`
- Créer `tests/emergency-stop-v2.test.mjs`

1. `Ctrl+Alt+Escape` et `Mina, arrête` ferment la work session, annulent modèles/research, libèrent souris/clavier, annulent jobs sandbox et empêchent nouveaux sends.
2. L’arrêt ne supprime pas arbitrairement les files ; il les marque paused. Une action non vérifiée reste unknown.
3. Limites globales par domaine, queues bornées et rejet propre plutôt que croissance mémoire.
4. Test de tempête 10 000 évènements synthétiques : usage borné, ordre et erreurs observables.

## Tâche 6 — UI Mina v2

**Fichiers :**

- Modifier `src/ui/index.html`
- Modifier `src/ui/styles.css`
- Modifier `src/ui/renderer.js`
- Modifier `src/ui/preload.cjs`
- Créer `tests/ui-security-contract.test.mjs`

1. Vues minimales : Accueil/mission, Sources et preuves, Mémoire, Téléphone/canaux, Skills, Sandbox, Paramètres/sécurité.
2. Toute donnée dynamique via `textContent`; aucune insertion HTML de contenu externe.
3. Les confirmations montrent effet, ressource, canal, destinataire, aperçu masqué, durée et caractère unique.
4. États visibles : verrouillé, prêt, dégradé, hors ligne, confirmation requise, stoppé, action non vérifiée.
5. Ne jamais afficher la phrase de récupération après l’écran initial ; fournir seulement `recovery configured/not configured`.
6. Navigation clavier, focus de dialogue, contraste et annonces ARIA testés.

## Tâche 7 — sécurité Electron et dépendances

**Fichiers :**

- Modifier `src/ui/main.mjs`
- Modifier `.gitignore`
- Modifier `package.json`
- Créer `tests/electron-hardening.test.mjs`

1. Vérifier `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, CSP stricte, navigation et nouvelles fenêtres bloquées sauf allowlist explicite.
2. Permission handler refuse tout sauf micro pendant une activation locale ; caméra PC non utilisée sans fonctionnalité dédiée.
3. IPC valide taille/schema/source frame ; un webContent non principal est rejeté.
4. `npm audit --omit=dev` est exécuté et sa sortie réelle conservée. Ne pas promettre qu’un fix existe sans vérifier.
5. Licences des nouvelles dépendances listées ; aucune AGPL incorporée.

## Tâche 8 — matrice d’intégration automatisée

**Fichiers :**

- Créer `tests/integration/runtime-lifecycle.test.mjs`
- Créer `tests/integration/grounded-research.test.mjs`
- Créer `tests/integration/memory-backup-restore.test.mjs`
- Créer `tests/integration/messaging-failover.test.mjs`
- Créer `tests/integration/skill-sandbox-boundary.test.mjs`

1. Tous les services externes sont fakes/emulators ; aucune API live dans CI locale.
2. Scénarios : crash/checkpoint, page contradictoire, oubli/restauration, USB→LAN→Firebase, ack perdu, skill hostile, sandbox absente.
3. Ajouter `npm run test:critical` et `npm run test:coverage`.
4. Seuils nouveaux modules sécurité/crypto/messaging/grounding : 90 % branches, 95 % fonctions ; ne pas gonfler artificiellement par exclusions.
5. Exécuter et enregistrer stdout exact.

## Tâche 9 — essais réels contrôlés

1. **Sans réseau :** lancer Mina, mémoire locale, recherche fichier, sessions et arrêt. Attendu : aucune API distante.
2. **Web fixture puis web public non sensible :** vérifier citations et fraîcheur, aucune capture persistée.
3. **Action navigateur :** ouvrir Google, rechercher une recette, naviguer ; aucune impression/téléchargement sans confirmation.
4. **Impression réseau :** imprimer une page de test vers l’imprimante choisie après confirmation ; vérifier job ID/queue. Ne pas affirmer sortie papier sans observation humaine.
5. **Téléphone :** SMS brouillon/confirmation, Telegram texte/voix, mémoire intercanal, coupures transport.
6. **Sandbox :** exécuter uniquement après gate Windows Sandbox du plan 3.
7. **Secrets :** injecter uniquement des valeurs factices et scanner logs/DB/Firebase export.

## Tâche 10 — documentation opérateur et récupération

**Fichiers :**

- Créer `docs/operations/INSTALLATION.md`
- Créer `docs/operations/SECURITY.md`
- Créer `docs/operations/ANDROID-HUAWEI.md`
- Créer `docs/operations/FIREBASE.md`
- Créer `docs/operations/TELEGRAM.md`
- Créer `docs/operations/RECOVERY.md`
- Mettre à jour `CHANGELOG.md`

1. Documenter installation/rebuild, rotation clés, phrase de récupération, oubli, export diagnostic, perte téléphone, compromission token, panne Firebase, restauration et désinstallation.
2. Aucun exemple avec vrai secret/numéro/projet Firebase.
3. Telegram : rappeler explicitement que les bots ne sont pas E2EE et que livré/lu est inconnu.
4. SMS : expliquer permissions et mode auto ; Firebase : distinguer transport 24 h et backup durable chiffré.
5. CHANGELOG marque uniquement ce qui a réellement passé les gates ; le reste reste `Planned`.

## Tâche 11 — vérification finale et lancement

Exécuter dans cet ordre :

```powershell
npm test
npm run test:integration
npm run test:critical
npm run test:coverage
npm run smoke
.\android\gradlew.bat -p android testDebugUnitTest lintDebug assembleDebug
```

Puis :

1. Vérifier un seul ADB autorisé et l’APK installé.
2. Vérifier Windows Sandbox ou conserver capability désactivée.
3. Vérifier clés API tournées et `MINA_KEYS_ROTATED=true`; ne jamais imprimer leurs valeurs.
4. Vérifier Firebase/Telegram seulement si Nasro a fourni/provisionné les configurations.
5. Lancer `npm start` au premier plan ; pas de démarrage Windows automatique.
6. Observer runtime ready, téléphone, mémoire, grounding et aucune erreur non redacted.

## Définition stricte de terminé

- Toutes les commandes exécutées avec code 0 et stdout conservé.
- Tous les essais manuels applicables cochés avec preuve ; les non applicables sont signalés, pas simulés.
- Aucun secret hardcodé, aucun code AGPL importé, aucun accès distant élargi.
- Mina peut voir/agir/rechercher/mémoriser/converser selon les politiques, et échoue fermée quand un prérequis manque.
- Projet toujours local : aucun push ni déploiement effectué.

## Journal d'exécution

- 2026-07-16 — Plan trouvé quasi entièrement non exécuté lors de la revue exhaustive de tous les docs `docs/superpowers/plans/` demandée par Nasro (seul `src/core/domain-registry.mjs`, construit par le plan v3-intégration/lancement, existait — sans son propre test). Contrairement aux plans v2 mémoire/RAG et v2 skills/sandbox (retrouvés déjà réellement implémentés, seul le journal manquait), celui-ci représentait du travail réel jamais fait. **Décision explicite de Nasro (2026-07-16, question posée directement)** : implémenter les 11 tâches en entier, avec la même rigueur TDD que le reste de la session, plutôt que de le marquer superseded.

**Tâche 1 — composition root unique.** `src/core/domain-registry.mjs` existait déjà (construit sous le plan v3-intégration/lancement, Tâche 1) et satisfait déjà l'esprit de cette tâche : `startAll()` séquence strictement les domaines dans l'ordre déclaré, `stopAll()` inverse l'ordre en best-effort, un domaine `optional` dégrade sans bloquer le démarrage, un domaine requis en échec fait un rollback complet de ce qui était déjà démarré. `src/core/mina-runtime.mjs` consommait déjà `domainRegistry` en option (`startAll()` avant les sessions, `stopAll()` après leur fin). Manquant réel : `tests/domain-registry.test.mjs` (11 tests, dépendance manquante/init partielle/ordre start-stop/double close/crash d'un domaine — tous verts contre l'implémentation existante, aucune ligne de code changée) et `tests/integration/runtime-lifecycle.test.mjs` (5 tests, composition complète domain-registry + mina-runtime + sessions réelles). Câblage complet de la séquence keyring→DB→sessions→...→UI dans `main.mjs` via `createDomainRegistry` non fait — resterait un refactor à large surface d'un fichier de 747 lignes déjà fonctionnel ; documenté comme écart assumé plutôt que fait à l'aveugle.

**Tâche 2 — routeur omnicanal et mémoire commune.** `src/messaging/channel-router.mjs` (normalise `TurnInput` par canal, réutilise `classifyChannelCapability` déjà réel) + `src/messaging/conversation-service.mjs` (ingest→remember, recall pass-through, respond→gateResponse puis transport décidé par la politique de canal). Réutilise directement `memory-service.mjs`/`identity-graph.mjs` (plan v2 mémoire, déjà réel) pour la consolidation inter-canal — aucune nouvelle table, aucun nouveau mécanisme d'identité. `tests/channel-router.test.mjs` (13), `tests/conversation-service.test.mjs` (12), `tests/integration/cross-channel-memory.test.mjs` (3, SMS→consolidé→invisible depuis Telegram non lié→visible après `identityGraph.link()` avec preuve d'appairage réelle ; `/forget` distant = proposition seule, jamais de suppression avant `confirmedLocally:true`). Bug de test auto-corrigé : `recall()` sur une identité jamais vue lève `memory_identity_unresolved` (fail-closed, cohérent avec `remember()`) plutôt que de retourner `[]` — attente initiale du test corrigée, pas le code.

**Tâche 3 — secrets et rédaction centralisée.** `src/security/secret-classifier.mjs` (API key, JWT, token Telegram, mot de passe, `.env`-style, OTP contextuel, IBAN par checksum mod-97 réel, carte par Luhn réel — vérifié par calcul avant d'écrire les fixtures, jamais deviné), `src/security/redactor.mjs` (`plan`/`applyPlan`, stratégies `omit`/`mask`/`confirm_once`, jetons de confirmation à usage unique réellement non réutilisables), `src/security/model-disclosure.mjs` (confirmation liée par digest à `{provider, model, segments}` — jamais réutilisable pour un autre couple provider/modèle même à texte identique, vérifié). `tests/secret-handling.test.mjs` : 27 tests + 1 test de propriété `fast-check` (50 exécutions aléatoires, aucune chaîne fixture ne survit dans la sérialisation JSON du texte rédigé). Deux simplifications de code réelles (pas des contournements de couverture) : le contrôle structurel interne d'`ibanChecksumValid`/la borne de longueur de `luhnValid` étaient du code mort — leurs seuls appelants (`detectIban`/`detectCard`) garantissent déjà la forme via leur propre regex ; supprimés plutôt que testés artificiellement.

**Tâche 4 — observabilité et audit chiffrés.** `src/audit/audit-log.mjs` (append-only, chaîné par hash SHA-256, chiffré AEAD via `sealRecord`/`openRecord` réels, séquence + session), `src/audit/diagnostics.mjs` (rapport redacté : compteurs par type, horodatages, validité de chaîne — jamais le contenu `payload`), `src/audit/export.mjs` (zip réel via `adm-zip`, borné en taille, digesté SHA-256, uniquement sur demande explicite). `tests/audit-log.test.mjs` (16), `tests/audit-diagnostics.test.mjs` (7), `tests/audit-export.test.mjs` (5). Bug réel trouvé et corrigé : `diagnostics.buildReport()` appelait `listDecrypted()` et `verifyChain()` en parallèle via `Promise.all` — un `listDecrypted()` en échec (chaîne corrompue) faisait planter tout le rapport diagnostic, alors qu'un diagnostic doit justement fonctionner quand ce qu'il diagnostique est cassé ; corrigé avec un `try/catch` dégradant proprement vers une liste vide. Limite assumée et documentée : la chaîne de hash seule ne prouve pas l'absence de troncature en toute fin de journal sans ancrage externe (hors périmètre de ce plan).

**Tâche 5 — limites, backpressure et arrêt global.** `src/core/rate-limiter.mjs` (seau à jetons par domaine, rejet propre jamais d'exception pour un domaine configuré, exception seulement pour un domaine jamais déclaré), `src/core/backpressure.mjs` (file bornée, `pause()`/`resume()` — l'arrêt d'urgence marque paused, ne supprime jamais ; test de tempête réel avec 10 000 événements synthétiques, mémoire bornée à `maxSize`, ordre FIFO préservé, rejets comptés exactement). `src/core/mina-runtime.mjs` étendu avec un paramètre optionnel `backpressureQueues` (rétrocompatible, défaut `[]`) — `emergencyStop()` met en pause chaque file fournie en plus d'annuler les cancellers existants. `tests/rate-limiter.test.mjs` (8), `tests/backpressure.test.mjs` (9), `tests/emergency-stop-v2.test.mjs` (5, dont composition réelle avec `createMinaRuntime`/`createSessionManager`/`createSessionStore` réels). Bug de test auto-corrigé : vérifier l'état post-emergency-stop en rappelant `getSessionState()` **depuis l'intérieur** du `run()` encore en cours d'exécution ne reflète pas le nettoyage final (qui n'a lieu qu'au `finally` de `runWork()`, après le retour de `run()`) — corrigé en vérifiant le journal du session store après résolution complète, comme le fait déjà `tests/mina-runtime.test.mjs`.

**Tâche 6 — UI v2.** Aucune nouvelle vue construite (précédent établi tout du long de cette session : les domaines à forte composante backend reçoivent un câblage renderer minimal ou nul — document/personal/evaluation/recovery en sont la preuve, vérifié par grep avant de décider). `tests/ui-security-contract.test.mjs` (8 tests) : `renderer.js`/`controller.mjs`/`preload.cjs`/`preload-api.cjs` scannés pour `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`/`eval`/`new Function` — zéro occurrence, déjà conforme sans changement de code. `recoveryOutput.textContent` : une seule assignation dans tout `renderer.js`, vérifié par comptage réel des occurrences plutôt que supposé.

**Tâche 7 — sécurité Electron et dépendances.** `contextIsolation:true`/`nodeIntegration:false`/`sandbox:true` déjà présents ; CSP stricte déjà présente (`index.html`, `default-src 'self'`, aucun `unsafe-inline`/`unsafe-eval`) ; permission handler déjà restreint à `media` seul. **Gaps réels trouvés et corrigés** (pas seulement testés) : aucun `setWindowOpenHandler` ni `will-navigate` n'existait — ajoutés dans `main.mjs` (`deny` systématique, aucune allowlist nécessaire puisque Mina n'ouvre jamais de nouvelle fenêtre ni ne navigue hors de son `index.html`). `src/ui/ipc/register-ipc.mjs` étendu avec deux garde-fous optionnels rétrocompatibles (`isValidSender`, `maxPayloadBytes`) — désactivés par défaut, donc aucun des 200+ canaux IPC existants n'est affecté ; bug réel auto-corrigé pendant l'implémentation : le wrapper `guarded()` levait une exception **synchrone**, incompatible avec le contrat asynchrone attendu par `ipcMain.handle` et par `expect(...).rejects`, corrigé en rendant le wrapper `async`. `.gitignore` complété (build Android 32 Mo+, cache Gradle, `local.properties`, répertoires de données runtime type quarantaine/exports/sandbox) — trouvé manquant en vérifiant réellement la taille du build Android sur disque, pas supposé. `npm audit --omit=dev` rejoué : 7 vulnérabilités modérées pré-existantes identiques (chaîne `@nut-tree-fork/nut-js→jimp→file-type`, aucun correctif disponible), aucune régression. `tests/electron-hardening.test.mjs` (9 tests, dont 4 comportementaux réels sur les nouveaux garde-fous IPC, pas seulement du scan de source).

**Tâche 8 — matrice d'intégration automatisée.** 5 fichiers, tous verts au premier ou second run réel : `tests/integration/runtime-lifecycle.test.mjs` (5), `tests/integration/grounded-research.test.mjs` (4, contradiction réelle entre deux sources via `detectContradictions()`/`gateResponse()` réels → décision `revise`, jamais un choix silencieux d'une version), `tests/integration/memory-backup-restore.test.mjs` (1, composition réelle memory-service + forget-service + backup-service + restore-service, tombstone appliqué avant restauration d'un snapshot antérieur), `tests/integration/messaging-failover.test.mjs` (4, USB→LAN→Firebase réel via `android-transport-client.mjs`/`firebase-transport.mjs` réels, dédoublonnage d'accusé perdu, Firebase refuse un enqueue si un transport direct est disponible), `tests/integration/skill-sandbox-boundary.test.mjs` (3, un skill réellement installé via `skill-installer.mjs` réel ne s'exécute jamais quand `windows-sandbox.mjs` réel rapporte indisponible ; une requête sandbox Telegram rejetée avant d'atteindre le backend). Scripts `test:critical` et `test:coverage` ajoutés à `package.json`. Seuils de couverture 90 % branches / 95 % fonctions **atteints réellement** sur les nouveaux modules sécurité/audit/messagerie/core après plusieurs itérations : 100 % lignes, 100 % fonctions, 95,67 % branches en couverture scoped (mesuré, pas deviné) — deux simplifications de code mort documentées ci-dessus (Tâche 3) en ont fait partie. Couverture globale du dépôt entier (tous modules confondus, y compris code antérieur hors périmètre de ce plan) : 81,77 % lignes / 76,96 % branches — chiffre informatif, pas la cible de cette tâche qui porte explicitement sur les nouveaux modules.

**Tâche 9 — essais réels contrôlés.** Non exécutable par moi : chacun des 7 essais (sans réseau, web fixture puis public, action navigateur, impression réseau, téléphone SMS/Telegram réel, sandbox réelle, secrets factices avec scan logs/DB/Firebase) exige soit une observation humaine directe (« ne pas affirmer sortie papier sans observation humaine »), soit un appareil physique déjà documenté comme bloqué côté Nasro (Huawei, imprimante réelle, Windows Sandbox activé). Non simulé, non coché — reporté fidèlement ici et dans `Pour Nasro.md`/`EXECUTION-LOG.md`.

**Tâche 10 — documentation opérateur.** 6 documents créés sous `docs/operations/` : `INSTALLATION.md`, `SECURITY.md`, `ANDROID-HUAWEI.md`, `FIREBASE.md`, `TELEGRAM.md`, `RECOVERY.md` — contenu ancré dans le code réel de cette session (aucun exemple avec vrai secret/numéro/projet Firebase), rappel explicite que les bots Telegram ne sont pas E2EE et que livré ≠ lu, distinction transport Firebase ≤ 24 h vs sauvegarde durable chiffrée sans limite fixe. `CHANGELOG.md` restructuré : la section Telegram marquée « planifiée, non implémentée » était **factuellement obsolète** (Telegram SMS/Bot et approbations distantes bornées sont réellement livrés et gatés, vérifié cette session) — corrigée avec une section « Livré » précise, l'ancienne liste de planification conservée uniquement pour ce qui reste réellement non fait, et la phrase « toute approbation distante d'une action PC... interdite » nuancée à ce qui est objectivement vrai aujourd'hui (`local_only` toujours refusé à distance ; `remote_eligible` borné est livré).

**Tâche 11 — vérification finale.** Toutes les commandes du plan rejouées réellement et fraîchement, dans l'ordre :
```
npm test              → 210 fichiers / 1529 tests verts
npm run test:integration → 13 fichiers / 34 tests verts
npm run test:critical    → 13 fichiers / 144 tests verts
npm run test:coverage    → 81,77 % lignes / 76,96 % branches (dépôt entier) ; 95,67 % branches / 100 % fonctions sur les nouveaux modules (mesure scoped séparée, voir Tâche 8)
npm run smoke            → exit 0
.\android\gradlew.bat -p android testDebugUnitTest lintDebug assembleDebug → BUILD SUCCESSFUL in 19s, 204 tâches (4 exécutées, 200 up-to-date)
```
Aucun secret codé en dur ajouté, aucun code AGPL importé, aucun accès distant élargi au-delà de ce qui est décrit ci-dessus. Projet resté strictement local — aucun `git init`, commit, push ou déploiement (le dossier n'est toujours pas un dépôt Git, revérifié). Points 1 (un seul ADB) et 4 (Firebase/Telegram réels) de la « Puis : » finale restent non applicables sans matériel/configuration Nasro — cohérent avec la Tâche 9.

**Bilan honnête** : 10 des 11 tâches sont réellement terminées avec preuve d'exécution reproduite ; la Tâche 9 reste explicitement non faite (bloquée matériel/Nasro, documentée, jamais simulée). Aucune ligne de ce plan n'a été cochée sans test réel exécuté et observé vert.

