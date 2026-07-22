# Mina — exécution multilangage sandboxée

**Statut :** exigences demandées par Nasro le 14 juillet 2026. Cette spécification complète le design Recherche + SMS et doit être relue avant le plan d’implémentation.

## Objectif

Ajouter à Mina une capacité d’exécution multilangage structurée, uniquement lorsqu’une mission demande explicitement d’exécuter du code. L’exécution se déroule dans un environnement Windows jetable, isolé du poste, borné en ressources et sans réseau par défaut.

Open Interpreter sert de référence conceptuelle pour les flux multilangages, le streaming et les sessions. Aucun fichier, import, paquet ou service du fork AGPL n’est intégré à Mina.

## Règles absolues

- Mina ne déduit jamais qu’une analyse ou une recherche autorise l’exécution de code.
- Chaque exécution exige une confirmation explicite montrant le langage, le code, les entrées, le dossier de travail, le profil de modèle, le réseau et les budgets.
- Les sources approuvées du PC sont montées en lecture seule.
- Le code écrit uniquement dans un espace jetable interne à la sandbox.
- Copier un résultat vers le PC est une seconde opération d’écriture, avec confirmation séparée.
- Le réseau, le presse-papiers, les imprimantes, le microphone, la caméra, la vGPU et les dossiers utilisateur non approuvés sont désactivés.
- Si aucun backend d’isolation réel n’est disponible, Mina bloque l’exécution. Aucun repli vers `child_process`, PowerShell, Python ou Node directement sur l’hôte n’est autorisé.
- Le sous-système SMS ne possède aucune référence vers le sandbox, ses profils ou son API.
- Un modèle ne peut ni augmenter son budget, ni activer le réseau, ni exporter un fichier.

## Architecture

Le domaine est séparé derrière les modules suivants :

- `mina-code-request` : valide une demande structurée et refuse les champs inconnus ;
- `mina-model-profiles` : sélectionne un modèle et ses limites sans contenir de secret ;
- `mina-code-budget` : réserve puis comptabilise coût, durée, mémoire et volume de sortie ;
- `mina-sandbox-workspace` : crée et détruit le dossier jetable ;
- `mina-windows-sandbox` : génère et lance une configuration Windows Sandbox restrictive ;
- `mina-sandbox-protocol` : échange commandes, événements et résultats en JSONL ;
- `mina-session-history` : conserve l’historique borné et chiffré des sessions ;
- `mina-code-controller` : orchestre confirmation, sandbox, streaming, arrêt et export.

Le contrôleur principal de Mina appelle uniquement `mina-code-controller.run(request)`. Le contrôleur ne reçoit aucun exécuteur de souris, de navigateur, de téléphone ou de SMS.

## Demande d’exécution structurée

Une demande contient :

```text
requestId
userRequestId
language
code
workingDirectory
inputPaths[]
declaredOutputs[]
environmentNames[]
networkPolicy
timeoutMs
memoryMb
maxOutputBytes
maxWorkspaceBytes
modelProfileId
```

Contraintes :

- `language` vaut initialement `python`, `javascript` ou `powershell` ;
- `userRequestId` référence une instruction directement fournie par Nasro depuis l’interface locale ou la voix et contenant une intention d’exécuter ; un texte extrait d’une page, d’un fichier, d’un SMS ou de Telegram ne peut pas créer cette autorisation ;
- `workingDirectory` est toujours relatif à la racine jetable ;
- `inputPaths` contient uniquement des chemins explicitement sélectionnés ;
- `environmentNames` référence une liste blanche de variables non sensibles, jamais leurs valeurs dans l’historique ;
- `networkPolicy` vaut `disabled` par défaut ;
- tout chemin est canonisé avant la confirmation puis revalidé juste avant le montage ;
- le code confirmé est identifié par son empreinte SHA-256 ; toute modification invalide la confirmation.

Les scripts sont transmis comme fichiers UTF-8 dans le dossier de commande, jamais concaténés dans une ligne Shell. Les arguments sont des tableaux validés et non des chaînes interpolées.

## Backend Windows Sandbox

La machine utilise Windows 10 Pro 64 bits, dispose de 15,92 Gio de RAM et de 6 processeurs logiques. Cette édition prend en charge Windows Sandbox en principe, mais la virtualisation firmware est actuellement signalée désactivée et l’état de la fonctionnalité Windows n’a pas pu être lu sans élévation. Docker est absent et WSL2 ne contient aucune distribution.

Le backend prioritaire est donc Windows Sandbox :

- environnement neuf à chaque session ;
- `<Networking>Disable</Networking>` ;
- vGPU, audio, vidéo, presse-papiers et imprimantes désactivés ;
- mémoire définie dans le fichier `.wsb` ;
- dossier d’entrée monté en lecture seule ;
- dossier d’échange jetable monté en écriture, sans donnée utilisateur préexistante ;
- script de démarrage Mina monté en lecture seule et lancé par `LogonCommand` ;
- fermeture de la sandbox après résultat, échec, dépassement ou arrêt utilisateur.

Le prérequis impose donc à Nasro d’activer la virtualisation dans le BIOS/UEFI, puis Windows Sandbox avec les droits administrateur et de redémarrer si Windows le demande. Mina peut vérifier la disponibilité après ces opérations, mais ne modifie ni le BIOS ni les fonctionnalités Windows automatiquement.

Le seul dossier hôte accessible en écriture depuis la sandbox est un répertoire de session sous l’espace local Mina. Il est vide au départ, contient uniquement le protocole et les artefacts de sortie, puis est détruit après import ou expiration.

## Runtimes autorisés

Trois profils d’exécution initiaux sont prévus :

- `powershell` : Windows PowerShell fourni dans la sandbox ;
- `javascript` : distribution portable Node.js vérifiée et copiée dans la sandbox ;
- `python` : distribution Python embarquable vérifiée et copiée dans la sandbox.

Les distributions portables sont préparées séparément, contrôlées par SHA-256 et conservées dans un cache Mina en lecture seule. Aucun `npm install`, `pip install`, téléchargement ou gestionnaire de paquets ne s’exécute pendant une session sans réseau.

Ajouter un langage ou mettre à jour un runtime exige une modification explicite de profil, des tests et une nouvelle empreinte approuvée.

## Profils de modèles

Un profil de modèle contient uniquement :

- identifiant interne et libellé Mina ;
- fournisseur et modèle ;
- capacités déclarées : texte, vision, fonctions et contexte ;
- température et limites de jetons ;
- plafond monétaire par session et par jour ;
- durée maximale de planification ;
- stratégie de fallback autorisée.

Les clés restent dans le mécanisme de secrets existant. L’historique conserve le profil utilisé et le coût calculé, jamais la clé.

Profils initiaux :

- `mina-gemini` : planification principale avec le modèle Gemini configuré ;
- `mina-openrouter` : secours explicite si un modèle OpenRouter compatible est configuré ;
- `mina-local` : endpoint OpenAI-compatible local, désactivé tant qu’aucun endpoint n’est validé.

Un fallback de modèle ne modifie jamais les autorisations du sandbox. Une réponse de modèle invalide arrête la demande avant exécution.

La coupure réseau concerne le code exécuté dans Windows Sandbox. La planification effectuée sur l’hôte peut appeler le fournisseur indiqué par le profil après passage dans `mina-secret-guard`. La fenêtre de confirmation indique clairement `modèle cloud` ou `modèle local`, les données nécessaires transmises et le coût maximal. Choisir `mina-local` interdit tout fallback cloud implicite.

## Budgets

Valeurs par défaut :

- planification modèle : 60 secondes ;
- exécution : 120 secondes ;
- extension maximale après nouvelle confirmation : 15 minutes ;
- mémoire sandbox : 4 096 Mio, extensible à 8 192 Mio après confirmation ;
- sortie cumulée `stdout` + `stderr` : 1 Mio ;
- dossier jetable : 1 Gio et 10 000 entrées ;
- coût modèle : 0,10 USD par session et 1 USD par jour ;
- une seule session sandbox active à la fois.

Chaque profil peut réduire ces limites. Les augmenter demande une confirmation spécifique et ne peut jamais dépasser les maxima codés. Un modèle local a un coût monétaire nul mais conserve toutes les limites temporelles et matérielles.

## Sorties diffusées en temps réel

Le runner de la sandbox écrit des événements JSONL dans le dossier d’échange :

```text
session_started
stdout
stderr
progress
artifact
budget
completed
failed
cancelled
```

Chaque événement porte un numéro séquentiel, un horodatage, l’identifiant de session et une taille bornée. Le processus hôte suit le fichier en lecture et transmet les événements à l’interface Electron. Les événements dupliqués ou hors séquence sont rejetés.

Le runner coupe le processus et ses descendants lorsque la durée, la sortie ou le volume de fichiers dépasse la limite. Les sorties binaires ne sont jamais injectées dans le flux ; elles deviennent des artefacts identifiés par chemin relatif, type, taille et empreinte.

## Historique de session

L’historique local conserve :

- objectif et demande structurée ;
- profil de modèle et runtime ;
- empreinte du code confirmé ;
- confirmations, budgets prévus et consommés ;
- états, erreurs et résultat final ;
- sortie textuelle bornée et nettoyée ;
- liste des artefacts avec empreinte ;
- action d’export ou de suppression.

Le contenu est chiffré au repos avec une clé protégée par DPAPI. Les secrets détectés dans les sorties sont masqués dans l’affichage et les journaux techniques. L’historique rejoint la mémoire locale unifiée et suit sa conservation sans expiration jusqu’à une commande d’oubli ; il ne devient jamais accessible au domaine SMS. Le design de chiffrement, de transmission et d’oubli est défini dans [Mina — mémoire locale unifiée et RAG général](2026-07-14-mina-memory-rag-design.md).

Une session reprise ne relance jamais automatiquement le code précédent. Elle recharge uniquement l’historique et exige une nouvelle confirmation, même si l’empreinte est identique.

## Écriture et export

La confirmation d’exécution autorise les écritures uniquement dans le dossier jetable. Elle n’autorise aucune modification du dossier source monté en lecture seule.

À la fin, Mina présente chaque artefact : nom relatif, type détecté, taille et SHA-256. Nasro choisit explicitement :

- ignorer et supprimer ;
- visualiser dans un lecteur sûr ;
- exporter vers un chemin sélectionné ;
- remplacer un fichier existant avec une confirmation supplémentaire.

Un artefact exporté n’est jamais exécuté, ouvert avec macros actives ou lancé automatiquement.

## Réseau

Le réseau est physiquement désactivé dans la configuration Windows Sandbox par défaut. Une instruction dans le code ne peut pas le réactiver.

Une future session réseau doit constituer un mode distinct, avec une nouvelle confirmation indiquant la justification, les domaines autorisés, la durée et les données transmissibles. Ce mode n’appartient pas à la première implémentation et ne doit pas être simulé par un proxy ouvert.

## Isolation vis-à-vis des SMS

Le domaine SMS ne peut produire que des commandes `draft`, `confirm_reply`, `send_reply` ou `discard`. Les schémas IPC et les imports interdisent `run_code`, `open_sandbox`, `select_model_profile` et `export_artifact`. Le domaine Telegram est soumis à la même interdiction d’exécution et d’export. Toute session interrompue suit la récupération sans rejeu définie dans [Mina — grounding anti-hallucination et cycle de session](2026-07-14-mina-grounding-sessions-design.md).

Les tests d’architecture échouent si un fichier des domaines SMS ou Telegram importe `mina-code-controller`, `mina-code-request`, un runtime ou un exécuteur système. Une phrase reçue par SMS ou Telegram contenant du code reste du texte non fiable.

## Défaillances

- Windows Sandbox absent ou désactivé : blocage fail-closed avec instruction manuelle, sans élévation automatique.
- handshake non reçu : fermeture de la sandbox et session `failed`.
- runtime absent ou empreinte invalide : aucune exécution.
- timeout : arrêt de l’arbre de processus et état `budget_exceeded`.
- sortie excessive : flux tronqué, arrêt du processus et diagnostic.
- mémoire ou disque dépassé : arrêt et aucun export automatique.
- chemin sortant de la racine : rejet avant confirmation.
- modification du code après confirmation : rejet par empreinte.
- perte de l’interface Electron : arrêt de la session, jamais poursuite autonome.
- historique illisible : exécution bloquée jusqu’à réparation ou nouvelle base explicitement confirmée.

## Tests obligatoires

- validation stricte du schéma de demande et rejet des champs inconnus ;
- empreinte du code et invalidation d’une confirmation périmée ;
- canonicalisation des chemins, jonctions et liens ;
- montage source réellement en lecture seule ;
- absence d’accès aux dossiers hôte non mappés ;
- réseau, presse-papiers, caméra, micro et imprimante désactivés ;
- Python, JavaScript et PowerShell avec scripts déterministes ;
- streaming ordonné de `stdout`, `stderr`, progression et résultat ;
- arrêt de l’arbre de processus à chaque dépassement ;
- plafonds de coût, durée, mémoire, sortie et espace de travail ;
- fallback de modèle sans changement d’autorisation ;
- historique chiffré, masquage des secrets et rétention ;
- double confirmation exécution puis export ;
- refus de remplacement sans confirmation supplémentaire ;
- test d’architecture prouvant l’absence d’accès depuis les SMS ;
- test d’intégration dans Windows Sandbox avec réseau coupé ;
- fermeture de la sandbox et suppression des données jetables.

La suite existante doit être verte avant toute modification et après chaque tranche. Les tests unitaires utilisent un backend factice. Les tests Windows Sandbox ne sont exécutés qu’après activation manuelle de la fonctionnalité par Nasro.

## Critères d’acceptation

La capacité est prête lorsque Mina peut, après une demande et une confirmation explicites :

1. lancer un script Python, JavaScript ou PowerShell dans une sandbox neuve ;
2. afficher ses sorties progressivement ;
3. arrêter effectivement une boucle infinie au budget ;
4. prouver que le réseau et les dossiers non mappés sont inaccessibles ;
5. conserver l’historique, le profil et les coûts sans secret ;
6. présenter les artefacts puis demander une seconde confirmation avant export ;
7. supprimer l’environnement après la session ;
8. refuser toute demande provenant du domaine SMS ;
9. ne jamais exécuter sur l’hôte lorsque Windows Sandbox est indisponible.

## Hors périmètre initial

- exécution automatique pendant une recherche ;
- accès réseau depuis la sandbox ;
- installation dynamique de paquets ;
- exécution de binaire fourni par un SMS ou une page web ;
- accès au profil Chrome, aux clés, au presse-papiers ou aux imprimantes ;
- sessions parallèles ;
- import direct d’Open Interpreter ou de son fork ;
- backend Docker ou WSL tant qu’ils ne sont pas installés et conçus séparément.
