<#
.SYNOPSIS
  Instalador de GameConsole para Windows. Levanta la consola web, la IA de
  Blackjack en Prolog y GameStats. Solo necesita Docker Desktop (Compose 2.24
  o mayor): todo se compila desde el código fuente dentro de contenedores.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Yes -DataDir D:\gamestats-data
#>
param(
  [switch]$Yes,          # no pregunta nada
  [string]$DataDir = ""  # carpeta de datos (por defecto ..\gamestats-data o GAMESTATS_DATA)
)
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host ""; Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

# Corre un comando nativo y devuelve $true si terminó bien, sin ensuciar la consola.
function Test-Native([scriptblock]$cmd) {
  try { & $cmd *> $null; return ($LASTEXITCODE -eq 0) } catch { return $false }
}

if (-not (Test-Path ..\docker-compose.yml) -or -not (Test-Path ..\configs\games)) {
  Fail "No encuentro GameStats en la carpeta de arriba. La consola vive en la carpeta console\ del repositorio de GameStats."
}

Step "Verificando Docker"
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Fail "Docker no está instalado. Instalá Docker Desktop: https://www.docker.com/products/docker-desktop/ (requiere WSL2)."
}
if (-not (Test-Native { docker info })) {
  Fail "Docker está instalado pero no responde. Abrí Docker Desktop, esperá a que diga 'Engine running' y volvé a intentar."
}
$compose = ""
try { $compose = (docker compose version --short 2>$null) } catch { $compose = "" }
if (-not $compose) { Fail "Falta Docker Compose v2 (el comando 'docker compose'). Actualizá Docker Desktop." }
# include con varios archivos necesita Compose 2.24 o mayor.
$parts = ($compose.Trim().TrimStart('v') -split '\.')
$major = [int]$parts[0]; $minor = [int]$parts[1]
if ($major -lt 2 -or ($major -eq 2 -and $minor -lt 24)) {
  Fail "Docker Compose $compose es muy viejo: la consola necesita 2.24 o mayor. Actualizá Docker Desktop."
}
Write-Host ("Docker " + (docker version --format "{{.Server.Version}}") + ", Compose $compose")

Step "Verificando los puertos 3000, 4000, 8080 y 8081"
$ours = (docker compose ps -q --status running 2>$null)
foreach ($port in 3000, 4000, 8080, 8081) {
  $busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($busy) {
    if ($ours) {
      Write-Host "El puerto $port lo usa una instalación anterior de GameConsole: se va a actualizar."
    } else {
      $proc = (Get-Process -Id ($busy | Select-Object -First 1).OwningProcess -ErrorAction SilentlyContinue).ProcessName
      Fail "El puerto $port está ocupado por otro programa ($proc). Cerralo y volvé a correr el instalador. Si es GameStats instalado solo, bajalo antes con: cd ..; docker compose down"
    }
  } else {
    Write-Host "Puerto $port libre."
  }
}

Step "Carpeta de datos"
if (-not $DataDir) { $DataDir = $env:GAMESTATS_DATA }
if (-not $DataDir -and (Test-Path ..\.env)) {
  # Si GameStats ya se instaló, se usa la misma carpeta.
  $line = Get-Content ..\.env | Where-Object { $_ -match '^GAMESTATS_DATA=' } | Select-Object -First 1
  if ($line) { $DataDir = ($line -replace '^GAMESTATS_DATA=', '').Trim('"') }
}
if (-not $DataDir) {
  $DataDir = "..\gamestats-data"
  if (-not $Yes) {
    $answer = Read-Host "¿Dónde guardo los datos? [$DataDir]"
    if ($answer) { $DataDir = $answer }
  }
}
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$DataDir = (Resolve-Path $DataDir).Path
# Una carpeta de eventos por juego registrado en GameStats.
$games = Get-ChildItem -Path "..\configs\games" -Filter "*.json" | Where-Object { $_.BaseName -ne "_common" }
foreach ($game in $games) {
  New-Item -ItemType Directory -Force -Path (Join-Path $DataDir "events\$($game.BaseName)") | Out-Null
}
foreach ($sub in "results", "rejected", "outbox", "state") {
  New-Item -ItemType Directory -Force -Path (Join-Path $DataDir $sub) | Out-Null
}
$DataForCompose = $DataDir.Replace('\', '/')
Write-Host "Datos en: $DataDir"

Step "Escribiendo .env"
# El mismo contenido en console\.env (lo lee la consola) y en ..\.env (lo lee
# el compose de GameStats incluido). UTF-8 sin BOM, que docker compose entiende.
$envText = "GAMESTATS_DATA=""$DataForCompose""`n"
# Si una instalación anterior (por ejemplo con install.sh en Git Bash) fijó el
# usuario de los contenedores, se conserva: los archivos de la carpeta de
# datos son de ese usuario y otro no podría escribirlos.
foreach ($file in ".env", "..\.env") {
  if (Test-Path $file) {
    $ids = Get-Content $file | Where-Object { $_ -match '^GAMESTATS_(UID|GID)=' }
    if ($ids) { $envText += (($ids -join "`n") + "`n"); break }
  }
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot ".env"), $envText, $utf8)
[System.IO.File]::WriteAllText((Join-Path (Split-Path $PSScriptRoot -Parent) ".env"), $envText, $utf8)
Get-Content .env

Step "Compilando desde el código fuente (la primera vez tarda unos minutos)"
docker compose build
if ($LASTEXITCODE -ne 0) { Fail "La compilación falló. Revisá el mensaje de arriba." }

Step "Levantando los servicios y esperando que estén sanos (máximo 5 minutos)"
docker compose up -d --wait --wait-timeout 300
if ($LASTEXITCODE -ne 0) {
  docker compose ps
  Fail "Los servicios no quedaron sanos. Revisá los logs con: docker compose logs"
}
docker compose ps

Write-Host ""
Write-Host "GameConsole está lista." -ForegroundColor Green
Write-Host ""
Write-Host "  Consola:            http://localhost:3000"
Write-Host "  Panel:              http://localhost:3000/panel"
Write-Host "  Tablero GameStats:  http://localhost:8081/dashboard"
Write-Host "  API del analyzer:   http://localhost:8081/api/v1/matches"
Write-Host "  API del ingestor:   http://localhost:8080/api/v1/stats"
Write-Host "  IA de Prolog:       http://localhost:4000/health"
Write-Host "  Eventos:            $DataDir\events"
Write-Host ""
Write-Host "Demo con 6 partidas automáticas: abrí http://localhost:3000/?autoplay=1&seed=1&open=trivia,snake,blackjack,trivia,snake,blackjack"
Write-Host "Para desinstalar: powershell -ExecutionPolicy Bypass -File .\uninstall.ps1"
