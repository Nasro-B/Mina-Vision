# Vérification en lecture seule de Mina Vision : versions, chemins, santé des ports locaux,
# manifestes de modèles et disponibilité des fonctionnalités. N'imprime jamais de secret ni de
# numéro de série complet. Ne modifie rien (aucun ADB Wi-Fi, aucune installation).
param()

Set-Location (Split-Path -Parent $PSScriptRoot)
node "scripts/verify-mina.mjs"
exit $LASTEXITCODE
