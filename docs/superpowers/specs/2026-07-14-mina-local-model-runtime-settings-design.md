# Mina — moteurs locaux spécialisés, routage dynamique, voix et paramètres

**Statut :** design validé oralement par Nasro le 14 juillet 2026.

## Objectif

Rendre toutes les capacités cognitives principales de Mina utilisables localement avec des modèles légers et spécialisés, tout en conservant Gemini, DeepSeek, OpenRouter et les autres fournisseurs configurés. Nasro peut changer immédiatement entre priorité cloud, priorité locale et inférence exclusivement locale depuis l’interface.

La solution couvre le texte, le raisonnement, la compréhension d’écran, la planification d’actions, l’OCR, la reconnaissance et synthèse vocales, les embeddings/RAG, un catalogue Hugging Face validé, LM Studio, DeepSeek et une page de paramètres liée à `.env` et au coffre de secrets.

## Principes non négociables

- Le local reste le dernier fallback du preset `auto`.
- Nasro peut activer instantanément `local-first` ou `local-only`.
- `local-only` interdit toute inférence distante et toute transmission de contenu à un fournisseur IA.
- Une capacité indisponible en local échoue explicitement en `local-only` ; elle ne bascule jamais silencieusement vers le cloud.
- Les actions souris, clavier, navigateur et bureau restent soumises au moteur de sécurité, quelle que soit l’origine du modèle.
- Un modèle ne reçoit jamais directement un exécuteur puissant. Il produit une intention structurée contrôlée par le broker de capacités.
- Les secrets ne sont jamais enregistrés en clair dans `.env`, les logs, les rapports, la mémoire ou l’interface.
- Les modèles Hugging Face ne peuvent pas exécuter de code de dépôt.
- Un état présenté comme disponible provient d’un contrôle réel, pas de la seule présence d’une configuration.

## Modes réseau et d’inférence

### Presets de routage

`auto` choisit les fournisseurs distants configurés avant le local. `local-first` choisit les moteurs locaux avant le cloud. `local-only` n’autorise que les moteurs locaux.

Ces presets gouvernent l’inférence, l’OCR, le STT, le TTS et les embeddings. L’ordre détaillé reste configurable par capacité.

### Distinction entre `local-only` et `offline`

`local-only` signifie **inférence privée locale**. Une mission explicitement demandée peut encore utiliser Internet pour ouvrir un site, rechercher une page, envoyer un email ou communiquer par Telegram. Son contenu n’est toutefois pas transmis à un modèle distant.

Le mode diagnostic `offline` bloque toutes les sorties réseau de Mina, y compris les fournisseurs, la recherche web, l’email, Telegram, Firebase et les téléchargements. Il sert à prouver que texte, voix, OCR, vision, mémoire et RAG fonctionnent sans réseau.

L’interface montre séparément le preset d’inférence actif, l’autorisation réseau fonctionnelle et le fournisseur réellement utilisé pour chaque tour.

## Architecture

### `ProviderRegistry`

Le registre décrit Gemini, DeepSeek, OpenRouter, Modal lorsque son endpoint est configuré, LM Studio sur loopback et les moteurs locaux spécialisés Mina.

Chaque adaptateur publie seulement ses capacités réelles, ses modèles, ses limites et son état de santé. Une compatibilité d’API ne suffit pas à déclarer une capacité disponible.

### `ModelRegistry`

Le registre des modèles conserve :

- identifiant stable Mina ;
- fournisseur ou runtime ;
- capacité principale et capacités secondaires validées ;
- dépôt source, révision et fichiers ;
- licence ;
- format et quantification ;
- empreintes SHA-256 ;
- espace disque et RAM estimés ;
- contexte maximum validé ;
- état d’installation ;
- résultat du dernier contrôle et benchmark ;
- date de validation.

Les métadonnées déclarées par un dépôt sont informatives. Les capacités actives proviennent d’un test Mina réussi.

### `CapabilityRouter`

Le routeur reçoit une capacité, un niveau de confidentialité, un budget de coût, un budget de durée et le preset actif. Il produit une chaîne de candidats ordonnée et traçable.

Capacités initiales :

- `text.fast` ;
- `text.reasoning` ;
- `planning.tools` ;
- `computer.vision` ;
- `vision.general` ;
- `ocr.document` ;
- `speech.to_text` ;
- `speech.synthesis` ;
- `embedding.multilingual`.

Le routeur applique avant tout appel : politique de canal et de confidentialité, preset actif, disponibilité réellement mesurée, compatibilité de capacité, budgets, ordre personnalisé et stratégie de reprise bornée.

Chaque sélection émet un événement sans contenu privé : capacité, candidat, motif, durée, résultat et fallback éventuel.

### `LocalRuntimeSupervisor`

Le superviseur :

- détecte LM Studio sans présumer que son serveur est actif ;
- démarre les services locaux autorisés ;
- charge les modèles juste-à-temps ;
- n’autorise qu’un gros modèle résident à la fois par défaut ;
- décharge après une durée d’inactivité configurable ;
- mesure chargement, mémoire et latence ;
- retente une seule fois avec un profil plus petit en cas de mémoire insuffisante ;
- arrête proprement les runtimes à `runtime_end`.

LM Studio et les services Mina écoutent uniquement sur `127.0.0.1`. Ils n’activent ni exposition LAN, ni CORS large, ni interface publique. Les appels locaux utilisent un secret de session ou un canal local authentifié lorsqu’il est disponible.

## Routage initial recommandé

Les ordres sont des valeurs initiales modifiables, pas des constantes de code.

### Preset `auto`

- texte rapide : DeepSeek V4 Flash, puis Gemini/OpenRouter configuré, puis modèle local léger ;
- raisonnement : DeepSeek V4 Pro, puis Gemini/OpenRouter configuré, puis modèle local 5B/7B ;
- Computer Use : Gemini validé, puis planificateur vision local ;
- vision générale : fournisseur cloud validé, puis modèle vision local ;
- OCR : OCR déterministe local, modèle vision local, puis cloud ;
- STT/TTS : local par défaut, cloud uniquement si Nasro l’active pour cette capacité ;
- embeddings/RAG : local par défaut.

Dans `local-first`, les candidats locaux précèdent le cloud. Dans `local-only`, la liste est filtrée avant exécution pour ne garder que les runtimes locaux. Le verrou est appliqué dans le routeur et l’adaptateur réseau, pas dans une simple instruction au modèle.

## Computer Use local

Le fonctionnement local conserve la boucle de sécurité existante :

1. capture bornée de l’écran ou de la fenêtre ;
2. extraction déterministe disponible : DOM, arbre d’accessibilité, OCR et métadonnées ;
3. analyse par le modèle vision local si nécessaire ;
4. intention d’action structurée ;
5. normalisation et validation déterministes ;
6. classification de sécurité et confirmation éventuelle ;
7. exécution d’une seule action atomique ;
8. nouvelle observation et vérification du résultat.

Le modèle local ne peut ni envoyer des événements souris/clavier directement, ni ouvrir un terminal, ni élargir son périmètre. Les coordonnées d’une observation précédente ne sont jamais réutilisées si l’interface a changé.

Sur le matériel actuel, le Computer Use local est attendu plus lent et potentiellement moins précis que Gemini. L’interface l’indique sans présenter un modèle installé comme équivalent avant benchmark.

## Perception multimodale écran et caméra Huawei

### Sources d’observation

Mina peut combiner dans une même session :

- écran ou fenêtre du PC ;
- DOM, arbre d’accessibilité et source de la page lorsque disponibles ;
- OCR local sur captures, PDF, canvas et interfaces non structurées ;
- écran du Huawei via scrcpy ou captures ADB ;
- capteur avant ou arrière du Huawei via le bridge caméra Mina.

Chaque observation contient une source, un horodatage monotone, une dimension, une orientation, un identifiant de session et une durée de validité. Le moteur ne fusionne pas deux images comme simultanées lorsque leur décalage dépasse le seuil configuré.

### Bridge caméra Android 10

Le Huawei est sous Android 10/API 29. Le mode caméra natif de scrcpy exige Android 12 ou plus ; scrcpy reste donc le canal de miroir d’écran, pas le fournisseur fiable du capteur photo sur ce téléphone.

Une petite application Android Mina utilise CameraX, compatible API 21+, pour capturer le capteur avec permission `CAMERA` accordée explicitement. La capture fonctionne dans une activité visible ou un service au premier plan conforme, avec notification Android et voyant permanent dans Mina.

Ordre des transports vidéo :

1. tunnel USB local authentifié, établi pour le Huawei physique appairé ;
2. LAN Wi-Fi Mina chiffré et appairé ;
3. indisponible.

Firebase ne transporte jamais la vidéo, les images de visage ou les embeddings biométriques. Il peut seulement conserver un état technique chiffré non biométrique indiquant que la caméra est indisponible.

La perte USB tente le LAN sans changer d’identité physique. La perte des deux transports arrête la capture, invalide les frames et affiche l’état ; aucune ancienne image n’est réutilisée.

### Aperçu et analyse

L’aperçu utilisateur peut être fluide, mais le pipeline IA ne traite pas chaque image. `PerceptionSampler` sélectionne des frames selon :

- demande explicite ;
- changement de scène ;
- apparition ou disparition d’un visage ;
- étape de vérification d’une action ;
- fréquence maximale adaptée au modèle et aux ressources.

Ordre d’analyse : extraction structurée, OCR déterministe, détection spécialisée, puis modèle vision local ou distant selon le preset. En `local-only`, aucune frame, crop, embedding ou métadonnée biométrique ne quitte le PC.

Les frames restent en mémoire dans des buffers bornés et sont détruites après leur fenêtre d’analyse. Capture, enregistrement et ajout au RAG sont désactivés par défaut.

## Reconnaissance locale de Nasro

### Périmètre

La reconnaissance est une vérification fermée `Nasro / inconnu / incertain`, pas un système d’identification générale. Mina ne cherche ni le nom d’un tiers, ni une correspondance sur Internet, ni une identité dans les contacts.

Usages autorisés :

- saluer Nasro ;
- associer une session locale à la présence probable de Nasro ;
- adapter l’interface et le contexte non sensible ;
- signaler une présence inconnue ou une incertitude sans l’identifier.

La reconnaissance faciale n’autorise jamais à elle seule un paiement, un envoi, une suppression, l’accès à un secret, une modification de sécurité ou une confirmation sensible. Elle n’est pas une preuve d’identité suffisante pour le broker de capacités.

### Enrôlement

L’enrôlement exige une action explicite dans Paramètres et plusieurs vues guidées : face, angles modérés et conditions lumineuses différentes. Mina :

1. vérifie la qualité et détecte un seul visage ;
2. calcule localement plusieurs embeddings ;
3. propose le seuil et montre les faux rejets pendant le calibrage ;
4. demande confirmation ;
5. chiffre le profil biométrique dans un coffre séparé ;
6. détruit les images brutes par défaut.

Le modèle facial doit provenir du catalogue validé, avec licence compatible, révision et empreinte. Aucun modèle biométrique ajouté en mode avancé n’est activé sans validation spécifique.

### Matching et présence réelle

Le matcher retourne un score, le seuil utilisé, la qualité et l’état `recognized`, `unknown` ou `uncertain`. Une correspondance sous le seuil n’est jamais arrondie en succès.

Un contrôle de présence réelle utilise plusieurs frames et des signaux tels que mouvement naturel, variation de pose ou challenge ponctuel. Il réduit certains spoofings simples, mais reste un signal de risque et non une garantie absolue contre une attaque biométrique.

Une photo, un écran ou une vidéo ne doit pas produire silencieusement une autorisation. Tout doute reste `uncertain` et n’élève aucune permission.

### Activation et confidentialité

Le mode de présence peut démarrer automatiquement avec Mina uniquement après opt-in. Pendant toute capture :

- indicateur visible dans Mina ;
- notification persistante sur le Huawei ;
- interrupteur immédiat d’arrêt ;
- choix caméra avant/arrière ;
- état du transport visible ;
- aucun fonctionnement furtif.

Le profil biométrique est local, chiffré, exclu du RAG, de la mémoire conversationnelle, des exports et de Firebase. Nasro peut désactiver, supprimer ou refaire l’enrôlement. La suppression détruit les embeddings et les métadonnées biométriques associées.

## Catalogue local spécialisé

### Profils initiaux

Les modèles exacts ne sont figés qu’après benchmark sur la machine réelle.

- texte rapide : modèle instruct 3B quantifié Q4 ;
- raisonnement : modèle 5B/7B Q4 chargé à la demande ;
- vision : Qwen2.5-VL 3B ou modèle local équivalent compatible avec le runtime retenu ;
- OCR : PaddleOCR ou Tesseract, puis modèle vision local ;
- STT : Whisper Base/Small via `faster-whisper` ou `whisper.cpp` ;
- TTS : Piper ou Kokoro ONNX ;
- embeddings : modèle multilingue léger de type `multilingual-e5-small`.

Le processeur i5-9500T, les 16 Go de RAM et le GPU Intel intégré imposent le chargement à la demande. Mina ne promet pas le temps réel ni la résidence simultanée de plusieurs modèles 5B/7B sans mesure.

### Installation depuis Hugging Face

Mina propose un catalogue validé et un mode avancé acceptant un identifiant ou une URL de dépôt Hugging Face.

Le flux avancé :

1. résout le dépôt et une révision immuable ;
2. récupère licence et manifeste ;
3. refuse les formats et licences non approuvés ;
4. télécharge dans une quarantaine ;
5. calcule les empreintes ;
6. inspecte la taille et les exigences ;
7. lance un benchmark isolé et borné ;
8. demande une validation explicite ;
9. publie atomiquement le modèle dans la bibliothèque.

Formats initiaux autorisés : GGUF, SafeTensors et ONNX. `trust_remote_code`, scripts de dépôt, hooks d’installation et exécutables téléchargés sont refusés.

Le dossier de modèles est configurable. Le volume `G:` est recommandé pour les poids ; index, manifestes, politiques et secrets restent dans les emplacements Mina protégés du PC.

## Fournisseur DeepSeek

DeepSeek possède un adaptateur natif, indépendant d’OpenRouter :

- base OpenAI : `https://api.deepseek.com` ;
- base Anthropic optionnelle : `https://api.deepseek.com/anthropic` ;
- modèles proposés : `deepseek-v4-flash` et `deepseek-v4-pro` ;
- streaming, raisonnement lorsque supporté, appels d’outils structurés, annulation et erreurs normalisées ;
- budgets de coût, jetons et durée.

Les alias `deepseek-chat` et `deepseek-reasoner`, annoncés en fin de vie au 24 juillet 2026 à 15:59 UTC, ne sont pas proposés dans une nouvelle configuration. Une configuration existante reçoit un avertissement et une migration explicite ; Mina ne modifie pas silencieusement le choix de modèle.

`DEEPSEEK_API_KEY` est stockée dans le coffre de secrets. Les URL et noms de modèles, non sensibles, peuvent être représentés dans `.env`.

## Voix locale

### Interface et modes

La page principale affiche un bouton micro fixe en bas avec les états : prêt, enregistrement, transcription, réponse, lecture et erreur.

`Appuyer pour parler` est activé par défaut. `Conversation continue` est activée explicitement. Les phrases d’activation sont « Salut Mina », « Bonjour Mina » et « Mina comment ça va ».

### Pipeline

```text
microphone
  -> validation et normalisation audio locale
  -> STT local
  -> session, grounding et mémoire pertinente
  -> CapabilityRouter
  -> réponse textuelle diffusée
  -> TTS local
  -> lecture audio progressive
```

Le modèle de SWAPI sert seulement de référence conceptuelle pour le bouton, la session, la télémétrie et le pipeline. Aucun code ni couplage de fournisseur de `sourire-wix-api` n’est importé dans Mina.

Comportement :

- transcription affichée dès qu’elle est stable ;
- texte conservé si le TTS échoue ;
- annulation et interruption pendant la lecture ;
- sélection des périphériques d’entrée/sortie ;
- latences STT, raisonnement et TTS visibles ;
- français par défaut, détection multilingue optionnelle ;
- audio non conservé par défaut ;
- conservation éventuelle bornée et consentie.

Le bruit ou une fausse activation ne déclenche jamais une action sensible. La voix utilise les mêmes confirmations que l’interface texte.

## Sessions

La voix s’intègre au cycle défini par la spécification de grounding :

- `session_start` fixe identité, canal, preset, budgets, contexte court et mémoire sourcée ;
- `session_turn` conserve transcription, sélection de fournisseur, intentions, preuves, résultats et latences ;
- `session_end` produit un résumé sourcé, propose les faits durables et nettoie les données temporaires.

Une session ne transmet ni permission, ni confirmation, ni capacité temporaire à la suivante.

## Page Paramètres

### Sections

- Général et mode IA ;
- Fournisseurs cloud ;
- Modèles locaux ;
- Voix ;
- Vision et OCR ;
- Mémoire et RAG ;
- Téléphone, SMS et Telegram ;
- Email ;
- Analyses IA et budgets ;
- Permissions et sécurité ;
- Diagnostics.

### Schéma de configuration

Chaque champ déclare une clé stable, un type, une valeur par défaut, les valeurs autorisées, sa sensibilité, ses dépendances, sa possibilité de rechargement à chaud, la nécessité éventuelle d’un redémarrage et un test de disponibilité sans effet destructif.

L’interface est construite depuis ce schéma. Le renderer Electron ne lit ni n’écrit directement `.env` ou le coffre.

### `.env` non sensible

Seules les clés explicitement autorisées sont modifiables. L’écriture :

1. lit et parse la version courante ;
2. vérifie qu’elle n’a pas changé depuis l’ouverture ;
3. conserve commentaires, ordre et variables inconnues ;
4. valide le résultat complet ;
5. écrit un fichier temporaire avec droits restreints ;
6. force l’écriture sur disque ;
7. remplace atomiquement le fichier ;
8. conserve une dernière version saine bornée.

En cas d’erreur, la configuration active reste inchangée. Aucun champ libre ne permet d’injecter une nouvelle variable arbitraire.

### Coffre de secrets

Les clés API, jetons, mots de passe applicatifs et secrets OAuth sont chiffrés pour le profil Windows de Nasro via DPAPI ou le gestionnaire d’identifiants choisi par Mina.

L’interface n’affiche jamais la valeur existante. Elle montre seulement : configuré, absent, invalide ou à remplacer. Une modification remplace le secret ; une révocation le supprime après confirmation.

Les diagnostics, exports, sauvegardes `.env`, erreurs IPC et événements de mémoire sont nettoyés avant persistance.

### Rechargement dynamique

Les changements de preset, ordre des fournisseurs, modèles, voix, OCR et budgets sont rechargés sans redémarrage lorsqu’ils sont validés. Un changement qui exige un redémarrage le signale avant application et n’interrompt jamais une mission active.

Le basculement vers `local-only` est immédiat : les nouvelles requêtes distantes sont interdites et les requêtes en vol sont annulées lorsque le protocole le permet.

## Comptabilité des jetons, coûts et ressources

### Architecture

`UsageCollector` reçoit les statistiques de chaque adaptateur après une requête, y compris le dernier événement d’un stream. `PricingRegistry` conserve les tarifs versionnés. `BudgetGuard` estime et réserve le coût avant l’appel, puis remplace la réservation par le coût constaté.

Chaque événement d’usage contient :

- identifiants opaques de session, mission et appel ;
- canal et capacité ;
- preset, fournisseur et modèle réellement utilisés ;
- jetons d’entrée, de sortie, de raisonnement, de cache lu et de cache écrit ;
- coût, devise, source et version tarifaire ;
- latence totale, temps du premier jeton et tokens/seconde ;
- tentative, retry, fallback, statut et erreur normalisée ;
- pour le local : runtime, durée de chargement, pic RAM, CPU/GPU et énergie estimée.

Le registre analytique ne contient ni prompt, ni réponse, ni transcript, ni SMS, ni email, ni extrait RAG. Il référence les sessions par identifiants opaques et reste chiffré localement.

### Niveaux de preuve

Chaque mesure reçoit un statut :

- `actual` : valeur retournée directement par le fournisseur ;
- `reconciled` : valeur confirmée ultérieurement par une API de facturation ;
- `calculated` : jetons réels multipliés par un tarif versionné ;
- `estimated` : approximation avant requête ou métrique locale indirecte ;
- `unknown` : valeur que Mina ne peut pas prouver.

Ordre de confiance : coût fournisseur, réconciliation, calcul sur jetons réels, estimation tokenizer, puis inconnu. Une valeur inconnue n’est jamais convertie en zéro.

Gemini utilise `usageMetadata` après réponse et peut utiliser `countTokens` avant envoi lorsque le preset l’autorise. DeepSeek collecte entrée, sortie, raisonnement et cache hit/miss. OpenRouter collecte les jetons natifs et le coût retourné, avec réconciliation par identifiant de génération si nécessaire. Hugging Face distingue Inference Providers facturés à l’usage et Endpoints dédiés facturés selon la durée d’instance.

Aucun comptage distant préalable n’est autorisé en `local-only`. Mina utilise alors le tokenizer local du modèle ou une estimation explicitement marquée.

### Tarifs et devises

Les prix ne sont pas codés durablement dans la logique métier. Chaque entrée du registre tarifaire indique fournisseur, modèle, unités, entrée/sortie/cache/reasoning, devise, date d’effet, date de récupération, source officielle et empreinte.

Un changement crée une nouvelle version. Il ne recalcule jamais l’historique. Le coût comptable est conservé en USD ; une conversion EUR facultative conserve le taux et sa date avec l’affichage, sans modifier la valeur source.

### Coût local

Pour un modèle local, Mina affiche jetons traités, temps de chargement, temps d’inférence, tokens/seconde, pic RAM et utilisation CPU/GPU. L’énergie et le coût électrique restent `estimated` tant qu’aucun capteur compatible ne fournit une mesure réelle.

Le coût local ne doit jamais être comparé au coût API comme s’il s’agissait de deux factures équivalentes. L’interface sépare coût fournisseur et coût matériel estimé.

### Budgets et réservations

Les budgets peuvent être globaux ou limités par fournisseur, modèle, capacité, canal et période : mission, jour, semaine ou mois.

Avant un appel cloud, `BudgetGuard` réserve son coût maximal estimé à partir du contexte et de la limite de sortie. Les appels parallèles voient cette réservation, ce qui empêche un dépassement collectif du plafond. Après réponse, Mina valide le coût réel, libère l’excédent ou marque la valeur inconnue pour réconciliation.

Comportement :

1. premier seuil : notification ;
2. second seuil : fournisseur ou modèle moins cher, puis local ;
3. plafond dur : appels cloud bloqués, Mina continue localement ;
4. exception ponctuelle : confirmation explicite avec montant maximum et expiration ;
5. `local-only` : budget cloud nul par construction.

Une confirmation de dépassement n’accorde aucune autre permission et ne survit pas à la période ou à la mission visée.

## Page `Analyses IA`

La page affiche :

- cartes aujourd’hui, semaine, mois et période personnalisée ;
- courbes de jetons, coûts et requêtes ;
- répartition cloud/local ;
- tableaux par fournisseur, modèle, capacité et canal ;
- entrée, sortie, raisonnement, cache lu/écrit et économie de cache ;
- latence, temps du premier jeton, tokens/seconde, erreurs et fallbacks ;
- coût par session et mission ;
- budgets consommés, réservés et restants ;
- projection de fin de mois ;
- comparatif entre modèles ;
- détail des appels sans contenu privé.

Filtres : période, fournisseur, modèle, capacité, canal, session, résultat et niveau de preuve. Les valeurs réelles, calculées, estimées et inconnues utilisent des libellés visuels distincts.

Les exports CSV/JSON sont anonymisés et exclus du RAG par défaut. La sauvegarde Firebase du registre analytique est facultative, chiffrée côté client et soumise à la politique de mémoire. Une suppression de session retire ses détails analytiques liés ; les agrégats anonymisés ne sont conservés séparément que si Nasro l’active.

## États et diagnostics

Chaque capacité expose : disponible, modèle absent, chargement, dégradé, indisponible, authentification invalide ou mémoire insuffisante.

L’écran de diagnostic affiche versions, modèles, runtime, latences, RAM, espace disque, dernier test et raison du fallback. L’export exclut secrets, prompts privés, contenus de mémoire, audio, captures et tokens.

## Anti-hallucination et preuve

Cette architecture applique la spécification de grounding existante :

- distinguer observation, source retrouvée, inférence et incertitude ;
- rattacher les réponses RAG aux extraits et chemins sources ;
- vérifier une action UI par une nouvelle observation ;
- ne jamais déclarer un envoi, téléchargement, impression, suppression ou modification sans preuve du système cible ;
- ne jamais présenter un modèle comme disponible sur la seule base d’un fichier installé ;
- conserver le fournisseur et le modèle réellement utilisés ;
- exposer les seuils de confiance OCR, vision et STT ;
- demander une clarification lorsque plusieurs interprétations conduisent à des actions différentes.

## Défaillances et reprise

- LM Studio arrêté : démarrage contrôlé ou candidat suivant selon le preset.
- Port local occupé ou runtime non authentifié : refus et diagnostic.
- Modèle trop lourd : déchargement, puis un essai avec le profil plus petit.
- Aucun modèle local compatible en `local-only` : échec explicite.
- STT indisponible : saisie texte maintenue.
- TTS indisponible : réponse textuelle maintenue.
- OCR insuffisant : modèle vision local, puis cloud uniquement si le preset l’autorise.
- Téléchargement interrompu : reprise depuis la quarantaine et contrôle d’empreinte.
- Empreinte ou licence modifiée : modèle bloqué jusqu’à nouvelle validation.
- `.env` invalide : dernière version saine conservée.
- Coffre indisponible : fournisseurs exigeant un secret désactivés, local maintenu.
- Crash pendant un chargement : état incomplet nettoyé au prochain `runtime_start`.
- Streaming interrompu : mesures partielles conservées seulement si elles sont fournies et étiquetées.
- Coût fournisseur absent : valeur `unknown`, puis réconciliation bornée ; jamais zéro supposé.
- Tarif modifié : nouvelle version sans recalcul de l’historique.
- Réconciliation indisponible : retry avec backoff borné, puis état inconnu durable.

## Tests obligatoires

### Routage

- ordre des candidats pour chaque preset et capacité ;
- filtre fail-closed de `local-only` ;
- absence de fallback cloud silencieux ;
- annulation et budgets ;
- événement de sélection sans contenu privé ;
- distinction `local-only` et `offline`.

### Runtimes et modèles

- LM Studio absent, arrêté, prêt et port occupé ;
- chargement/déchargement juste-à-temps ;
- un gros modèle résident par défaut ;
- mémoire insuffisante et profil plus petit ;
- crash et reprise ;
- capacité déclarée seulement après test réussi.

### Caméra et reconnaissance

- scrcpy écran distinct du bridge capteur CameraX sur Android 10 ;
- permission refusée, activité arrêtée et notification obligatoire ;
- USB actif, bascule LAN et perte des deux transports ;
- rejet d’un endpoint qui ne correspond pas au Huawei appairé ;
- orientation, horodatage et expiration des frames ;
- sampling borné sous charge ;
- aucun média caméra via Firebase ;
- aucune frame persistée ou indexée par défaut ;
- enrôlement à zéro, un et plusieurs visages ;
- qualité insuffisante et angles guidés ;
- succès, inconnu, incertain et seuil limite ;
- tentative par photo ou écran et signal de présence réelle ;
- reconnaissance incapable d’autoriser une action sensible ;
- arrêt immédiat et destruction du buffer ;
- suppression complète et ré-enrôlement ;
- absence d’embedding dans logs, RAG, exports et sauvegarde Firebase.

### Hugging Face

- dépôt et révision valides ;
- licence absente ou refusée ;
- format interdit ;
- rejet de `trust_remote_code` et de scripts ;
- empreinte valide et altérée ;
- téléchargement interrompu ;
- quarantaine et publication atomique ;
- benchmark borné.

### Voix

- micro refusé ou absent ;
- enregistrement, annulation et interruption ;
- STT local, réponse et TTS local ;
- panne TTS avec texte conservé ;
- phrases d’activation et faux positifs ;
- absence de persistance audio par défaut ;
- aucune transmission audio en `local-only`.

### Paramètres et secrets

- validation de chaque type ;
- refus d’une clé inconnue ;
- préservation des commentaires et variables externes ;
- conflit de modification concurrente ;
- écriture atomique, rollback et dernière version saine ;
- permissions du fichier ;
- secret absent des fichiers, IPC, logs, exports et mémoire ;
- remplacement et révocation ;
- rechargement à chaud et redémarrage différé.

### DeepSeek

- API OpenAI compatible avec faux serveur local ;
- API Anthropic compatible avec faux serveur local ;
- streaming, outils, raisonnement, annulation et timeout ;
- authentification invalide ;
- budget coût/durée ;
- avertissement sur les anciens alias ;
- aucune clé dans les diagnostics.

### Jetons, coûts et analyses

- normalisation des usages Gemini, DeepSeek, OpenRouter, Hugging Face et local ;
- dernier événement d’usage d’un stream et stream interrompu ;
- niveaux `actual`, `reconciled`, `calculated`, `estimated` et `unknown` ;
- cache hit/miss, raisonnement et outils ;
- tarif versionné et historique non recalculé ;
- estimation avant appel sans comptage distant en `local-only` ;
- réservation atomique avec plusieurs appels parallèles ;
- seuil d’alerte, bascule économique et plafond dur ;
- exception bornée par montant, période et mission ;
- coût local séparé du coût API ;
- agrégations, filtres et projection ;
- export sans contenu privé ;
- suppression de session et sauvegarde Firebase chiffrée facultative.

### Acceptation hors ligne

Avec le réseau réellement bloqué :

1. conversation textuelle locale ;
2. micro, transcription, réponse et synthèse locales ;
3. OCR d’une image et d’un PDF ;
4. compréhension d’une application ouverte ;
5. recherche mémoire/RAG ;
6. navigation sur une page locale contrôlée avec saisie, clic et scroll ;
7. preuve qu’aucun appel distant n’a été tenté.

### Acceptation intégrée

- les trois presets sont changeables depuis Mina ;
- le fournisseur réellement utilisé est visible ;
- Computer Use local exécute et vérifie une mission non sensible ;
- une action sensible reste bloquée jusqu’à confirmation ;
- DeepSeek fonctionne avec une clé saisie dans le coffre ;
- un modèle du catalogue est téléchargé, contrôlé, benchmarké et activé ;
- redémarrer Mina restaure configuration, registre et mémoire sans restaurer de permission temporaire ;
- le rapport de diagnostic ne contient aucun secret ou contenu privé.

Les tests d’intégration distants utilisent des faux serveurs par défaut. Les appels réels à un fournisseur nécessitent une clé de test, une action manuelle et des données non sensibles.

## Critères d’acceptation

La fonctionnalité est acceptée lorsque :

1. Mina accomplit localement texte, voix, OCR, vision, embeddings et RAG sans réseau ;
2. Mina peut piloter une page locale en `local-only` via le planificateur vision local et le broker sécurisé ;
3. aucun fournisseur distant n’est joignable depuis le routeur en `local-only` ;
4. `auto` conserve le cloud configuré avant le local, tandis que `local-first` inverse cet ordre ;
5. chaque fallback et état dégradé est explicite ;
6. les modèles sont chargés à la demande dans les limites mesurées de la machine ;
7. la voix locale reste utilisable même si les fournisseurs cloud sont indisponibles ;
8. `.env` est modifié atomiquement et ne contient aucun secret ;
9. DeepSeek V4 Flash/Pro est configurable et testable depuis Mina ;
10. l’ajout Hugging Face refuse le code distant et vérifie licence, révision et empreinte ;
11. les actions sensibles conservent les confirmations existantes ;
12. la page Analyses distingue coûts réels, calculés, estimés et inconnus, et les budgets bloquent réellement un dépassement cloud ;
13. Mina fusionne écran, structure de page, OCR et frames caméra valides sans persister les images par défaut ;
14. Mina reconnaît localement le profil enrôlé de Nasro, conserve l’état incertain et ne transforme jamais le visage en autorisation sensible ;
15. toutes les suites existantes et nouvelles sont vertes.

## Hors périmètre initial

- entraînement ou fine-tuning local de modèles ;
- exécution de code provenant d’un dépôt Hugging Face ;
- exposition de LM Studio ou des runtimes sur le LAN ou Internet ;
- identification générale de tiers ou recherche faciale sur Internet ;
- usage du visage comme authentification suffisante pour une action sensible ;
- capture caméra furtive ou sauvegarde biométrique Firebase ;
- promesse de performances temps réel pour les modèles 5B/7B sur le matériel actuel ;
- parité garantie avec Gemini Computer Use sans benchmark ;
- modification automatique des paramètres du routeur, pare-feu Windows ou antivirus ;
- téléchargement silencieux de plusieurs gigaoctets ;
- migration automatique d’une clé secrète en clair sans confirmation de Nasro.

## Intégrations avec les autres spécifications

- Le broker d’actions et les confirmations restent définis dans [Mina — agent visuel local](2026-07-14-mina-agent-design.md).
- Les preuves et sessions restent définies dans [Mina — grounding anti-hallucination et cycle de session](2026-07-14-mina-grounding-sessions-design.md).
- Les embeddings et la récupération restent définis dans [Mina — mémoire locale unifiée et RAG général](2026-07-14-mina-memory-rag-design.md).
- Les règles Telegram et notes vocales restent définies dans [Mina — canal Telegram propriétaire et identité téléphonique](2026-07-14-mina-telegram-identity-design.md).
- Les frontières SMS et recherche restent définies dans [Mina — recherche locale/web, grounding, sandbox, mémoire, skills et passerelles SMS/Telegram fiables](2026-07-14-mina-research-sms-design.md).
- Les secrets email et OAuth restent définis dans [Mina — passerelle email locale multi-fournisseur](2026-07-14-mina-email-gateway-design.md).
- Les appareils Wi-Fi, Google Home, Home Assistant et Matter restent définis dans [Mina — maison connectée locale et Google Home](2026-07-14-mina-smart-home-design.md).

En cas de divergence, la politique la plus restrictive sur les secrets, les capacités ou les confirmations prévaut.

## Références officielles

- LM Studio, serveur local : <https://lmstudio.ai/docs/developer/core/server>
- LM Studio, REST et gestion des modèles : <https://lmstudio.ai/docs/developer/rest>
- LM Studio, headless et JIT : <https://lmstudio.ai/docs/developer/core/headless>
- LM Studio, paramètres serveur : <https://lmstudio.ai/docs/developer/core/server/settings>
- DeepSeek API : <https://api-docs.deepseek.com/>
- DeepSeek, mises à jour : <https://api-docs.deepseek.com/updates/>
- DeepSeek, compatibilité Anthropic : <https://api-docs.deepseek.com/guides/anthropic_api>
- DeepSeek, statistiques d’usage : <https://api-docs.deepseek.com/api/create-chat-completion>
- Gemini, comptage des jetons : <https://ai.google.dev/gemini-api/docs/tokens>
- Gemini, tarifs : <https://ai.google.dev/gemini-api/docs/pricing>
- OpenRouter, comptabilité d’usage : <https://openrouter.ai/docs/cookbook/administration/usage-accounting>
- Hugging Face Inference Providers, facturation : <https://huggingface.co/docs/inference-providers/en/pricing>
- Hugging Face Inference Endpoints, facturation : <https://huggingface.co/docs/inference-endpoints/en/pricing>
- Android CameraX, architecture et exigences : <https://developer.android.com/media/camera/camerax/architecture>
- scrcpy officiel, miroir écran et contrainte caméra Android 12+ : <https://github.com/Genymobile/scrcpy>
- Qwen2.5-VL-3B-Instruct : <https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct>
- Whisper Small : <https://huggingface.co/openai/whisper-small>
