$jdk = Get-ChildItem -LiteralPath 'C:\Program Files\Eclipse Adoptium' -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like 'jdk-21*' } |
  Sort-Object Name |
  Select-Object -Last 1

if (-not $jdk) {
  Write-Error 'firebase_emulator_jdk21_required'
  exit 1
}

$env:JAVA_HOME = $jdk.FullName
$env:PATH = "$($jdk.FullName)\bin;$env:PATH"
& firebase emulators:exec --config firebase.json --project mina-vision --only 'auth,firestore,storage' 'node scripts/firebase-emulator-smoke.mjs'
exit $LASTEXITCODE
