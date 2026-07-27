> [🇬🇧 English](TELEGRAM.md) · 🇫🇷 **Français**

# Telegram — Mina Vision

## Ce que Telegram n'est pas

- **Pas E2EE.** Un bot Telegram voit le contenu en clair côté infrastructure Telegram avant qu'il n'atteigne le téléphone. Ne jamais y faire transiter un secret que Mina elle-même redacterait autrement (voir `src/security/redactor.mjs`).
- **Pas d'accusé de lecture fiable.** L'API Bot confirme la livraison à Telegram, jamais la lecture par l'utilisateur. Mina n'affirme jamais « lu », seulement « envoyé »/« livré ».
- **Pas une autorisation PC.** Le seul fait qu'un message arrive via Telegram n'accorde par lui-même aucune capacité — voir la politique de canal ci-dessous.

## Provisionnement du token

1. Créer le bot via `@BotFather` (commande `/newbot`), noter le token affiché **une seule fois**.
2. Ne jamais coller le token dans un fichier de ce dépôt, un test ou une capture d'écran partagée.
3. Le token est saisi depuis l'écran local Mina Vision et stocké chiffré dans Android Keystore côté téléphone (jamais dans Gradle, jamais en variable d'environnement PC persistante) — voir `docs/operations/ANDROID-HUAWEI.md`.
4. Rotation : révoquer via `@BotFather` (`/revoke`) puis reposer le nouveau token par le même écran. Aucune capacité n'est perdue pour les automatisations déjà actives — seule l'identité de transport change.

## Politique de canal (ce que Telegram peut demander)

`src/safety/channel-policy.mjs` (`classifyChannelCapability`) :

- Par défaut : conversation et rappel mémoire uniquement (préfixes `conversation.`, `memory.`).
- Capacités additionnelles (`mail.*`, `home.read`, `home.low_risk`) : refusées tant qu'elles ne sont pas explicitement activées et scopées localement depuis l'écran PC. Une capacité non listée reste refusée (`decision: 'deny'`), jamais un défaut permissif.
- `local_only` est toujours refusé à distance, y compris depuis Telegram propriétaire — `src/approvals/remote-approval-service.mjs` (`approval_local_only_forbidden_remote`).

## Approbations distantes (one-shot)

Pour les capacités à risque nécessitant une confirmation Samsung/Telegram, voir le plan `2026-07-14-mina-v4-approvals-connectors-personality-plan.md` (Tâches 1-2) : fenêtre ≤ 5 minutes, digest lié à l'action exacte, jamais réutilisable, `local_only` toujours refusé à distance.

## Dépannage

| Symptôme | Cause probable |
|---|---|
| Bot ne répond plus | Token révoqué, bot bloqué par l'utilisateur, ou polling arrêté côté téléphone |
| Capacité refusée de façon inattendue | Vérifier l'activation locale de la capacité scoped (`telegramCapabilities`) — rien n'est permissif par défaut |
| Callback de confirmation invalide | Digest expiré (fenêtre > 5 min) ou déjà consommé — jamais rejouable |
