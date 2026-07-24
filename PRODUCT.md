# Product

## Register

product

## Users

**Utilisateur principal — Nasro** : développeur, propriétaire et créateur de Mina Vision, à la fois l'utilisateur ET le créateur du produit. Utilise le tableau de bord depuis son poste de travail (bureau, écran desktop, souris/clavier), en complément d'une interaction principalement vocale avec l'agent. Contexte d'usage : sessions longues en arrière-plan (le panneau reste ouvert pendant que Mina exécute des missions, écoute, ou attend), avec des pics d'attention ponctuels pour vérifier un statut, lancer une mission manuellement, ou diagnostiquer un problème.

**Utilisateurs additionnels** (depuis la publication publique du 2026-07-24 : dépôt open-source + APK compagnon) : d'autres personnes peuvent installer et personnaliser Mina — la fenêtre de bienvenue et les profils multi-utilisateurs (nom, pronoms, langue, ton, thème) existent pour eux, chacun avec son thème et sa personnalisation. Nasro reste le propriétaire et le créateur ; les noms « Mina », « Mina Vision » et « Nasro Berkoun » restent protégés par la LICENSE.

Tâche principale sur n'importe quel écran : soit lancer/piloter une mission (voix ou texte), soit vérifier l'état réel d'un sous-système (mémoire, voix, sandbox, intégrations) pour comprendre ce qui s'est passé ou pourquoi quelque chose a échoué.

## Product Purpose

Mina Vision est un agent vocal local (Electron) qui pilote le navigateur, le bureau Windows (n'importe quelle application) et un téléphone Android sur commande, avec mémoire chiffrée, garde-fous anti-hallucination et resilience aux pannes. Elle s'auto-analyse aussi comme agent de code (indexation, tests, revue) et génère de vrais documents (PDF/Word). Le tableau de bord est la fenêtre de contrôle ET de vérité : il affiche l'état RÉEL du système (jamais un état optimiste ou inventé), permet de lancer des missions, et donne accès à tous les sous-systèmes de diagnostic (journal d'activité, erreurs techniques expliquées avec remède, mémoire, sandbox, skills, intégrations, code).

Succès = Nasro peut, en un coup d'œil, savoir si Mina est prête, ce qu'elle fait, et pourquoi une chose n'a pas marché — sans jamais avoir à deviner ou à faire confiance à une apparence trompeuse.

## Brand Personality

HUD technique calme. Précis, discret, esprit console de contrôle — jamais criard, jamais décoratif pour décorer. Le produit est construit avec une rigueur d'ingénierie extrême (tests systématiques, vérification contre la réalité, zéro simulation) ; le design doit refléter cette même honnêteté : ce qui est affiché EST vrai, rien n'est cosmétique au point de mentir sur l'état réel.

## Anti-references

- Le vert/émeraude comme couleur de marque envahissante (l'ancien design entier était teinté vert — explicitement rejeté).
- L'esthétique "hacker terminal Matrix" (texte vert sur noir).
- Le générique SaaS-cream/gradient-text/glassmorphism décoratif/eyebrows-partout — les tics visuels reconnaissables comme "fait par une IA".
- Les cartes identiques répétées à l'infini sans hiérarchie (le tableau de bord actuel empile 13 sections visuellement identiques en une seule colonne plate).

## Design Principles

1. **L'affichage reflète la vérité, jamais un état inventé** — un badge "prêt" doit correspondre à un état réellement vérifié, jamais optimiste par défaut.
2. **La mission vocale/manuelle reste toujours le foyer visuel principal** — tout le reste (configuration, mémoire, diagnostics, intégrations) est secondaire et groupable, jamais à égalité de poids visuel.
3. **Précision calme plutôt que décoration** — une console de confiance, pas un gadget. La couleur porte du sens (statut), jamais de la simple décoration.
4. **Parité jour/nuit** — les deux thèmes reçoivent le même niveau de soin ; le mode nuit n'est pas un after-thought inversé.
5. **Les animations vocales (orbe Mina, CloudZIR) sont hors-scope du système de design du tableau de bord** — leur géométrie et leurs couleurs internes sont verrouillées par des tests de régression ; seul le cadre qui les entoure suit les jetons de couleur du reste du produit.

## Accessibility & Inclusion

Sessions longues (fatigue oculaire) : contraste texte ≥4.5:1 en clair comme en sombre, jamais de gris clair "élégant" illisible. `prefers-reduced-motion` respecté (déjà en place, à préserver). Le clavier et les raccourcis globaux sont une voie d'usage réelle (pas juste accessoire) — les états de focus doivent rester visibles dans les deux thèmes.
