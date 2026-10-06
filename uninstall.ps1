<#
.SYNOPSIS
  Desinstalador de GameStats para Windows: baja los contenedores y borra las
  imágenes que construyó el instalador. Pregunta antes de borrar los datos.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
  powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -Yes -DeleteData
#>
param(
  [switch]$Yes,        # no pregunta; conserva los datos salvo -DeleteData
  [switch]$DeleteData  # borra también la carpeta de datos
)
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$data = ""
if (Test-Path .env) {
  $line = Get-Content .env | Where-Object { $_ -match '^GAMESTATS_DATA=' } | Select-Object -First 1
  if ($line) { $data = ($line -replace '^GAMESTATS_DATA=', '').Trim('"') }
}

Write-Host "==> Bajando contenedores y borrando las imágenes de GameStats" -ForegroundColor Cyan
docker compose --profile demo down --rmi all --remove-orphans

if ($data -and (Test-Path $data)) {
  $delete = [bool]$DeleteData
  if (-not $delete -and -not $Yes) {
    $answer = Read-Host "¿Borrar también la carpeta de datos $data? [s/N]"
    $delete = $answer -match '^(s|si|sí)$'
  }
  if ($delete) {
    Remove-Item -Recurse -Force -Path $data
    Write-Host "Carpeta de datos borrada."
  } else {
    Write-Host "Se conservan los datos en: $data"
  }
}
Remove-Item -Force -ErrorAction SilentlyContinue .env
Write-Host "GameStats desinstalado." -ForegroundColor Green
