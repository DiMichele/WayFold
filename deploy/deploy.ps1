# Deploy WayFold su Hetzner (da Windows, nella root del progetto)
#
# Uso normale (git push + aggiornamento server):
#   powershell -ExecutionPolicy Bypass -File deploy/deploy.ps1
#   powershell -ExecutionPolicy Bypass -File deploy/deploy.ps1 -Message "Fix UI road empty state"
#
# Solo aggiornamento remoto (codice già pushato):
#   powershell -ExecutionPolicy Bypass -File deploy/deploy.ps1 -SkipPush
#
# Deploy completo via archivio (primo setup o emergenza):
#   powershell -ExecutionPolicy Bypass -File deploy/deploy.ps1 -Full

param(
    [string]$Message = "",
    [switch]$SkipPush,
    [switch]$Full
)

$ErrorActionPreference = "Stop"
$Remote = "wayfold@167.233.121.159"
$RemoteDir = "/home/wayfold/apps/wayfold"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

function Deploy-Git {
    Set-Location $ProjectRoot

    if (-not (Test-Path (Join-Path $ProjectRoot ".git"))) {
        throw "Repository git non trovato. Esegui 'git init' nella root del progetto."
    }

    $status = git status --porcelain
    if ($status -and -not $Message) {
        throw @"
Modifiche locali non committate. Committa prima oppure passa -Message:
  powershell -ExecutionPolicy Bypass -File deploy/deploy.ps1 -Message "descrizione"
"@
    }

    if ($Message) {
        Write-Host "-> Commit locale..."
        git add -A
        git commit -m $Message
    }

    if (-not $SkipPush) {
        Write-Host "-> Push su GitHub..."
        git push origin main
    }

    Write-Host "-> Aggiornamento server (git pull + restart)..."
    ssh $Remote "sed -i 's/\r$//' $RemoteDir/deploy/update-from-git.sh 2>/dev/null; bash $RemoteDir/deploy/update-from-git.sh"

    Write-Host ""
    Write-Host "Deploy completato: https://wayfold.xyz"
}

function Deploy-Full {
    $Archive = Join-Path $env:TEMP "wayfold-deploy.tgz"

    Write-Host "-> Archivio da $ProjectRoot"
    if (Test-Path $Archive) { Remove-Item $Archive -Force }

    & tar -czf $Archive `
        --exclude=node_modules `
        --exclude=sessions `
        --exclude=photos `
        --exclude=.git `
        --exclude=tools `
        --exclude=db.json `
        --exclude=db.json.tmp `
        -C $ProjectRoot .

    Write-Host "-> Upload archivio..."
    ssh $Remote "mkdir -p $RemoteDir"
    scp $Archive "${Remote}:${RemoteDir}/wayfold-deploy.tgz"

    $EnvFile = Join-Path $ProjectRoot ".env"
    if (Test-Path $EnvFile) {
        Write-Host "-> Upload .env..."
        scp $EnvFile "${Remote}:${RemoteDir}/.env"
    }

    Write-Host "-> Estrazione e installazione remota..."
    ssh $Remote @"
set -e
APP_DIR=$RemoteDir
cd `"`$APP_DIR`"
tar -xzf wayfold-deploy.tgz
rm -f wayfold-deploy.tgz
if [ -f .env ]; then
  grep -q '^BASE_URL=' .env && sed -i 's|^BASE_URL=.*|BASE_URL=https://wayfold.xyz|' .env || echo 'BASE_URL=https://wayfold.xyz' >> .env
  grep -q '^NODE_ENV=' .env && sed -i 's|^NODE_ENV=.*|NODE_ENV=production|' .env || echo 'NODE_ENV=production' >> .env
  grep -q '^MAIL_LOG_CODES=' .env && sed -i 's|^MAIL_LOG_CODES=.*|MAIL_LOG_CODES=false|' .env || echo 'MAIL_LOG_CODES=false' >> .env
  grep -q '^PORT=' .env && sed -i 's|^PORT=.*|PORT=3000|' .env || echo 'PORT=3000' >> .env
fi
chmod +x deploy/*.sh
bash deploy/install-on-server.sh
"@

    Write-Host ""
    Write-Host "Deploy completo via archivio terminato."
    Write-Host "Configura Nginx (solo prima volta):"
    Write-Host "  ssh $Remote"
    Write-Host "  sudo bash $RemoteDir/deploy/setup-nginx-root.sh"
}

if ($Full) {
    Deploy-Full
} else {
    Deploy-Git
}
