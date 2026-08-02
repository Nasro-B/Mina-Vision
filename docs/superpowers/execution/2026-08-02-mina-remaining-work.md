# Mina Vision — tâches restantes de réconciliation

> État au 2026-08-02 08:51 (Africa/Lagos). Ce tableau consolide les dernières preuves du [journal de réconciliation](2026-07-29-mina-reconciliation-log.md), de la [preuve de release](../../operations/RELEASE-EVIDENCE-2026-07.md) et du [ledger du chat natif](2026-07-29-mina-native-chat-scope-ledger.md). Il ne transforme aucune recette matérielle, compte externe ou décision produit en succès.

## Clos avec preuve récente

- [x] Tests unitaires après la décision VRM : `417` fichiers / `3 378` tests passés.
- [x] Firebase local : projet et app Android inventoriés en lecture seule ; configuration locale et règles testées dans Auth/Firestore/Storage Emulator sur loopback.
- [x] LM Studio local : génération texte et embedding Mina passés avec Gemma et Nomic chargés.
- [x] Indexation initiale Mina Code : corpus réel de `935` fichiers indexé en `23 481 ms`, sous l'objectif historique `<30 s`.
- [x] Avatar VRM : explicitement hors périmètre ; aucun asset, modèle, dépendance ou distribution VRM ne doit être ajouté.

## Reste à faire — décision ou prérequis nécessaire

### Runtime local

- [ ] **Vision locale Mina** — un JPEG synthétique valide a fait crasher Gemma via la route Mina. Ne pas promouvoir la vision avant une sonde image réussie avec un modèle stable. L'unique autre modèle vision inventorié pèse `7,95 GiB` pour `7,74 GiB` libres lors de la mesure : aucun changement de modèle ou de configuration n'est autorisé par ce tableau.
- [ ] **Voix locale complète hors réseau** — la recette requiert microphone → STT local → modèle → TTS, réseau désactivé. Kokoro n'était pas présent dans le cache local et la mémoire libre mesurée est `1,87 GiB`; aucun téléchargement ni chargement n'a été lancé.
- [ ] **Packaging voix locale** — décision de distribution eSpeak/Kokoro requise avant publication de ce chemin.

### Contrats produit à choisir avant code

- [ ] **Grounding live** — choisir le contrat de corrélation `claimId` entre proposition, rendu et citation avant de raccorder `startMission` ou `phoneMessageSync`.
- [ ] **Chat natif Android** — choisir l'option A (tâches 13–25, chat complet) ou B (socle expérimental limité et limites publiées). Le ledger constate `102` chemins déclarés, `4` présents et `98` absents pour les tâches 13–25 ; cette mesure ne valide pas fonctionnellement les quatre présents.
- [ ] **Téléchargement de pièces jointes mail** — choisir et autoriser le contrat de récupération, quarantaine et persistance chiffrée. Le contenu brut n'est pas persisté actuellement ; `downloadAttachment` ne doit pas être annoncé comme disponible.
- [ ] **Documents / impression** — fournir ou choisir un renderer de formulaire réel, puis une recette d'impression physique si cette capacité doit devenir disponible.

### Preuves externes ou physiques

- [ ] **Firebase cloud** — autorisation explicite immédiate requise avant toute création de session/document distant ou déploiement de règles. Aucun test local Emulator ne vaut preuve cloud.
- [ ] **Android utilisateur** — parcours application, permissions caméra/micro, SMS et Telegram sur appareil autorisé. Le test instrumentation isolé passé ne prouve pas ce parcours.
- [ ] **Google Home** — SDK signé, relais autorisé et recette sur lumière non critique, supervisée.
- [ ] **Mail fournisseurs** — comptes de test dédiés, consentement OAuth/TLS et opérations réversibles réelles par fournisseur.
- [ ] **Windows Sandbox** — preuve d'isolation physique dédiée.
- [ ] **Chrome via l'extension demandée** — réinstaller/réparer le plugin navigateur Codex : l'extension est installée, mais son hôte natif Chrome n'est pas enregistré ; aucune navigation de contournement n'est utilisée.

## Ordre de reprise proposé

1. Décider le périmètre chat natif, le contrat grounding et le contrat de pièces jointes.
2. Fournir ou autoriser les prérequis locaux voix/vision ; effectuer ensuite les sondes dédiées.
3. Donner un feu vert explicite, action par action, pour Firebase cloud, Android, Home, mail et Sandbox.
4. Rejouer `npm run verify:release` après toute nouvelle vague de code et actualiser ce tableau avec les sorties réellement observées.
