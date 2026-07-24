# Mina Vision

**Agent vocal local qui pilote votre ordinateur.** Mina écoute, regarde l'écran, et agit : elle
contrôle le navigateur, n'importe quelle application Windows, et un téléphone Android connecté
en ADB. Tout tourne sur votre machine — mémoire chiffrée locale, modèles au choix, aucune
dépendance à un service central.

> Créé par **Nasro Berkoun**. Voir [LICENSE](LICENSE) : usage, étude et modification
> libres ; le nom du produit et celui de son créateur sont protégés.

---

## Ce que Mina fait réellement

| Domaine | Capacité |
|---|---|
| **Voix** | Conversation temps réel, interruption immédiate (« stop »), mode pause, repli vocal local |
| **Navigateur** | Missions pilotées à la voix : naviguer, chercher, cliquer, saisir, extraire |
| **Bureau Windows** | Ouvre et pilote n'importe quelle application (souris, clavier, raccourcis) |
| **Téléphone Android** | Caméra, SMS, commandes via ADB (USB ou Wi-Fi) |
| **Mémoire** | Coffre chiffré local (argon2 + AEAD), recherche sémantique, phrase de récupération |
| **Code** | Indexe et analyse son propre code : recherche, graphe d'appels, tests, revue de sécurité |
| **Documents** | Génère de vrais PDF et Word ; met en quarantaine les documents reçus |
| **Diagnostic** | Journal d'activité, erreurs techniques expliquées avec un remède concret |

Un principe traverse tout le projet : **l'affichage dit la vérité**. Un domaine qui ne marche
pas s'affiche « indisponible » avec la dépendance exacte qui manque — jamais un état optimiste,
jamais une réponse inventée.

## Sécurité par construction

- **Autorité unique des actions** : aucune action sur la machine n'est exécutée sans une
  autorisation de session bornée dans le temps. Une action sensible exige une confirmation liée
  cryptographiquement à l'action exacte, consommable une seule fois.
- **Interdits durs** : gestionnaires de mots de passe, terminaux et outils de sécurité sont
  refusés au niveau du code, quelle que soit la demande.
- **Contenus externes non fiables** : un e-mail, une page web ou un message ne peut jamais
  accorder une permission ni déclencher un outil.
- **Journal confidentiel** : aucun texte de conversation n'est écrit en clair sur le disque ;
  le contenu intégral est chiffré avec une clé dérivée du coffre.
- **Anti-SSRF** : adresses privées, loopback et métadonnées cloud refusées en recherche web.
- **Arrêt d'urgence** transversal : `Ctrl + Alt + Échap` coupe voix, missions et actions.

## Prérequis

- **Windows 10/11**
- **Node.js 22**
- Facultatif : **ADB** pour le téléphone, **Windows Sandbox** pour l'exécution isolée,
  **LM Studio** pour des modèles 100 % locaux

## Installation

```bash
npm install
```

```bash
cp .env.example .env
```

Renseignez dans `.env` au moins une clé de fournisseur IA (Gemini, OpenRouter, DeepSeek…), puis
confirmez que ces clés sont bien les vôtres et n'ont jamais été partagées :

```env
MINA_KEYS_ROTATED=true
```

Sans ce marqueur, l'interface démarre mais les fournisseurs IA restent volontairement bloqués.

## Lancer

```bash
npm start
```

Au premier démarrage : **Config → Mémoire → Initialiser**, et **notez la phrase de récupération
affichée une seule fois** — c'est le seul moyen de rouvrir le coffre si le chiffrement Windows
change (migration de profil, réinstallation).

Pour démarrer Mina automatiquement avec Windows : **Config → Système Windows**.

Arrêt global : `Ctrl + Alt + Échap` ou le bouton **Arrêt d'urgence**.

## Configuration avancée

Toutes les données vivent par défaut sous le dossier utilisateur de l'application. Pour déporter
les caches lourds sur un autre disque :

| Variable | Effet |
|---|---|
| `MINA_CACHE_ROOT` | Racine commune de tous les caches |
| `MINA_MODELS_ROOT` | Modèles locaux (voix, embeddings) |
| `MINA_SANDBOX_ROOT` | Espace de travail du bac à sable |
| `MINA_TRUSTED_WRITE_ROOTS` | Dossiers supplémentaires où écrire sans confirmation (séparés par `;`) |
| `MINA_APPROVED_READ_ROOTS` | Dossiers supplémentaires lisibles sans confirmation |
| `MINA_SAMSUNG_ADB_SERIAL` | Second téléphone connecté en Wi-Fi |

## Voix — l'essentiel

Activez **Live Stream**, puis parlez :

- « Mina, ouvre YouTube et cherche une recette »
- **Couper sa parole** : « stop », « chut », « tais-toi », « silence »
- **Silence total** : « mets-toi en pause » → elle ignore tout jusqu'à ce que vous disiez « Mina »
- **Tout arrêter** : « Mina, arrête »

Mina comprend des formulations qui ne figurent nulle part dans cette liste : la compréhension
est dynamique, pas un lexique figé. Pendant qu'une mission tourne, une nouvelle instruction ne
lance jamais une seconde mission concurrente — elle est transmise à la mission en cours.

## Téléphone Android

1. Activez les options développeur sur le téléphone.
2. **Wi-Fi (Android 11+)** : activez le *débogage sans fil* — Mina le détecte alors sans câble
   via mDNS et s'y connecte. **USB** : branchez, déverrouillez et acceptez l'empreinte RSA ADB.
   *(Android 10 comme le Huawei : une première activation du débogage Wi-Fi via USB reste
   nécessaire — la plateforme ne l'expose pas autrement.)*
3. Dans Mina : **Détecter le téléphone** (cherche USB **et** Wi-Fi), puis **Ouvrir la caméra**.

Un second appareil peut rester connecté en Wi-Fi (`MINA_SAMSUNG_ADB_SERIAL`). Mina retrouve sa
dernière adresse connue si l'annonce réseau reste muette, toujours avec vérification d'identité
avant reconnexion.

## Application Mina sur téléphone

Une application Android (`android/`) permet de converser avec Mina depuis un téléphone appairé,
en chiffrement de bout en bout.

```bash
cd android && ./gradlew assembleDebug
```

**Appairage.** Sur le PC : onglet *Configuration & mémoire* › *Système Windows* › **Ouvrir
l'appairage** — un code à 6 chiffres s'affiche, valable 5 minutes et une seule fois. Sur le
téléphone : saisir l'adresse du PC et ce code.

**Ce que le protocole garantit.**

- Le téléphone ne stocke que du **texte chiffré** ; le clair n'existe qu'en mémoire vive.
- La clé de conversation est livrée enveloppée par une clé dérivée en **ECDH P-256** : aucun
  secret ne transite à l'appairage, et un observateur du réseau ne peut pas la reconstituer.
- Chaque message est **signé** ; la signature est vérifiée **avant** tout déchiffrement.
- Les clés de conversation dérivent du coffre de la mémoire : **mémoire verrouillée, canal
  fermé**, annoncé comme tel plutôt que silencieusement inerte.
- **PC éteint** : le message reste dans une file durable sur le téléphone et part au retour du
  PC. Rien n'est perdu, et aucun substitut ne répond à la place de Mina.
- Un message livré deux fois (retransmission) ne produit qu'**une seule** réponse.
- **Révoquer** un appareil ouvre une nouvelle époque de clé : il ne lit plus les messages
  suivants (on ne prétend pas effacer ce qu'il a déjà lu).

**Deux chemins, une seule réponse.** Le chemin normal est le lien direct sur le réseau local.
Quand le téléphone n'est pas sur ce réseau (4G, Wi-Fi étranger), le message passe par un relais
Firestore. Le relais transporte **exactement la même enveloppe chiffrée et signée** : Firebase ne
voit jamais de clair et ne peut rien injecter, puisque la signature est vérifiée avant tout
déchiffrement. Un message arrivé par les deux chemins ne reçoit qu'**une** réponse — les deux
partagent le même registre d'événements traités.

Le relais est optionnel : sans `google-services.json`, le canal reste strictement local et
l'onglet Système l'annonce, au lieu de laisser croire à un secours inexistant. Les règles
Firestore publiées sont dans [`firebase/firestore.rules`](firebase/firestore.rules) — elles
limitent l'abus (forme, taille, append-only) mais ne **sont pas** la sécurité du canal, qui tient
au chiffrement et à la signature.

Réglages : `MINA_CHAT_PORT` (8771 par défaut), `MINA_CHAT_HOST` (`0.0.0.0`),
`MINA_GOOGLE_SERVICES` (chemin du `google-services.json`, sinon `env/google-services.json`).

## Tests

```bash
npm test
```

Exécute la suite unitaire **puis** les tests d'intégration — « vert » ne peut pas mentir par
omission. Boucle rapide pendant le développement :

```bash
npm run test:unit
```

## Documentation

| Ressource | Contenu |
|---|---|
| Guide intégré (bouton ⚙️ dans l'app) | Capacités, commandes vocales, limites |
| [CHANGELOG.md](CHANGELOG.md) | Ce qui est livré et prouvé, ce qui est planifié |
| [MINA.md](MINA.md) | Constitution : règles de sécurité et canaux autorisés |
| [docs/operations/INSTALLATION.md](docs/operations/INSTALLATION.md) | Installation pas à pas |
| [docs/guides/httpsms.md](docs/guides/httpsms.md) | Passerelle SMS httpSMS (cloud ou auto-hébergé) |
| [docs/guides/lm-studio.md](docs/guides/lm-studio.md) | Modèles locaux (texte, vision, embeddings) via LM Studio |
| [docs/operations/TELEGRAM.md](docs/operations/TELEGRAM.md) | Canal Telegram (conversation et commandes) |
| [docs/operations/FIREBASE.md](docs/operations/FIREBASE.md) | Sauvegarde chiffrée et relais Firebase |
| [docs/operations/ANDROID-HUAWEI.md](docs/operations/ANDROID-HUAWEI.md) | Téléphone Android : appairage, caméra, SMS |
| [docs/operations/RECOVERY.md](docs/operations/RECOVERY.md) | Récupération du coffre mémoire |
| [docs/operations/SECURITY.md](docs/operations/SECURITY.md) | Modèle de sécurité et invariants |
| [LICENCES.md](LICENCES.md) | Licences des dépendances et décisions |
| [docs/operations/AUDIT-PRE-PUBLICATION.md](docs/operations/AUDIT-PRE-PUBLICATION.md) | Audit de confidentialité du dépôt |

## État du projet

Mina Vision est un projet réel, utilisé quotidiennement par son auteur, avec une suite de tests
étendue et un principe de vérification systématique contre la réalité. Certains domaines sont
livrés et prouvés, d'autres sont volontairement publiés comme « indisponibles » tant qu'une
dépendance manque — **Config → Capacités** affiche l'état exact de chacun.

Le profil Chrome de Mina est séparé du profil personnel. Les captures d'écran restent en
mémoire ; les applications sensibles sont bloquées, y compris au lancement.

## Contribuer

Les contributions sont bienvenues. Deux règles non négociables issues de la licence : le nom du
projet et celui de son créateur restent intacts, et aucune contribution ne doit affaiblir les
garde-fous de sécurité décrits plus haut.

## Licence

Licence source disponible — voir [LICENSE](LICENSE). Usage, étude, modification et
redistribution autorisés ; **les noms « Mina », « Mina Vision » et « Nasro Berkoun » sont
protégés** et ne peuvent être retirés, remplacés ni détournés. Une œuvre dérivée publiée doit
porter un nom distinct et créditer « Basé sur Mina Vision, créé par Nasro Berkoun ».

Réclamations et service client : mina.vision.ai@gmail.com
