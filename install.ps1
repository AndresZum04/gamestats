<#
.SYNOPSIS
  Instalador de GameStats para Windows. Solo necesita Docker Desktop: compila
  Go y Scala desde el código fuente dentro de contenedores y deja todo corriendo.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Yes -DataDir D:\gamestats-data
#>
param(
  [switch]$Yes,          # no pregunta nada
  [string]$DataDir = ""  # carpeta de datos (por defecto .\gamestats-data o GAMESTATS_DATA)
)
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host ""; Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

# Corre un comando nativo y devuelve $true si terminó bien, sin ensuciar la consola.
function Test-Native([scriptblock]$cmd) {
  try { & $cmd *> $null; return ($LASTEXITCODE -eq 0) } catch { return $false }
}

Step "Verificando Docker"
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Fail "Docker no está instalado. Instalá Docker Desktop: https://www.docker.com/products/docker-desktop/ (requiere WSL2)."
}
if (-not (Test-Native { docker info })) {
  Fail "Docker está instalado pero no responde. Abrí Docker Desktop, esperá a que diga 'Engine running' y volvé a intentar."
}
if (-not (Test-Native { docker compose version })) {
  Fail "Falta Docker Compose v2 (el comando 'docker compose'). Actualizá Docker Desktop."
}
Write-Host ("Docker " + (docker version --format "{{.Server.Version}}"))

Step "Verificando los puertos 8080 y 8081"
$ours = (docker compose ps -q --status running 2>$null)
foreach ($port in 8080, 8081) {
  $busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($busy) {
    if ($ours) {
      Write-Host "El puerto $port lo usa una instalación anterior de GameStats: se va a actualizar."
    } else {
      $proc = (Get-Process -Id ($busy | Select-Object -First 1).OwningProcess -ErrorAction SilentlyContinue).ProcessName
      Fail "El puerto $port está ocupado por otro programa ($proc). Cerralo y volvé a correr el instalador."
    }
  } else {
    Write-Host "Puerto $port libre."
  }
}

Step "Carpeta de datos"
if (-not $DataDir) { $DataDir = $env:GAMESTATS_DATA }
if (-not $DataDir) {
  $DataDir = ".\gamestats-data"
  if (-not $Yes) {
    $answer = Read-Host "¿Dónde guardo los datos? [$DataDir]"
    if ($answer) { $DataDir = $answer }
  }
}
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$DataDir = (Resolve-Path $DataDir).Path
foreach ($sub in "events\racing-pro", "events\arena-clash", "events\chess-lite", "results", "rejected", "outbox", "state") {
  New-Item -ItemType Directory -Force -Path (Join-Path $DataDir $sub) | Out-Null
}
# Docker Desktop acepta rutas de Windows con barras normales: C:/...
$DataForCompose = $DataDir.Replace('\', '/')
Write-Host "Datos en: $DataDir"

Step "Escribiendo .env"
# UTF-8 sin BOM: Set-Content -Encoding utf8 de PowerShell 5 agrega un BOM que
# confunde a docker compose.
$envText = "GAMESTATS_DATA=""$DataForCompose""`n"
[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot ".env"), $envText, (New-Object System.Text.UTF8Encoding($false)))
Get-Content .env

Step "Compilando desde el código fuente (la primera vez tarda unos minutos)"
docker compose --profile demo build
if ($LASTEXITCODE -ne 0) { Fail "La compilación falló. Revisá el mensaje de arriba." }

Step "Levantando los servicios y esperando que estén sanos (máximo 5 minutos)"
docker compose up -d --wait --wait-timeout 300
if ($LASTEXITCODE -ne 0) {
  docker compose ps
  Fail "Los servicios no quedaron sanos. Revisá los logs con: docker compose logs"
}
docker compose ps

Write-Host ""
Write-Host "GameStats está listo." -ForegroundColor Green
Write-Host ""
Write-Host "  Tablero:          http://localhost:8081/dashboard"
Write-Host "  API del analyzer: http://localhost:8081/api/v1/matches"
Write-Host "  API del ingestor: http://localhost:8080/api/v1/stats"
Write-Host "  Eventos:          $DataDir\events   (copiá aquí archivos .jsonl)"
Write-Host "  Resultados:       $DataDir\results"
Write-Host ""
Write-Host "Para generar partidas con el simulador:"
Write-Host "  docker compose --profile demo run --rm simulator"
Write-Host ""
Write-Host "Para cargar un dataset de ejemplo:"
Write-Host "  Copy-Item data\samples\demo-small.jsonl `"$DataDir\events\`""
Write-Host ""
Write-Host "Para desinstalar: powershell -ExecutionPolicy Bypass -File .\uninstall.ps1"
