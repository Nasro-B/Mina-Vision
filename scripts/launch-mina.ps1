param(
  [switch]$Wait,
  [switch]$Smoke
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js 22 ou supérieur est requis.'
}

$cacheRoot = if (Test-Path -LiteralPath 'G:\') {
  'G:\Programmes Installés\caches'
} else {
  Join-Path $env:LOCALAPPDATA 'Mina\Caches'
}
$env:npm_config_cache = Join-Path $cacheRoot 'npm-cache'
$env:electron_config_cache = Join-Path $cacheRoot 'electron-cache'
New-Item -ItemType Directory -Force -Path $env:npm_config_cache, $env:electron_config_cache | Out-Null

$electronInstall = Join-Path $ProjectRoot 'node_modules\electron\install.js'
if (-not (Test-Path -LiteralPath $electronInstall)) {
  & npm install
  if ($LASTEXITCODE -ne 0) { throw 'Installation npm de Mina échouée.' }
}

$electronPath = Join-Path $ProjectRoot 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath $electronPath)) {
  & node $electronInstall
  if ($LASTEXITCODE -ne 0) { throw 'Installation du binaire Electron échouée.' }
}

$runtimeScript = Join-Path $ProjectRoot 'scripts\prepare-electron-runtime.mjs'
if (Test-Path -LiteralPath $runtimeScript) {
  $runtimeJson = & node $runtimeScript
  if ($LASTEXITCODE -ne 0) { throw 'Préparation du runtime Electron Mina échouée.' }
  $runtimeResult = $runtimeJson | ConvertFrom-Json
  if ($runtimeResult.ok -and $runtimeResult.exe -and (Test-Path -LiteralPath $runtimeResult.exe)) {
    $electronPath = $runtimeResult.exe
  }
}

$arguments = @('.')
if ($Smoke) { $arguments += '--mina-smoke' }
$process = Start-Process -FilePath $electronPath -ArgumentList $arguments -WorkingDirectory $ProjectRoot -WindowStyle Normal -PassThru
if ($Wait) {
  $process.WaitForExit()
  exit $process.ExitCode
}
