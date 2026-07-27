> [🇬🇧 English](sandbox-runtimes.md) · 🇫🇷 **Français**

# Débloquer le bac à sable Windows (`sandbox_runtimes_unavailable`)

Mina peut exécuter du code (Python / JavaScript / PowerShell) dans un **Windows Sandbox**
jetable — une VM temporaire, sans accès réseau, détruite à la fin. C'est optionnel : Mina
fonctionne sans. Tant qu'il n'est pas provisionné, l'état affiche `sandbox_runtimes_unavailable`.

## Ce dont le bac à sable a besoin

La détection teste, dans l'ordre : fonctionnalité Windows Sandbox activée → exécutable présent →
virtualisation CPU → espace de travail NTFS → **runtimes présents**. Le message
`sandbox_runtimes_unavailable` signifie que **les 4 premiers passent** et qu'il ne manque plus
que les 3 runtimes.

### 1. Activer Windows Sandbox (si pas déjà fait)

Fonctionnalité Windows (Pro/Entreprise), virtualisation activée dans le BIOS. Pour vérifier :

```powershell
(Get-CimInstance Win32_OptionalFeature -Filter "Name='Containers-DisposableClientVM'").InstallState
```

`1` = activé. Sinon : « Activer ou désactiver des fonctionnalités Windows » → cocher
**Bac à sable Windows**, redémarrer.

### 2. Provisionner les 3 runtimes

Un script télécharge Python, Node et PowerShell **portables** depuis leurs sources officielles,
vérifie leur intégrité, et écrit le manifeste que le bac à sable attend.

> ⚠️ Le script **télécharge ~120 Mo de binaires**. C'est une action que **tu** lances toi-même.

```bash
# 1. Voir le plan sans rien télécharger
node scripts/provision-sandbox-runtimes.mjs --dry-run
```

```bash
# 2. Provisionner (télécharge). Python demande une confirmation de hash (voir plus bas).
node scripts/provision-sandbox-runtimes.mjs
```

#### Le hash Python (RÈGLE N°1 : aucun hash supposé)

Node et PowerShell publient un fichier de checksums officiel : le script vérifie tout seul.
Python **ne publie pas** de fichier de checksums téléchargeable pour le paquet *embeddable*. Au
premier lancement, le script télécharge le zip, **affiche le sha256 calculé** et l'URL python.org,
puis s'arrête. Tu vérifies la ligne sur la page officielle, puis relances :

```bash
node scripts/provision-sandbox-runtimes.mjs --python-sha256=<le hash affiché, une fois vérifié sur python.org>
```

Ainsi aucun hash n'est inventé : Node/PowerShell sont ancrés à leur éditeur, Python est validé par toi.

### 3. Vérifier

Le script **re-vérifie** le manifeste produit avec le même code que le bac à sable et refuse de
finir si quelque chose cloche. Après succès, redémarre Mina : la sonde « runtimes » passe au vert.

## Où sont rangés les runtimes

Par défaut sous `%APPDATA%\Mina Vision\cache\sandbox-runtime\`. Déportable avec la variable
d'environnement `MINA_SANDBOX_RUNTIME_ROOT` (utile pour les mettre sur un autre disque). Le
`runtime-manifest.json` y liste, pour chaque langage : version, sha256 de l'exécutable, URL
source officielle, chemin relatif.

## Sécurité

- Le bac à sable s'exécute **sans réseau** (`network: false` imposé) : le code testé ne sort pas.
- Chaque exécution re-vérifie le sha256 de l'exécutable avant de le lancer (côté invité) :
  un binaire altéré est refusé.
- Les runtimes sont téléchargés une seule fois depuis les sources officielles, jamais depuis un tiers.
