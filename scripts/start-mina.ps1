# Lance Mina Vision avec un mode de routage explicite. Ne modifie que des variables
# d'environnement bornees au process courant (jamais persistees), ne lance jamais
# `npm install` automatiquement et n'active jamais l'ADB Wi-Fi lui-meme.
param(
    [ValidateSet('Auto', 'LocalFirst', 'LocalOnly')]
    [string]$Mode = 'Auto',
    [switch]$Offline
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if ($Offline -and $Mode -eq 'Auto') {
    Write-Error "-Offline ne peut pas coexister avec le mode Auto (fournisseurs cloud requis). Utilisez -Mode LocalOnly -Offline."
    exit 1
}

$modeMap = @{ 'Auto' = 'auto'; 'LocalFirst' = 'local-first'; 'LocalOnly' = 'local-only' }
$env:MINA_INFERENCE_MODE = $modeMap[$Mode]
$env:MINA_OFFLINE = if ($Offline) { 'true' } else { 'false' }

Write-Host "Mina Vision - mode $($modeMap[$Mode]), offline=$($env:MINA_OFFLINE)"

& "$PSScriptRoot/verify-mina.ps1"
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Verification non entierement prete (voir le rapport ci-dessus) - demarrage quand meme en mode degrade."
}

npm start
exit $LASTEXITCODE
