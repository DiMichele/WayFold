# Deploy WayFold su Hetzner (da Windows, nella root del progetto)
# Uso: powershell -ExecutionPolicy Bypass -File deploy/deploy.ps1

$ErrorActionPreference = "Stop"
$Remote = "wayfold@167.233.121.159"
$RemoteDir = "/home/wayfold/apps/wayfold"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

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
Write-Host "Deploy app completato."
Write-Host "Configura Nginx (richiede password sudo sul server):"
Write-Host "  ssh $Remote"
Write-Host "  sudo bash $RemoteDir/deploy/setup-nginx-root.sh"
