#!/usr/bin/env bash
# Instalador de GameStats para Linux y macOS (también funciona en Git Bash).
# Solo necesita Docker con Docker Compose v2: compila Go y Scala desde el
# código fuente dentro de contenedores y deja todo corriendo.
#
# Uso: ./install.sh [--yes] [--data CARPETA]
#   --yes          no pregunta nada (usa la carpeta por defecto o GAMESTATS_DATA)
#   --data DIR     carpeta de datos (por defecto ./gamestats-data)
set -euo pipefail
cd "$(dirname "$0")"

YES=0
DATA="${GAMESTATS_DATA:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes) YES=1 ;;
    --data) DATA="${2:?falta la carpeta después de --data}"; shift ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
  shift
done

step() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

step "Verificando Docker"
command -v docker >/dev/null 2>&1 || fail "Docker no está instalado.
  Linux: https://docs.docker.com/engine/install/  (o: curl -fsSL https://get.docker.com | sh)
  macOS: instalá Docker Desktop desde https://www.docker.com/products/docker-desktop/"
docker info >/dev/null 2>&1 || fail "Docker está instalado pero no responde.
  Abrí Docker Desktop, o en Linux: sudo systemctl start docker
  Si el error es de permisos: sudo usermod -aG docker \$USER y volvé a iniciar sesión."
docker compose version >/dev/null 2>&1 || fail "Falta Docker Compose v2 (el comando 'docker compose').
  Actualizá Docker Desktop, o en Linux instalá el paquete docker-compose-plugin."
echo "Docker $(docker version --format '{{.Server.Version}}'), $(docker compose version --short 2>/dev/null || echo 'compose v2')"

step "Verificando los puertos 8080 y 8081"
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
ours_running() { [ -n "$(docker compose ps -q --status running 2>/dev/null)" ]; }
for port in 8080 8081; do
  if port_busy "$port"; then
    if ours_running; then
      echo "El puerto $port lo usa una instalación anterior de GameStats: se va a actualizar."
    else
      fail "El puerto $port está ocupado por otro programa. Cerralo y volvé a correr el instalador.
  Para ver cuál es: lsof -i :$port   (o: ss -ltnp | grep $port)"
    fi
  else
    echo "Puerto $port libre."
  fi
done

step "Carpeta de datos"
if [ -z "$DATA" ]; then
  DATA="./gamestats-data"
  if [ "$YES" -eq 0 ] && [ -t 0 ]; then
    read -r -p "¿Dónde guardo los datos? [$DATA]: " answer
    DATA="${answer:-$DATA}"
  fi
fi
mkdir -p "$DATA"
DATA="$(cd "$DATA" && pwd)"
# En Git Bash, Docker Desktop necesita la ruta con letra de unidad (C:/...).
if command -v cygpath >/dev/null 2>&1; then DATA="$(cygpath -m "$DATA")"; fi
# Una carpeta de eventos por juego registrado en configs/games (sin
# _common.json): agregar un juego no obliga a tocar el instalador.
for config in configs/games/*.json; do
  game="$(basename "$config" .json)"
  [ "$game" = "_common" ] && continue
  mkdir -p "$DATA/events/$game"
done
for sub in results rejected outbox state; do
  mkdir -p "$DATA/$sub"
done
echo "Datos en: $DATA"

step "Escribiendo .env"
# Los contenedores corren con el uid del usuario para poder escribir en la
# carpeta de datos (en Linux es obligatorio; en macOS no molesta).
cat > .env <<ENV
GAMESTATS_DATA="$DATA"
GAMESTATS_UID=$(id -u)
GAMESTATS_GID=$(id -g)
ENV
cat .env

step "Compilando desde el código fuente (la primera vez tarda unos minutos)"
docker compose --profile demo build

step "Levantando los servicios y esperando que estén sanos (máximo 5 minutos)"
docker compose up -d --wait --wait-timeout 300 || {
  docker compose ps
  fail "Los servicios no quedaron sanos. Revisá los logs con: docker compose logs"
}
docker compose ps

cat <<DONE

GameStats está listo.

  Tablero:          http://localhost:8081/dashboard
  API del analyzer: http://localhost:8081/api/v1/matches
  API del ingestor: http://localhost:8080/api/v1/stats
  Eventos:          $DATA/events   (copiá aquí archivos .jsonl)
  Resultados:       $DATA/results

Para generar partidas con el simulador:
  docker compose --profile demo run --rm simulator

Para cargar un dataset de ejemplo:
  cp data/samples/demo-small.jsonl "$DATA/events/"

Para desinstalar: ./uninstall.sh
DONE
