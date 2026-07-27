> [🇬🇧 English](httpsms.md) · 🇫🇷 **Français**

# Passerelle SMS avec httpSMS

Mina envoie et reçoit des SMS **nativement** depuis un téléphone Android appairé.
**httpSMS** est un chemin de secours : quand ce téléphone est hors ligne, Mina
passe par un service httpSMS pour continuer à envoyer/recevoir des SMS.

Ce guide s'adresse à **tous les utilisateurs** de Mina Vision. Il est optionnel :
sans configuration httpSMS, Mina utilise uniquement le SMS natif.

---

## 1. Le principe (à lire avant tout)

httpSMS ne fournit **pas** de numéro. **Un téléphone avec une carte SIM EST la
passerelle** : l'application httpSMS installée dessus envoie et reçoit les vrais
SMS. Le « serveur » httpSMS ne fait que relayer les appels API vers ce téléphone.

**Conséquence : le numéro de Mina = le numéro de la SIM du téléphone-passerelle.**
Il n'existe donc pas « un numéro Mina » universel — chaque utilisateur branche son
propre téléphone et obtient son propre numéro. C'est aussi pour ça que, sur GitHub,
il n'y a aucun numéro à distribuer.

> Le dépôt ne contient **que l'adaptateur** de protocole httpSMS (client, webhook,
> vérification de signature). Le service httpSMS lui-même (licence AGPL) n'est pas
> embarqué : vous utilisez le cloud httpsms.com ou vous l'hébergez vous-même.

---

## 2. Deux façons de faire

### Voie A — Cloud httpsms.com (recommandé, aucun hébergement)

1. Installez l'application **httpSMS** (Google Play) sur le téléphone qui portera la
   SIM servant de passerelle, et connectez-la à un compte **httpsms.com**.
2. Sur **httpsms.com** → créez une **clé API**.
3. Toujours sur httpsms.com → activez le **webhook** d'entrée et notez son
   **secret de signature**.
4. Renseignez le `.env` de Mina (voir section 4). `HTTPSMS_BASE_URL` reste
   `https://api.httpsms.com`.

Le palier gratuit suffit pour un usage personnel.

### Voie B — Auto-hébergé (aucun tiers)

Le serveur httpSMS est open-source (Go) : `https://github.com/NdoleStudio/httpsms`.

1. Déployez-le (Docker ou binaire) sur un VPS, Render, ou votre machine. Il lui faut
   une base **PostgreSQL** et une **URL publique en HTTPS** (le téléphone et les
   webhooks doivent l'atteindre).
2. Dans l'application httpSMS du téléphone, pointez vers **votre** serveur au lieu de
   httpsms.com.
3. Dans le `.env` de Mina, mettez `HTTPSMS_BASE_URL=https://votre-serveur`.

Plus lourd (DB + domaine + TLS). À réserver si vous refusez tout service tiers.

---

## 3. Les SMS entrants (point important)

Mina reçoit les SMS entrants par **webhook** : le serveur httpSMS rappelle Mina à
chaque SMS reçu. Le serveur de réception de Mina écoute en **local (loopback)**, sur
`HTTPSMS_WEBHOOK_PORT` (8787 par défaut).

- **Envoi de SMS** : fonctionne dès que les 4 variables sont posées.
- **Réception de SMS** : le webhook du cloud doit pouvoir **atteindre votre PC**. Il
  faut donc exposer le port local par un **tunnel** (`cloudflared`, `ngrok`, …) et
  déclarer cette URL publique comme cible de webhook côté httpSMS. Sans ce tunnel,
  Mina **envoie** mais ne **voit pas** les réponses.

Chaque webhook reçu est **vérifié par signature** (le `HTTPSMS_WEBHOOK_SECRET`) avant
d'être traité : un appel non signé est rejeté.

---

## 4. Variables d'environnement

Dans votre `.env` (jamais committé) :

```bash
# Les 4 premières activent httpSMS (les 4 requises ensemble).
HTTPSMS_BASE_URL=https://api.httpsms.com   # ou l'URL de votre serveur auto-hébergé
HTTPSMS_API_KEY=<clé API du dashboard httpSMS>
HTTPSMS_WEBHOOK_SECRET=<secret de signature du webhook>
HTTPSMS_FROM_NUMBER=+2135XXXXXXXX          # le numéro de la SIM du téléphone-passerelle

# Comportement de routage SMS :
#   native-first  → SMS natif d'abord, httpSMS en secours (défaut recommandé)
#   httpsms-first → httpSMS d'abord, natif en secours
#   native-only   → jamais httpSMS
#   httpsms-only  → toujours httpSMS
HTTPSMS_SMS_MODE=native-first

# Port local du récepteur de webhooks (loopback).
HTTPSMS_WEBHOOK_PORT=8787
```

Tant que l'une des 4 premières manque, httpSMS reste **désactivé** et Mina n'utilise
que le SMS natif — sans jamais prétendre le contraire.

Les garde-fous d'envoi (confirmation, liste blanche, quotas, heures calmes)
s'appliquent **aussi bien au natif qu'à httpSMS** — voir `SMS_SEND_MODE`,
`SMS_ALLOWLIST`, `SMS_MAX_PER_DAY`, `SMS_MAX_PER_MINUTE`, `SMS_QUIET_HOURS_*` dans
`.env.example`.

---

## 5. Sécurité

- **Un envoi de SMS reste une action à effet réel** : Mina exige une confirmation
  locale (ou un numéro en liste blanche) avant d'envoyer, que ce soit par le natif ou
  par httpSMS.
- La clé API et le secret de webhook sont des **secrets** : ils vivent dans `.env`
  (gitignoré), ne sont jamais committés, jamais affichés en clair.
- Le webhook entrant est **rejeté** s'il n'est pas correctement signé.

---

## 6. Vérifier que ça marche

1. Posez les 4 variables, redémarrez Mina.
2. L'onglet d'état doit indiquer le canal SMS httpSMS **disponible** (et non
   « dégradé »/« indisponible » avec une raison).
3. Demandez à Mina d'envoyer un SMS de test à votre propre numéro, confirmez
   localement, et vérifiez la réception sur le téléphone.
4. Pour tester l'entrée : envoyez un SMS **vers** le numéro de la passerelle et
   vérifiez que Mina le voit (tunnel actif requis).
