$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Mina.lnk'
$powershell = (Get-Command powershell.exe).Source
$launcher = Join-Path $PSScriptRoot 'launch-mina.ps1'
$electron = Join-Path $ProjectRoot 'node_modules\electron\dist\electron.exe'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershell
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
$shortcut.WorkingDirectory = $ProjectRoot
$shortcut.Description = 'Lancer Mina — agent visuel local'
if (Test-Path -LiteralPath $electron) { $shortcut.IconLocation = "$electron,0" }
$shortcut.Save()

Write-Output $shortcutPath
