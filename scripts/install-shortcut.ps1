$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Mina.lnk'
$powershell = (Get-Command powershell.exe).Source
$launcher = Join-Path $PSScriptRoot 'launch-mina.ps1'
$icon = Join-Path $ProjectRoot 'assets\Logo\mina-vision.ico'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershell
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
$shortcut.WorkingDirectory = $ProjectRoot
$shortcut.Description = 'Lancer Mina — agent visuel local'
# Icône du raccourci bureau = logo Mina Vision (généré par scripts/generate-icons.mjs),
# jamais l'icône générique d'Electron.
if (Test-Path -LiteralPath $icon) { $shortcut.IconLocation = "$icon,0" }
$shortcut.Save()

Write-Output $shortcutPath
