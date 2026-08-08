# Deploy WayFold Compliance to VPS (independent from travel-app deploy.ps1).
# Does NOT print secrets.
#
# Usage (from repo root or this folder):
#   powershell -ExecutionPolicy Bypass -File apps/wayfold-compliance/deploy/deploy-compliance.ps1
#   powershell -ExecutionPolicy Bypass -File apps/wayfold-compliance/deploy/deploy-compliance.ps1 -SetupTls

param(
    [switch]$SetupTls,
    [switch]$SkipSync
)

$ErrorActionPreference = "Stop"
$Remote = "wayfold@167.233.121.159"
$RemoteDir = "/home/wayfold/apps/wayfold-compliance"
$Here = $PSScriptRoot
$AppRoot = Resolve-Path (Join-Path $Here "..")

function Invoke-RemoteBash([string]$Script) {
    $unix = ($Script -replace "`r`n", "`n") -replace "`r", "`n"
    $tmp = Join-Path $env:TEMP ("wayfold-compliance-remote-" + [guid]::NewGuid().ToString("n") + ".sh")
    [System.IO.File]::WriteAllText($tmp, $unix, [System.Text.UTF8Encoding]::new($false))
    try {
        scp $tmp "${Remote}:/tmp/wayfold-compliance-remote.sh"
        ssh $Remote "bash /tmp/wayfold-compliance-remote.sh; ec=`$?; rm -f /tmp/wayfold-compliance-remote.sh; exit `$ec"
        if ($LASTEXITCODE -ne 0) { throw "Remote bash failed with exit $LASTEXITCODE" }
    } finally {
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    }
}

if (-not $SkipSync) {
    Write-Host "-> Sync $AppRoot → ${Remote}:${RemoteDir}"
    ssh $Remote "mkdir -p $RemoteDir"
    if ($LASTEXITCODE -ne 0) { throw "ssh mkdir failed" }

    $Archive = Join-Path $env:TEMP "wayfold-compliance-deploy.tgz"
    if (Test-Path $Archive) { Remove-Item $Archive -Force }

    Push-Location $AppRoot
    try {
        tar -czf $Archive `
            --exclude=vendor `
            --exclude=.git `
            --exclude=.wayfold/logs `
            --exclude=.wayfold/orchestrator.lock `
            --exclude=__pycache__ `
            --exclude=.venv `
            --exclude=*.sqlite3 `
            --exclude=data `
            .
        if ($LASTEXITCODE -ne 0) { throw "tar failed" }
    } finally {
        Pop-Location
    }

    scp $Archive "${Remote}:${RemoteDir}/wayfold-compliance-deploy.tgz"
    if ($LASTEXITCODE -ne 0) { throw "scp failed" }
    Remove-Item $Archive -Force

    Invoke-RemoteBash @"
set -euo pipefail
cd $RemoteDir
# Preserve local db/data across deploys
tar -xzf wayfold-compliance-deploy.tgz
rm -f wayfold-compliance-deploy.tgz
chmod +x deploy/update-remote.sh deploy/setup-nginx-tls.sh 2>/dev/null || true
sed -i 's/\r$//' deploy/update-remote.sh deploy/setup-nginx-tls.sh 2>/dev/null || true
bash deploy/update-remote.sh
"@
}

$tlsOk = $false
if ($SetupTls) {
    Write-Host "-> Nginx + Let's Encrypt for compliance.wayfold.xyz"
    ssh $Remote "sudo -n bash $RemoteDir/deploy/setup-nginx-tls.sh"
    if ($LASTEXITCODE -eq 0) {
        $tlsOk = $true
    } else {
        Write-Host "WARN: TLS/nginx setup requires passwordless sudo on VPS."
        Write-Host "      App stack is up on localhost. Run once as root:"
        Write-Host "      sudo bash $RemoteDir/deploy/setup-nginx-tls.sh"
    }
}

# Local health on VPS (does not depend on public TLS)
ssh $Remote "curl -fsS http://127.0.0.1:18000/api/health/"
if ($LASTEXITCODE -ne 0) { throw "Local backend health failed on VPS" }

Write-Host ""
if ($tlsOk) {
    Write-Host "Deploy completato: https://compliance.wayfold.xyz"
    Write-Host "WayFold engine:    https://compliance.wayfold.xyz/wayfold/"
} else {
    Write-Host "Deploy app OK (Docker). Public HTTPS pending root TLS setup."
    Write-Host "Local API: http://127.0.0.1:18000/api/health/ on VPS"
}
