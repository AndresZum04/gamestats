#!/usr/bin/env bash
# Instalador de GameConsole para Linux y macOS (también funciona en Git Bash).
# Levanta la consola web, la IA de Blackjack en Prolog y GameStats (analyzer
# e ingestor). Solo necesita Docker con Docker Compose 2.24 o mayor: todo se
# compila desde el código fuente dentro de contenedores.
#
# Uso: ./install.sh [--yes] [--data CARPETA]
#   --yes          no pregunta nada (usa la carpeta por defecto o GAMESTATS_DATA)
#   --data DIR     carpeta de datos compartida con GameStats (por defecto ../gamestats-data)
set -euo pipefail
cd "$(dirname "$0")"

YES=0
DATA="${GAMESTATS_DATA:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes) YES=1 ;;
    --data) DATA="${2:?falta la carpeta después de --data}"; shift ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
  shift
done

step() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

[ -f ../docker-compose.yml ] && [ -d ../configs/games ] || fail "No encuentro GameStats en la carpeta de arriba.
  La consola vive en la carpeta console/ del repositorio de GameStats; corré el instalador desde ahí."

step "Verificando Docker"
command -v docker >/dev/null 2>&1 || fail "Docker no está instalado.
  Linux: https://docs.docker.com/engine/install/  (o: curl -fsSL https://get.docker.com | sh)
  macOS: instalá Docker Desktop desde https://www.docker.com/products/docker-desktop/"
docker info >/dev/null 2>&1 || fail "Docker está instalado pero no responde.
  Abrí Docker Desktop, o en Linux: sudo systemctl start docker
  Si el error es de permisos: sudo usermod -aG docker \$USER y volvé a iniciar sesión."
COMPOSE="$(docker compose version --short 2>/dev/null || true)"
[ -n "$COMPOSE" ] || fail "Falta Docker Compose v2 (el comando 'docker compose').
  Actualizá Docker Desktop, o en Linux instalá el paquete docker-compose-plugin."
# include con varios archivos necesita Compose 2.24 o mayor.
major="${COMPOSE%%.*}"; rest="${COMPOSE#*.}"; minor="${rest%%.*}"
if [ "${major:-0}" -lt 2 ] || { [ "$major" -eq 2 ] && [ "${minor:-0}" -lt 24 ]; }; then
  fail "Docker Compose $COMPOSE es muy viejo: la consola necesita 2.24 o mayor. Actualizá Docker."
fi
echo "Docker $(docker version --format '{{.Server.Version}}'), Compose $COMPOSE"

step "Verificando los puertos 3000, 4000, 8080 y 8081"
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
ours_running() { [ -n "$(docker compose ps -q --status running 2>/dev/null)" ]; }
for port in 3000 4000 8080 8081; do
  if port_busy "$port"; then
    if ours_running; then
      echo "El puerto $port lo usa una instalación anterior de GameConsole: se va a actualizar."
    else
      fail "El puerto $port está ocupado por otro programa. Cerralo y volvé a correr el instalador.
  Si es GameStats instalado solo, bajalo antes con: (cd .. && docker compose down)
  Para ver cuál es: lsof -i :$port   (o: ss -ltnp | grep $port)"
    fi
  else
    echo "Puerto $port libre."
  fi
done

step "Carpeta de datos"
if [ -z "$DATA" ] && [ -f ../.env ]; then
  # Si GameStats ya se instaló, se usa la misma carpeta.
  DATA="$(sed -n 's/^GAMESTATS_DATA="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' ../.env)"
fi
if [ -z "$DATA" ]; then
  DATA="../gamestats-data"
  if [ "$YES" -eq 0 ] && [ -t 0 ]; then
    read -r -p "¿Dónde guardo los datos? [$DATA]: " answer
    DATA="${answer:-$DATA}"
  fi
fi
mkdir -p "$DATA"
DATA="$(cd "$DATA" && pwd)"
if command -v cygpath >/dev/null 2>&1; then DATA="$(cygpath -m "$DATA")"; fi
# Una carpeta de eventos por juego registrado en GameStats.
for config in ../configs/games/*.json; do
  game="$(basename "$config" .json)"
  [ "$game" = "_common" ] && continue
  mkdir -p "$DATA/events/$game"
done
for sub in results rejected outbox state; do
  mkdir -p "$DATA/$sub"
done
echo "Datos en: $DATA"

step "Escribiendo .env"
# El mismo contenido en console/.env (lo lee la consola) y en ../.env (lo lee
# el compose de GameStats incluido), para que todos usen la misma carpeta.
ENV_TEXT="GAMESTATS_DATA=\"$DATA\"
GAMESTATS_UID=$(id -u)
GAMESTATS_GID=$(id -g)"
printf '%s\n' "$ENV_TEXT" > .env
printf '%s\n' "$ENV_TEXT" > ../.env
cat .env

step "Compilando desde el código fuente (la primera vez tarda unos minutos)"
docker compose build

step "Levantando los servicios y esperando que estén sanos (máximo 5 minutos)"
docker compose up -d --wait --wait-timeout 300 || {
  docker compose ps
  fail "Los servicios no quedaron sanos. Revisá los logs con: docker compose logs"
}
docker compose ps

cat <<DONE

GameConsole está lista.

  Consola:            http://localhost:3000
  Panel:              http://localhost:3000/panel
  Tablero GameStats:  http://localhost:8081/dashboard
  API del analyzer:   http://localhost:8081/api/v1/matches
  API del ingestor:   http://localhost:8080/api/v1/stats
  IA de Prolog:       http://localhost:4000/health
  Eventos:            $DATA/events

Demo con 6 partidas automáticas: ./scripts/demo.sh
Para desinstalar: ./uninstall.sh
DONE
