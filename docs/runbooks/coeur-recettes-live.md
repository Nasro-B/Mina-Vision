# Recettes live des 5 domaines CŒUR (Vague 5 / T5.1)

Ce runbook clôt la Vague 5 du plan de durcissement : prouver **en usage réel** que les cinq domaines
CŒUR (voix/conversation, missions navigateur, bureau Windows, mémoire/coffre, diagnostic/journal)
marchent à 100 %. Ce ne sont pas des tests automatisés — ce sont des constats **au clavier et au
micro**, par Nasro, devant Mina. Voir la discipline dans [../operations/PERIMETRE-CERCLES.md](../operations/PERIMETRE-CERCLES.md).

**Mode d'emploi** : lancer Mina (`npm start`), initialiser/déverrouiller la mémoire si demandé, puis
dérouler chaque recette. Cocher `pass`/`fail`, dater, noter tout écart. Un `fail` = à corriger avant
de déclarer le domaine « à 100 % live ». Quand les 5 sont `pass` datés, reporter le résultat dans le
CHANGELOG (« Livré — recettes cœur »).

> Aucune étape n'est dangereuse. Rien ici ne touche serrure, paiement, four ou alarme. L'arrêt
> d'urgence `Ctrl + Alt + Échap` (ou « Mina, arrête ») coupe tout à tout moment.

---

## 1. Voix / conversation

**But** : parler à Mina, elle répond ; on peut la couper, la mettre en pause, et une commande directe
lance une action sans avoir à redire « Mina » (décision du 2026-07-29).

| # | Étape | Résultat attendu |
|---|---|---|
| 1.1 | Activer **Live Stream**, dire « Bonjour Mina » | Elle répond, chaleureuse, t'appelle **« Patron »** (jamais « mon créateur ») |
| 1.2 | Poser une question libre (« quelle heure il est ? ») | Réponse vocale brève, pas de mission lancée |
| 1.3 | Pendant qu'elle parle, dire « **stop** » | Elle se coupe net, sa fin de phrase n'est pas rejouée |
| 1.4 | Dire « mets-toi en **pause** » puis parler | Silence total ; elle ignore tout jusqu'à « Mina » |
| 1.5 | Dire « **Mina** » pour reprendre | « Je suis là, Patron. » |
| 1.6 | Demander « **qui t'a créé ?** » | Réponse fixe : créée par **Nasro Berkoun** |
| 1.7 | Demander « **que sais-tu faire ?** » | Elle énonce ses capacités RÉELLES **jusqu'au bout**, sans sauter à une clôture (« voilà ») ; tu peux l'interrompre à tout moment |
| 1.8 | Dire « **ouvre youtube** » (sans re-préfixer « Mina ») | La mission navigateur part (enchaîne sur la recette 2) |

**Résultat** : ⬜ pass ⬜ fail — Date : ____________ — Notes : ________________________________

---

## 2. Missions navigateur (Computer Use)

**But** : piloter Chrome à la voix — naviguer, chercher, cliquer, extraire — et enchaîner sur une page
ouverte sans relancer une recherche à chaque phrase.

| # | Étape | Résultat attendu |
|---|---|---|
| 2.1 | « ouvre youtube et cherche une recette de couscous » | Le navigateur s'ouvre, va sur YouTube, lance la recherche |
| 2.2 | « mets la première » | Elle pilote la page ouverte (pas une nouvelle recherche) |
| 2.3 | « mets sur pause », « chanson suivante » | Actions sur la même page, enchaînées |
| 2.4 | Lancer une 2ᵉ instruction pendant que la 1ʳᵉ tourne | Pas de 2ᵉ mission concurrente — transmise à la mission en cours |
| 2.5 | Dire « Mina, arrête » | La mission s'arrête, rien ne redémarre seul |

**Résultat** : ⬜ pass ⬜ fail — Date : ____________ — Notes : ________________________________

---

## 3. Bureau Windows

**But** : ouvrir et piloter n'importe quelle application Windows (souris, clavier, raccourcis).

| # | Étape | Résultat attendu |
|---|---|---|
| 3.1 | « ouvre le bloc-notes » (ou une app installée) | L'application s'ouvre réellement |
| 3.2 | « écris "bonjour Patron" dedans » | Le texte est saisi dans l'app |
| 3.3 | Vérifier qu'une app bloquée (gestionnaire de mots de passe, terminal) est refusée | Refus explicite au niveau du code, pas d'action |

**Résultat** : ⬜ pass ⬜ fail — Date : ____________ — Notes : ________________________________

---

## 4. Mémoire / coffre chiffré

**But** : le coffre s'initialise, donne une phrase de récupération une seule fois, se verrouille et se
déverrouille, et la recherche retrouve un souvenir.

| # | Étape | Résultat attendu |
|---|---|---|
| 4.1 | **Config → Mémoire → Initialiser** (si pas déjà fait) | État « Déverrouillée » ; **phrase de récupération affichée UNE fois** — la noter hors du PC |
| 4.2 | Dire/écrire un fait à retenir (« retiens que mon vol est le 12 ») | Mémorisé avec sa source et sa date |
| 4.3 | **Verrouiller** la mémoire | État « Verrouillée » ; la recherche ne rend plus rien |
| 4.4 | **Déverrouiller** (avec la phrase si demandé) | État « Déverrouillée » |
| 4.5 | Chercher le fait de 4.2 | Retrouvé, avec sa provenance |
| 4.6 | Redémarrer Mina | La mémoire se **déverrouille automatiquement** (DPAPI), le fait est toujours là |

**Résultat** : ⬜ pass ⬜ fail — Date : ____________ — Notes : ________________________________

---

## 5. Diagnostic / journal

**But** : toute erreur réelle est consignée, expliquée en français avec un remède concret — jamais un
code brut ni un état inventé.

| # | Étape | Résultat attendu |
|---|---|---|
| 5.1 | Provoquer une erreur bénigne (ex. « détecte le téléphone » sans téléphone branché) | L'échec apparaît dans **Diag** |
| 5.2 | Ouvrir l'onglet **Diag** | L'erreur est expliquée + un **remède concret** proposé (pas un code brut) |
| 5.3 | Vérifier le **journal d'activité** | Les événements réels (missions, dégradations) y figurent, datés |
| 5.4 | Demander à la voix « lis mes erreurs techniques » | Mina explique les erreurs avec leur remède, pas une récitation de codes |

**Résultat** : ⬜ pass ⬜ fail — Date : ____________ — Notes : ________________________________

---

## Clôture Vague 5

Quand les **5 recettes sont `pass` datées** : reporter dans le CHANGELOG une entrée « Livré —
recettes live des 5 domaines cœur (dates) », et le **Gate V5** du plan de durcissement est franchi
(« les 5 domaines cœur prouvés en usage réel »). Tant qu'un domaine est `fail`, il n'est pas « à
100 % live » — le corriger d'abord (règle : le fini remplace le neuf, aucun nouveau domaine avant).
