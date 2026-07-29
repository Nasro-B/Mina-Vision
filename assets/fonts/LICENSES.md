# Polices d'embarquement PDF — Mina Vision

Le générateur PDF (`src/publication/pdf-generator.mjs`) rend le **français et le Latin-1**
(accents é è à ç, symbole €, etc.) avec la police standard **Helvetica** intégrée à pdf-lib — aucun
fichier requis, tout fonctionne d'office.

## Unicode complet (arabe, CJK, cyrillique…) — optionnel, drop-in

Pour que les PDF rendent aussi l'**arabe, le chinois/japonais/coréen, le cyrillique** et autres
scripts non-Latin, déposer deux fichiers TrueType ici, puis les fournir au générateur :

```
assets/fonts/NotoSans-Regular.ttf
assets/fonts/NotoSans-Bold.ttf
```

Le service de publication les embarque alors automatiquement (sous-ensemble de glyphes utilisés
seulement) via `fontkit`. **Sans ces fichiers**, un glyphe hors Helvetica est remplacé par « ? »
plutôt que de faire planter la génération — le PDF reste valide, honnêtement dégradé.

## Provenance et licence à respecter

- **Noto Sans** — Google, sous **SIL Open Font License 1.1** (OFL) : redistribuable et embarquable
  librement, y compris commercialement. Télécharger depuis <https://fonts.google.com/noto/specimen/Noto+Sans>
  ou le dépôt officiel `notofonts/latin-greek-cyrillic` + les paquets de scripts voulus
  (`Noto Sans Arabic`, `Noto Sans SC`…).
- Toute autre police déposée ici doit être **embarquable** selon sa licence (vérifier les bits
  `fsType` / la licence de la fonderie). Ne pas committer une police dont la licence interdit
  l'embarquement ou la redistribution.

> Aucun fichier `.ttf` n'est committé par défaut : c'est à l'exploitant de déposer la police voulue,
> avec sa licence, exactement comme le logo source. Ce fichier documente le contrat.
