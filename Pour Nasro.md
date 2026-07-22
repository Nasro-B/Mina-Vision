# Pour Nasro — actions en attente (Mina Vision)

> Uniquement des items actionnables côté Nasro. Retirer chaque item une fois traité.
> Créé le 2026-07-22 par la vague de réconciliation (R-20 : le CHANGELOG référençait ce fichier
> qui n'existait pas dans le projet).

## À faire maintenant

- [ ] **Relancer Mina** (`Lancer Mina.cmd`) : la vague de réconciliation (broker autorité,
      journal chiffré, anti-SSRF, racines resserrées, arrêt d'urgence transversal) prend effet
      au prochain démarrage.
- [ ] **Vérifier à l'usage** : une mission ordinaire ne doit PAS demander plus de confirmations
      qu'avant (seules les actions sensibles — suppression, envoi, achat, impression — en
      demandent, désormais liées à l'action exacte). Si un dialogue apparaît sur un simple clic,
      me le dire : c'est un bug de calibrage, pas le comportement voulu.

## Décisions en attente

- [ ] **Racines de lecture** : Mina ne lit plus librement que `C:\Serveurs\Mina Vision` et
      `Documents\Mina Vision` — tout autre dossier demande une confirmation par fichier. Pour
      des dossiers de confiance permanents (ex. `G:\Docs`), poser la variable d'environnement
      `MINA_APPROVED_READ_ROOTS` (chemins séparés par `;`).
- [ ] **Anciens transcripts en clair** : les journaux `logs/activity-*.jsonl` antérieurs à
      aujourd'hui contiennent encore du texte en clair ; la purge automatique (rétention 7
      jours) les efface d'elle-même d'ici au 2026-07-29. Purge immédiate possible sur demande.
- [ ] **mythos.skill** : le clic final d'installation dans le panneau Skills t'appartient
      (staging + audit déjà faits).
- [ ] **MCP Mina ↔ Claude** (pont de test) : design prêt, en attente de ton « vas-y ».
- [ ] **5 outils vocaux** issus de l'analyse d'écart (chercher_souvenirs, briefing_du_jour,
      piloter_maison, combien_ca_coute/sante_technique, imprimer_document) : en attente de ton
      « vas-y ».
- [ ] **Suite du plan de réconciliation** (Tasks 8-16, 19, 21-24 : catalogue branché partout,
      centralisation IPC, composition des domaines, maison réelle, biométrie locale, backup
      Firebase, extraction main.mjs, profils navigateur, accessibilité, gate de release formel,
      matrice de vérité docs) : dire si on lance une vague 2.
- [ ] **Idées des extensions VS Code** (validées comme bonnes idées, pas encore implémentées) :
      LM Studio comme provider texte 100 % local dans la chaîne de fallback ; accept/reject par
      hunk dans le panneau diff ; mode « réseau coupé » par mission code ; profils de rôle
      (architecte/testeur/revieweur). Dire lesquelles tu veux.

## À garder en tête (pas d'action immédiate)

- **espeak-ng est GPL-3.0** : aucune obligation tant que Mina Vision reste privée. **Avant toute
  distribution** (installeur, autre machine, tiers) : relire `docs/LICENCES.md` §1.
- **Dépôt git local** : le projet est versionné depuis le 2026-07-22 (1 commit par tâche).
  Aucun remote configuré — un `git push` est impossible par construction. Revenir en arrière
  sur une tâche = me demander, je fais le revert proprement.
