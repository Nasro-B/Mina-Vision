# Design

## Theme

HUD technique calme — précision, silence visuel, console de confiance. Deux thèmes de parité égale (jour/nuit), commutés par `data-theme` sur `:root`. Le mode nuit est un **graphite quasi-noir** (~5-8 % de luminosité), jamais un noir-vert ni un simple inversé du clair.

**Hors-scope explicite** : l'orbe vocal (`#voice-presence-canvas`, couleurs internes codées dans `voice-presence.mjs`) et l'animation CloudZIR (`.cloudzir-nebula-bar`, `@keyframes cloudzir-neural-*`, sa palette de 6 couleurs sélectionnables) ne font pas partie de ce système — géométrie et couleurs verrouillées par tests de régression. Seul le **cadre** qui les entoure (`.voice-presence` container, bordure, fond) suit les jetons ci-dessous.

## Color Palette

Architecture à 3 paliers par famille sémantique : `-soft` (fond teinté), la valeur nue (texte/icône/bordure), `-strong` (remplissage plein, ex. bouton).

| Jeton | Clair | Sombre | Usage |
|---|---|---|---|
| `--ink` | `#182231` | `#eef0f5` | Texte principal |
| `--muted` | `#5b6472` | `#9aa3b2` | Texte secondaire |
| `--paper` | `#f3f5f9` | `#0b0c0f` | Fond de page |
| `--panel` | `#ffffff` | `#17181d` | Fond des cartes/panneaux |
| `--line` | `#dde1ea` | `#2b2e37` | Bordures |
| `--accent` | `#4f46e5` (indigo-600) | `#818cf8` (indigo-400) | Interactif : liens, focus, bordures actives, icônes |
| `--accent-soft` | `#e0e7ff` | `rgba(129,140,248,.16)` | Fonds teintés, survols |
| `--accent-strong` | `#4338ca` (indigo-700) | `#6366f1` (indigo-500) | Remplissage plein (bouton primaire, cœur de l'iris) |
| `--accent-contrast` | `#ffffff` | `#ffffff` | Texte sur `--accent-strong` |
| `--success` | `#047857` | `#34d399` | Texte badge « prêt / opérationnel » |
| `--success-soft` | `#ecfdf5` | `rgba(52,211,153,.14)` | Fond badge succès |
| `--success-strong` | `#059669` | `#34d399` | Pastille pleine (statut prêt) |
| `--danger` | `#c33a2d` | `#ef7266` | Erreurs, urgence |
| `--danger-soft` | `#fbe2df` | `rgba(239,114,102,.16)` | Fond badge erreur |
| `--warning` | `#9a6b0a` | `#f0cd7e` | Avertissements |
| `--warning-soft` | `#fdf1d9` | `rgba(240,205,126,.12)` | Fond badge avertissement |
| `--shadow` | `0 20px 60px rgba(23,27,46,.10)` | `0 20px 60px rgba(0,0,0,.55)` | Élévation des panneaux |

**Pourquoi indigo** : personnalité « HUD technique calme », distinct des 6 teintes déjà proposées par la palette CloudZIR (émeraude/azur/violet/corail/ambre/glace) pour ne jamais laisser croire que le chrome du tableau de bord EST une septième option de l'animation.

**Vert restreint à un seul usage** : statut « prêt / opérationnel / connecté » (convention universelle succès=vert). Jamais comme couleur de marque, jamais sur de grandes surfaces.

## Typography

Inchangé (système déjà cohérent, pas de complainte) : `Bahnschrift`/`Arial Narrow` pour les titres (h1, labels de boutons), `Segoe UI Variable Text` pour le corps, `Consolas` monospace pour les métadonnées techniques (horodatages, compteurs, badges). Échelle existante conservée.

## Layout

Le tableau de bord passe d'une **colonne plate de 13 sections visuellement identiques** à une hiérarchie en zones, accessibles depuis le rail de navigation latéral :

1. **Mission** (toujours visible, poids visuel maximal) — panneau de commande + présence vocale + outils directs. Inchangé structurellement.
2. **Configuration & Mémoire** — réglages, mémoire chiffrée, analyses/coûts.
3. **Automatisation & Capacités** — skills/sandbox, automatisations, extensions.
4. **Aujourd'hui & Documents** — organisation personnelle, documents/urgence.
5. **Diagnostic** — erreurs techniques, journal d'activité.
6. **Code** (ajoutée 2026-07-22) — panneaux de l'agent Mina Code : plan, diff, tests, Git, contexte projet, journal. Mêmes jetons de couleur que le reste (aucun token neuf introduit).

Chaque zone secondaire porte un en-tête de groupe discret (`.dashboard-zone-title`) ; le style asymétrique des coins (`22px 7px 22px 7px` etc.), signature visuelle déjà en place, est conservé et étendu aux conteneurs de zone pour la cohérence.

## Motion

Inchangé : transitions d'accordéon (`grid-template-rows`), `prefers-reduced-motion` respecté. Aucune animation supplémentaire ajoutée au chrome — la personnalité HUD calme exclut la décoration gratuite.
