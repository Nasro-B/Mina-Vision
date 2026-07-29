# Recette d'acceptation — Publications Mina Vision (sans IA)

Cette recette se coche **en ouvrant réellement les fichiers produits** dans les applications cibles.
Les tests automatisés prouvent que les octets sont valides (magic bytes, structure ZIP/PDF, hash) ;
seul l'œil humain valide le rendu final. Aucune étape n'appelle un fournisseur de modèle.

## Pré-vol (automatique)

```bash
npm run test:publication
```

Attendu : toutes les suites publication + l'intégration « huit formats sans IA » vertes
(`providerCalls` vide, chaque reçu porte un SHA-256).

## Constats manuels (ouvrir les fichiers)

Sortie par défaut : `%USERPROFILE%\Documents\Mina Vision\Publications` (nom horodaté, jamais d'écrasement).

| # | Fichier | Ouvrir dans | Vérifier | pass/fail |
|---|---|---|---|---|
| 1 | `.pptx` | PowerPoint **ou** LibreOffice Impress | 16:9, slides présentes, **graphique** rendu, **image locale** visible, **notes** de l'orateur, numérotation | ⬜ |
| 2 | `.docx` | Word **ou** LibreOffice Writer | Titre/sous-titres, listes, **tableau**, image légendée, pied de page numéroté, **accents é è + € + 中文** corrects | ⬜ |
| 3 | `.xlsx` | Excel **ou** LibreOffice Calc | Feuille nommée, en-tête gras, **formule locale** calculée, filtre auto, 1re ligne gelée | ⬜ |
| 4 | `.pdf` | Adobe/Chrome/Aperçu | Pagination réelle (>1 page si long), **tableau jamais coupé**, image, en-tête/pied « Mina Vision · date · n/N », **accents FR + €** nets | ⬜ |
| 5 | `.md` / `.html` / `.csv` / `.json` | Éditeur / navigateur / tableur | MD titres+tableau ; **HTML** sans `<script>` ni URL distante ; **CSV** délimiteur `;`, BOM, cellule `=…` neutralisée ; JSON = requête normalisée | ⬜ |
| 6 | Unicode PDF complet (optionnel) | — | Déposer `assets/fonts/NotoSans-Regular.ttf` + `-Bold.ttf` (voir `assets/fonts/LICENSES.md`) → l'arabe/CJK rend dans le PDF (sinon « ? », honnête) | ⬜ |
| 7 | Conversion Office → PDF (optionnel) | LibreOffice installé | `soffice` détecté → `.docx`→`.pdf` réussit ; **LibreOffice absent → échec explicite**, jamais un PDF vide | ⬜ |

## Sécurité à constater

- Aucune connexion réseau pendant une génération « sans IA » (couper le Wi-Fi : tout marche pareil).
- Une écriture hors du dossier Publications demande la **confirmation locale** existante.
- Un asset image passe par la **provenance** (magic bytes) : un `.exe` renommé `.jpg` est refusé.

**Résultat global** : ⬜ pass ⬜ fail — Date : ____________ — Notes : ______________________________
