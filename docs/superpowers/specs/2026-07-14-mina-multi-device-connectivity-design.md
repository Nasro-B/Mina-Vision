# Mina — Samsung utilisateur et Huawei passerelle USB/Wi‑Fi

**Statut :** design validé oralement par Nasro le 14 juillet 2026.

## Objectif

Séparer clairement les rôles des deux téléphones :

- le Samsung est le terminal personnel depuis lequel Nasro parle à Mina dans l’application Telegram normale ;
- le Huawei `MAR-LX1A`, numéro de série `HUAWEITESTSERIAL`, reste physiquement près du PC et porte la passerelle Mina pour Telegram, SMS et transports locaux ;
- le Huawei doit rester utilisable par ADB en USB et par Wi‑Fi, avec bascule sûre et sans être compté comme deux téléphones différents.

## État matériel vérifié

- Huawei `MAR-LX1A`, Android 10/API 29, EMUI 12.
- ADB Platform Tools 37.0.0 et mDNS actifs sur le PC.
- Connexion USB actuellement autorisée.
- Interface Wi‑Fi Huawei actuellement sur `192.168.1.16/24`.
- Android 10 ne prend pas en charge le flux moderne `adb pair` introduit pour Android 11/API 30.

L’adresse `192.168.1.16` est un état observé, pas une garantie. Le routeur doit réserver cette adresse au Huawei avant de la considérer comme configuration stable.

## Rôles et frontière de confiance

### Samsung

Le Samsung n’héberge ni APK Mina, ni token Bot API, ni clé de transport, ni connexion ADB. Il utilise le compte Telegram propriétaire de Nasro. Son identité est le `telegram_user_id` numérique déjà appairé, jamais le nom, le pseudonyme ou le numéro seuls.

### Huawei

Le Huawei est l’unique consommateur de `getUpdates` du bot Telegram et l’unique lecteur/émetteur SMS. Il conserve le token Bot API dans Android Keystore, les files dans Room chiffré et les clés de transport dans Android Keystore.

Il héberge également la passerelle Home APIs définie dans [Mina — maison connectée locale et Google Home](2026-07-14-mina-smart-home-design.md). Les tokens Google Home restent dans Android Keystore ; seules les commandes et états minimaux transitent vers le PC.

### PC

Le PC exécute Mina, les modèles, la mémoire, les connecteurs e-mail, les règles et les outils. Il reste l’autorité de capacité même si le Huawei est compromis.

## Deux réseaux distincts

### Transport applicatif Mina

Le transport métier porte les enveloppes SMS/Telegram et les commandes/réponses. Il est authentifié, chiffré et dédupliqué au niveau applicatif.

Ordre :

1. USB ;
2. LAN Wi‑Fi Mina authentifié ;
3. Firebase ciphertext avec TTL ;
4. file locale Huawei.

### ADB

ADB sert uniquement à installer, diagnostiquer, maintenir, capturer l’écran du Huawei et assurer les actions mobiles prévues. Il ne remplace pas le protocole métier Mina et ne transporte pas les secrets e-mail.

Ordre :

1. endpoint USB ;
2. endpoint TCP/IP Wi‑Fi historique ;
3. indisponible.

## Activation ADB Wi‑Fi Android 10

L’activation initiale exige l’USB autorisé :

1. vérifier exactement le Huawei USB attendu ;
2. exécuter `adb -s HUAWEITESTSERIAL tcpip 5555` ;
3. exécuter `adb connect 192.168.1.16:5555` ;
4. lire par l’endpoint réseau `ro.serialno`, constructeur, modèle et version ;
5. accepter l’endpoint seulement si les valeurs correspondent au profil Huawei appairé.

Le port 5555 n’est jamais ouvert ou redirigé sur Internet. La box/routeur ne doit avoir aucune règle NAT/UPnP correspondante.

## Registre de périphériques physiques

Le bridge actuel exige exactement une ligne ADB `device`. Cette hypothèse devient invalide lorsque le même Huawei apparaît en USB et en TCP/IP.

Le nouveau `PhysicalDeviceRegistry` regroupe plusieurs endpoints sous une seule identité :

```text
physicalDeviceId: huawei:HUAWEITESTSERIAL
usbEndpoint: HUAWEITESTSERIAL
wifiEndpoint: 192.168.1.16:5555
preferredEndpoint: usb
verifiedModel: MAR-LX1A
```

Chaque endpoint est vérifié avant son association. Une adresse IP seule ne constitue jamais une identité.

Lorsque les deux endpoints sont présents :

- USB reçoit les commandes ;
- Wi‑Fi reste en veille et est surveillé ;
- une seule commande ADB peut être active par périphérique physique ;
- la disparition USB bascule atomiquement sur Wi‑Fi ;
- le retour USB termine la commande en cours avant de redevenir prioritaire.

## Réseau domestique autorisé

Le profil ADB Wi‑Fi comprend : SSID, BSSID, sous-réseau, IP réservée, empreinte du Huawei et numéro de série.

Mina ne tente aucune connexion TCP/IP si :

- le PC n’est pas sur le SSID/BSSID autorisé ;
- le réseau Windows n’est pas classé privé ;
- l’IP sort du sous-réseau attendu ;
- l’identité ADB retournée diffère ;
- plusieurs appareils revendiquent la même identité.

Le SSID n’est pas suffisant seul, car il peut être usurpé.

## Reconnexion et redémarrage

Au `runtime_start` et à chaque changement réseau :

1. sonder USB ;
2. sonder l’endpoint Wi‑Fi enregistré ;
3. reconstruire le registre physique ;
4. publier `usb_active`, `wifi_standby`, `wifi_active`, `degraded` ou `offline` ;
5. reprendre les files métier sans rejouer une action ADB non vérifiée.

Après redémarrage du Huawei, le mode `adb tcpip` peut être perdu. Mina signale alors `wifi_adb_requires_usb_bootstrap` ; elle ne prétend pas l’avoir réactivé.

## Arrêt et révocation

Le bouton local « Couper ADB Wi‑Fi » utilise l’endpoint USB s’il existe, sinon l’endpoint Wi‑Fi vérifié, pour exécuter `adb usb`. La révocation des clés ADB reste une action manuelle sur le Huawei.

L’arrêt d’urgence Mina stoppe les actions mais ne révoque pas automatiquement ADB, afin de ne pas empêcher un diagnostic. La capacité ADB peut toutefois être mise en pause localement.

## Risques acceptés

ADB TCP/IP historique écoute sur le LAN et est moins sûr que l’appairage TLS d’Android 11+. L’autorisation RSA limite les clients, mais n’annule pas l’exposition réseau. Ce mode est accepté parce que le Huawei reste au domicile près du PC.

Si le Huawei doit quitter le domicile ou rejoindre un Wi‑Fi public, ADB Wi‑Fi doit être coupé avant le départ.

## Tests obligatoires

- USB seul, Wi‑Fi seul et double endpoint du même Huawei.
- Faux appareil à `192.168.1.16` avec autre numéro de série.
- Deux appareils ADB réels : aucune sélection implicite.
- Disparition USB pendant observation et pendant action.
- Retour USB pendant action Wi‑Fi.
- Changement SSID/BSSID, réseau public et IP modifiée.
- Redémarrage ADB server et redémarrage Huawei.
- Verrou d’une commande par périphérique et timeout.
- Transport métier toujours chiffré même quand ADB fonctionne.

## Critères d’acceptation

- Le Samsung dialogue avec Mina via Telegram sans composant Mina installé.
- Le Huawei reste l’unique poller Telegram et l’unique passerelle SMS.
- Le même Huawei USB/Wi‑Fi compte comme un seul périphérique physique.
- USB est préféré ; Wi‑Fi reprend sans doublon ni mauvaise cible.
- Un appareil inconnu ou un réseau non autorisé est refusé.
- L’UI distingue transport Mina Wi‑Fi et ADB Wi‑Fi.

## Référence officielle

- Android Debug Bridge, connexion Wi‑Fi et prérequis Android 11+ : https://developer.android.com/tools/adb#connect-to-a-device-over-wi-fi
