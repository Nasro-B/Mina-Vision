> 🇬🇧 **English** · [🇫🇷 Français](sandbox-runtimes.fr.md)

# Unlocking the Windows Sandbox (`sandbox_runtimes_unavailable`)

Mina can run code (Python / JavaScript / PowerShell) inside a disposable **Windows Sandbox** —
a temporary VM, with no network access, destroyed at the end. It is optional: Mina works
without it. Until it is provisioned, the state shows `sandbox_runtimes_unavailable`.

## What the sandbox needs

Detection tests, in order: Windows Sandbox feature enabled → executable present → CPU
virtualization → NTFS workspace → **runtimes present**. The message
`sandbox_runtimes_unavailable` means **the first 4 pass** and only the 3 runtimes are missing.

### 1. Enable Windows Sandbox (if not already done)

Windows feature (Pro/Enterprise), virtualization enabled in the BIOS. To check:

```powershell
(Get-CimInstance Win32_OptionalFeature -Filter "Name='Containers-DisposableClientVM'").InstallState
```

`1` = enabled. Otherwise: "Turn Windows features on or off" → check **Windows Sandbox**,
reboot.

### 2. Provision the 3 runtimes

A script downloads **portable** Python, Node and PowerShell from their official sources,
verifies their integrity, and writes the manifest the sandbox expects.

> ⚠️ The script **downloads ~120 MB of binaries**. This is an action **you** launch yourself.

```bash
# 1. See the plan without downloading anything
node scripts/provision-sandbox-runtimes.mjs --dry-run
```

```bash
# 2. Provision (downloads). Python asks for a hash confirmation (see below).
node scripts/provision-sandbox-runtimes.mjs
```

#### The Python hash (RULE #1: no assumed hash)

Node and PowerShell publish an official checksums file: the script verifies them on its own.
Python **does not publish** a downloadable checksums file for the *embeddable* package. On the
first run, the script downloads the zip, **prints the computed sha256** and the python.org URL,
then stops. You verify the line on the official page, then rerun:

```bash
node scripts/provision-sandbox-runtimes.mjs --python-sha256=<the printed hash, once verified on python.org>
```

That way no hash is ever invented: Node/PowerShell are anchored to their publisher, Python is
validated by you.

### 3. Verify

The script **re-verifies** the produced manifest with the same code the sandbox uses and
refuses to finish if anything is off. After success, restart Mina: the "runtimes" probe turns
green.

## Where the runtimes live

By default under `%APPDATA%\Mina Vision\cache\sandbox-runtime\`. Relocatable with the
`MINA_SANDBOX_RUNTIME_ROOT` environment variable (useful to put them on another drive). The
`runtime-manifest.json` there lists, for each language: version, executable sha256, official
source URL, relative path.

## Security

- The sandbox runs **without network** (`network: false` enforced): tested code cannot phone out.
- Every execution re-verifies the executable's sha256 before launching it (guest side): a
  tampered binary is refused.
- Runtimes are downloaded once from official sources, never from a third party.
