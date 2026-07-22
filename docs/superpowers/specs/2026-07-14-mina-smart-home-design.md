# Mina — maison connectée locale et Google Home

**Statut :** design validé oralement par Nasro le 14 juillet 2026.

## Objectif

Permettre à Mina de lire et contrôler de manière fiable les appareils de la maison déjà présents dans Google Home, puis d’ajouter des voies locales Home Assistant, Matter, MQTT et API constructeur validées.

Une demande telle que « Mina, allume la lumière de la chambre » doit résoudre la pièce et l’appareil, appliquer les permissions, envoyer une commande idempotente, relire l’état et annoncer uniquement ce qui est réellement prouvé.

## État de départ et limites réelles

- Les lumières et interrupteurs de Nasro sont déjà visibles et contrôlables dans l’application Google Home.
- Le Huawei Android 10 reste près du PC et héberge l’application passerelle Mina.
- Les Home APIs Google sont des API Android : le connecteur Google Home s’exécute donc sur le Huawei, pas directement dans Electron.
- Être visible dans Google Home ne garantit pas qu’un appareil ou tous ses traits seront exposés par les Home APIs. Mina publie uniquement les capacités réellement retournées après consentement.
- Mina ne peut pas contrôler arbitrairement tout appareil Wi-Fi. L’appareil doit exposer Matter, Home Assistant, MQTT, une Home API Google ou une API constructeur authentifiée et validée.
- Aucun scan agressif, credential par défaut, brute force ou contournement d’authentification n’est autorisé.

## Principes non négociables

- Google Home est le premier connecteur implémenté, car les appareils y sont déjà enregistrés.
- Lorsqu’un même appareil possède une voie locale validée, Matter ou Home Assistant précède Google Home à l’exécution.
- Une commande de changement d’état emploie une valeur désirée explicite ; `toggle` est interdit dans les retries.
- Mina ne déclare jamais un appareil allumé, éteint ou réglé sans relecture d’état réussie.
- Un connecteur ou événement entrant est une donnée non fiable, jamais une instruction permettant d’appeler un outil arbitraire.
- Le visage reconnu ne vaut ni autorisation ni confirmation domotique sensible.
- Les tokens Google restent dans Android Keystore ; le PC ne les reçoit jamais.
- Les appareils et actions sensibles restent bloqués par défaut.
- Les règles natives du fournisseur sont plus restrictives lorsqu’elles interdisent une commande.

## Architecture

### Composants PC

- `SmartHomeIntentNormalizer` transforme une intention modèle en schéma strict, sans l’exécuter.
- `SmartHomeRegistry` conserve pièces, alias, capacités, risques et liaisons fournisseurs.
- `SmartHomeResolver` résout une cible ou retourne une ambiguïté explicite.
- `SmartHomePolicy` décide `allow`, `confirm` ou `deny` selon appareil, action, canal et transport.
- `SmartHomeRouter` choisit un connecteur compatible et disponible.
- `SmartHomeCommandLedger` assure idempotence, expiration, preuves et récupération.
- `SmartHomeService` orchestre résolution, policy, commande et vérification.

Ces composants ne donnent aucun accès réseau direct au modèle. Le modèle produit une intention ; le service exécute uniquement un verbe et des paramètres autorisés.

### Composants Huawei

- `GoogleHomePermissionController` initialise les Home APIs et pilote le consentement Google.
- `GoogleHomeDeviceMirror` observe structures, pièces, appareils, traits, consentements et états.
- `GoogleHomeCommandGateway` convertit les commandes Mina en appels Home APIs stricts.
- `SmartHomeTransportService` reçoit les enveloppes PC, vérifie identité, expiration, idempotence et autorisation locale.
- `AndroidSmartHomeLedger` persiste les commandes en vol et les reçus sans token ni contenu conversationnel.

L’application demande l’accès à une structure Google Home. Pour les appareils sensibles ou restreints, le consentement individuel exigé par Google reste obligatoire.

### Connecteurs futurs

- `HomeAssistantConnector` : REST pour les commandes et WebSocket pour les états.
- `MatterConnector` : contrôle local des appareils commissionnés et partagés avec Mina.
- `MqttConnector` : topics et schémas explicitement allowlistés, TLS et credentials dédiés.
- `VendorConnector` : un adaptateur par constructeur, uniquement sur API documentée et authentifiée.

La présence d’un appareil sur le LAN ne crée jamais automatiquement un connecteur.

## Contrats de données

### Intention normalisée

```text
SmartHomeIntent
  action: turn_on | turn_off | set_brightness | set_color | set_temperature | set_position | run_scene | read_state
  targetText: string
  roomText?: string
  value?: number | string | object
  sourceChannel: local_ui | voice | telegram
  sessionId: string
```

Tout autre verbe est refusé. Les valeurs numériques sont bornées par la capacité réellement annoncée par l’appareil.

### Appareil unifié

```text
SmartHomeDevice
  deviceId: string
  displayName: string
  aliases: string[]
  roomId: string
  deviceClass: string
  capabilities: CapabilityDescriptor[]
  bindings: ProviderBinding[]
  riskTier: low | medium | high | blocked
  confirmationPolicy: never | always | local_only
  enabled: boolean
```

`ProviderBinding` conserve un identifiant opaque, le connecteur, les capacités observées et la dernière santé. Les identifiants Google complets sont chiffrés au repos.

### Commande idempotente

```text
SmartHomeCommand
  commandId: UUID
  deviceId: string
  action: string
  desiredState: object
  issuedAt: timestamp
  expiresAt: timestamp
  sourceChannel: string
  confirmationRef?: string
```

Une répétition du même `commandId` retourne le reçu existant. Une commande expirée est refusée. Un retry de `turn_on` reste `turn_on` ; Mina ne le convertit jamais en `toggle`.

### Preuves

```text
requested
accepted_by_gateway
accepted_by_provider
state_confirmed
timeout
failed
```

`accepted_by_provider` signifie seulement que le connecteur a accepté l’appel. `state_confirmed` exige une observation ultérieure cohérente avec l’état demandé. Mina ne déduit jamais la réussite d’un HTTP 200, d’un accusé Android ou de l’absence d’erreur seuls.

## Appairage Google Home

1. Mina PC affiche que le consentement doit être réalisé sur le Huawei.
2. Le Huawei lance le flux Home APIs avec le compte Google choisi par Nasro.
3. Nasro sélectionne la structure et accepte les types d’appareils.
4. Les appareils sensibles demandent leur consentement individuel lorsque Google l’exige.
5. Le Huawei synchronise un inventaire minimal chiffré vers le PC par le transport Mina.
6. Nasro vérifie pièces, noms, alias et risques dans `Maison connectée`.
7. Aucun contrôle n’est actif avant cette validation locale.

L’utilisation personnelle initiale repose sur un projet OAuth de test et un compte Nasro déclaré comme utilisateur de test. Une distribution à d’autres utilisateurs exige les processus de vérification, enregistrement et publication alors disponibles chez Google ; elle est hors périmètre initial.

## Registre, pièces et alias

Le registre normalise les pièces et noms sans écraser la source Google. Les alias ajoutés par Nasro sont locaux :

```text
« lumière chambre » -> chambre / plafonnier
« lampe de ma chambre » -> chambre / plafonnier
« interrupteur couloir » -> couloir / interrupteur principal
```

La résolution utilise nom exact, alias validé, pièce et classe d’appareil. Si plusieurs appareils restent plausibles :

- un groupe explicite validé peut les recevoir tous ;
- sinon Mina demande une clarification ;
- Mina ne choisit jamais le premier résultat arbitrairement.

Une fusion entre un binding Google Home et Home Assistant/Matter exige des preuves concordantes ou une confirmation de Nasro. Deux appareils proches ne sont jamais fusionnés sur le seul nom.

## Routage

Ordre par appareil :

1. Matter local validé ;
2. Home Assistant local validé ;
3. Google Home via Huawei ;
4. API constructeur validée ;
5. indisponible.

L’ordre peut être personnalisé par appareil. Un connecteur ne reçoit que l’action et les attributs qu’il a déclarés compatibles.

`local-only` interdit les fournisseurs IA distants, mais autorise une commande domotique explicitement demandée. Le mode `offline` n’autorise que les connecteurs réellement locaux ; Google Home et les API cloud deviennent indisponibles.

## Transports PC-Huawei

Ordre :

1. USB authentifié ;
2. LAN Wi-Fi chiffré ;
3. Firebase ciphertext seulement pour une commande `low` à expiration courte ;
4. échec sûr.

Les commandes `medium`, `high` ou `blocked` ne passent jamais par Firebase. Chaque enveloppe est liée au Huawei physique appairé, chiffrée, authentifiée, dédupliquée et expirée.

Une déconnexion après envoi déclenche une réconciliation par `commandId`. Elle ne provoque pas une nouvelle action sans savoir si la première a été acceptée.

## Politique de sécurité

### Risque faible

Lumières et scènes composées uniquement d’actions faibles peuvent être autorisées sans confirmation après appairage et test supervisé.

### Risque moyen

Prises, interrupteurs, téléviseurs, volets, ventilateurs et thermostat restent `medium` tant que Nasro n’a pas décrit leur fonction. La policy demande confirmation ou applique une plage explicitement autorisée.

Un interrupteur inconnu n’est jamais considéré comme une simple lumière : il peut alimenter un chauffage, une pompe ou un appareil dangereux.

### Risque élevé ou bloqué

Serrures, garage, portail, alarme, caméras, four, plaques, chauffage puissant, chauffe-eau, vanne d’eau/gaz et autres appareils dangereux sont `blocked` par défaut.

Nasro peut activer un appareil supporté après avertissement, mais chaque commande sensible exige une confirmation locale bornée. Les restrictions Google ou constructeur restent applicables et ne sont jamais contournées.

### Scènes et automations

Une scène hérite du risque maximal de ses actions. Mina affiche toutes les actions avant de confirmer une scène moyenne ou élevée.

Un événement entrant, tel qu’un mouvement ou une porte ouverte, ne peut pas créer une automation, changer une règle, lancer un skill ou donner une instruction au modèle. Les automations sont créées depuis une interface dédiée, avec déclencheur, conditions, actions, simulation et confirmation explicites.

## Canaux

- Interface locale et voix : lecture et actions selon la policy.
- Telegram propriétaire vérifié : capacité bornée `home.read` et `home.low_risk` après activation locale.
- Telegram pour un risque moyen : brouillon et demande de confirmation locale, jamais autorisation distante implicite.
- Telegram pour risque élevé/bloqué : refus par défaut.
- SMS, email et contenu web entrant : aucune capacité domotique.

Le canal Telegram ne reçoit aucun outil PC général. Les commandes `home.*` restent une surface séparée et allowlistée.

## Page `Maison connectée`

La page contient :

- état du connecteur Google Home ;
- compte et structure sous forme non sensible ;
- statut des consentements ;
- pièces, appareils, groupes et scènes ;
- état courant et fraîcheur ;
- capacités observées ;
- alias vocaux ;
- bindings et ordre des connecteurs ;
- niveau de risque et confirmations ;
- historique des commandes et preuves ;
- diagnostic USB/LAN/Firebase ;
- test supervisé ;
- emplacements futurs Home Assistant, Matter, MQTT et API constructeur.

La page n’affiche ni token Google, ni access token Home Assistant, ni secret MQTT. Les secrets suivent le coffre défini dans la spécification des paramètres.

## Premier test réel

Nasro choisit une lumière non critique déjà visible dans Google Home.

1. lire et afficher son état ;
2. envoyer `turn_on` ;
3. attendre `state_confirmed` ;
4. envoyer `turn_off` ;
5. attendre `state_confirmed` ;
6. tester une commande répétée avec le même `commandId` ;
7. tester expiration et perte de transport ;
8. vérifier qu’aucun secret ni contenu conversationnel n’apparaît dans les logs.

Le test reste supervisé et n’utilise aucun appareil dangereux.

## Mémoire, analyses et confidentialité

Les alias, pièces et préférences validés peuvent rejoindre la mémoire structurée. Les tokens, identifiants complets, états de caméra et données sensibles en sont exclus.

La page Analyses IA mesure les jetons utilisés pour interpréter la demande. La page Maison connectée mesure séparément commandes, connecteurs, latence, confirmations, erreurs et taux de vérification. Une commande locale sans appel de modèle n’est pas comptée comme consommation IA.

Les historiques domotiques sont chiffrés. Les exports remplacent identifiants fournisseurs et adresses réseau par des identifiants opaques.

## Défaillances et reprise

- Consentement Google absent/révoqué : connecteur désactivé et réappairage proposé.
- Appareil retiré de Google Home : binding marqué absent, aucun recréation automatique.
- Trait non exposé : action retirée du registre.
- USB perdu : LAN ; Firebase seulement pour `low` ; sinon échec.
- Huawei hors ligne : connecteur Google Home indisponible, voie locale éventuelle conservée.
- Commande acceptée sans état confirmé : statut non vérifié, aucune annonce de réussite.
- État déjà désiré : succès vérifié sans commande inutile lorsque l’état est frais.
- État périmé : lecture avant décision lorsqu’elle est nécessaire à la sécurité.
- Ambiguïté de cible : clarification, aucune action.
- Commande expirée ou dupliquée : refus ou reçu existant.
- Home Assistant/Matter indisponible : Google Home si la policy et le mode réseau l’autorisent.
- Google Home indisponible en `offline` : aucune tentative cloud.

## Tests obligatoires

### Intention et résolution

- verbes autorisés et rejet des verbes inconnus ;
- valeurs bornées par capability ;
- alias, pièce, groupe et ambiguïté ;
- absence de sélection arbitraire ;
- intention modèle sans accès direct au connecteur.

### Registre et routage

- import Google sans écraser les alias locaux ;
- capacités réellement exposées seulement ;
- fusion de bindings confirmée ;
- ordre Matter, Home Assistant, Google Home, constructeur ;
- connecteur incompatible ignoré ;
- `local-only` versus `offline`.

### Google Home Huawei

- permission absente, accordée et révoquée ;
- structure vide, choisie et changée ;
- appareil sensible non consenti ;
- état et commande avec faux Home API ;
- token absent des IPC, logs et PC ;
- transport USB/LAN et identité Huawei.

### Commandes et preuves

- UUID unique, expiration et déduplication ;
- retry de `turn_on` sans `toggle` ;
- état initial déjà correct ;
- `accepted_by_provider` sans faux succès ;
- `state_confirmed`, timeout et erreur ;
- crash entre envoi et reçu avec réconciliation.

### Sécurité

- lumière faible autorisée après activation ;
- interrupteur inconnu confirmé ;
- appareil bloqué refusé ;
- scène héritant du risque maximal ;
- visage reconnu incapable de confirmer ;
- événement entrant incapable d’appeler outil/skill ;
- Firebase limité à faible risque ;
- Telegram limité à `home.read` et `home.low_risk` ;
- SMS/email/web sans capacité.

### Interface et intégration

- page sans secrets ;
- synchronisation d’état et fraîcheur ;
- modification d’alias et risque ;
- test supervisé de lumière ;
- historique et preuves ;
- export anonymisé ;
- analytics domotique séparée des tokens IA.

Les tests utilisent de faux connecteurs et une fausse Home API. Aucun appareil réel n’est actionné par la suite automatisée. Le test matériel final exige Nasro et une lumière non critique.

## Critères d’acceptation

1. Nasro consent sur le Huawei et Mina importe les appareils Home APIs réellement exposés ;
2. une lumière validée peut être lue, allumée, vérifiée, éteinte et vérifiée ;
3. un retry ne produit jamais une inversion d’état ;
4. Mina ne dit jamais « fait » sans `state_confirmed` ;
5. une cible ambiguë n’est pas actionnée ;
6. les secrets Google restent dans Android Keystore ;
7. Firebase ne transporte que des commandes faibles chiffrées et expirées ;
8. les appareils sensibles sont bloqués par défaut et les restrictions fournisseur restent intactes ;
9. Telegram n’obtient que les capacités domotiques bornées activées localement ;
10. SMS, email et contenu web ne peuvent jamais commander la maison ;
11. la page Maison connectée expose états, risques, bindings, preuves et diagnostics sans secret ;
12. tous les tests existants et nouveaux sont verts.

## Hors périmètre initial

- contrôle arbitraire de tout appareil détecté sur le Wi-Fi ;
- contournement d’un compte, PIN, consentement ou restriction Google ;
- distribution publique de l’application Home APIs ;
- serrure, garage, alarme, caméra ou appareil dangereux activé par défaut ;
- automation créée librement par un modèle ;
- accès domotique depuis SMS ou email ;
- usage de la reconnaissance faciale comme authentification ;
- promesse de contrôle hors ligne d’un appareil uniquement cloud ;
- développement ou certification d’un nouveau firmware Matter.

## Intégrations avec les autres spécifications

- L’agent, les actions et confirmations restent définis dans [Mina — agent visuel local](2026-07-14-mina-agent-design.md).
- Les transports Huawei restent définis dans [Mina — Samsung utilisateur et Huawei passerelle USB/Wi-Fi](2026-07-14-mina-multi-device-connectivity-design.md).
- Le canal propriétaire reste défini dans [Mina — canal Telegram propriétaire et identité téléphonique](2026-07-14-mina-telegram-identity-design.md).
- Les presets `local-only`/`offline`, secrets et analytics restent définis dans [Mina — moteurs locaux spécialisés, routage dynamique, voix et paramètres](2026-07-14-mina-local-model-runtime-settings-design.md).
- Le grounding des preuves reste défini dans [Mina — grounding anti-hallucination et cycle de session](2026-07-14-mina-grounding-sessions-design.md).

En cas de divergence, la policy la plus restrictive sur l’appareil, le canal, le transport ou le fournisseur prévaut.

## Références officielles

- Google Home APIs : <https://developers.home.google.com/apis>
- Home APIs Android : <https://developers.home.google.com/apis/android/overview>
- Permissions Android : <https://developers.home.google.com/apis/android/permissions>
- Appareils et métadonnées Android : <https://developers.home.google.com/apis/android/device>
- Types d’appareils Android supportés : <https://developers.home.google.com/apis/android/supported-device-types>
- Google Home et Matter : <https://developers.home.google.com/matter/overview>
- Home Assistant REST API : <https://developers.home-assistant.io/docs/api/rest/>
- Home Assistant WebSocket API : <https://developers.home-assistant.io/docs/api/websocket/>

