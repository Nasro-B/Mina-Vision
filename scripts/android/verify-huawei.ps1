param(
  [string]$AdbPath = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $AdbPath -PathType Leaf)) { throw 'ADB introuvable.' }
$NodePath = (Get-Command node -ErrorAction Stop).Source
$ProofVerifier = Join-Path $PSScriptRoot 'verify-device-proof.mjs'

function Invoke-Adb([string[]]$Arguments) {
  $output = & $AdbPath @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Vérification ADB échouée." }
  return ($output -join "`n").Trim()
}

function Redact-Serial([string]$Serial) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Serial))
    return 'adb-' + ([BitConverter]::ToString($hash).Replace('-', '').Substring(0, 10).ToLowerInvariant())
  } finally {
    $sha.Dispose()
  }
}

$lines = (Invoke-Adb @('devices', '-l')) -split "`r?`n" | Select-Object -Skip 1 | Where-Object { $_.Trim() }
if ($lines | Where-Object { $_ -match '\sunauthorized(?:\s|$)' }) { throw 'Un appareil ADB non autorisé est présent.' }
$serials = @($lines | Where-Object { $_ -match '\sdevice(?:\s|$)' } | ForEach-Object { ($_ -split '\s+')[0] })
if ($serials.Count -lt 1) { throw 'Aucun Huawei ADB autorisé.' }

$reports = foreach ($serial in $serials) {
  $model = Invoke-Adb @('-s', $serial, 'shell', 'getprop ro.product.model')
  $api = Invoke-Adb @('-s', $serial, 'shell', 'getprop ro.build.version.sdk')
  $gms = Invoke-Adb @('-s', $serial, 'shell', 'pm', 'path', 'com.google.android.gms')
  $address = Invoke-Adb @('-s', $serial, 'shell', 'ip', '-f', 'inet', 'addr', 'show', 'wlan0')
  $gatewayPackage = Invoke-Adb @('-s', $serial, 'shell', 'pm', 'path', 'fr.mina.gateway')
  $identityRaw = Invoke-Adb @('-s', $serial, 'shell', 'run-as', 'fr.mina.gateway', 'cat', 'files/device-identity.json')
  $identity = $identityRaw | ConvertFrom-Json
  if (-not $identity.deviceId -or -not $identity.publicKeySpkiBase64 -or -not $identity.signatureBase64) {
    throw 'Identité signée Mina Gateway absente.'
  }
  $verified = $identityRaw | & $NodePath $ProofVerifier
  if ($LASTEXITCODE -ne 0 -or $verified -ne 'verified') { throw 'Signature identité Mina Gateway invalide.' }
  [pscustomobject]@{
    endpoint = Redact-Serial $serial
    transport = if ($serial -match ':\d+$') { 'lan' } else { 'usb' }
    model = $model
    api = [int]$api
    gms = $gms -match '^package:'
    gatewayInstalled = $gatewayPackage -match '^package:'
    wifiAddress = if ($address -match 'inet\s+([0-9.]+)') { $Matches[1] } else { $null }
    deviceId = $identity.deviceId
    identityProofPresent = $true
  }
}

$identities = @($reports.deviceId | Select-Object -Unique)
if ($identities.Count -ne 1) { throw 'Plusieurs identités physiques détectées.' }
$reports | ConvertTo-Json -Depth 4
