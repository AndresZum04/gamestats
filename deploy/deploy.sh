#!/usr/bin/env bash
# Despliega (o vuelve atrás) GameStats en la VM con las imágenes de GHCR.
# Lo ejecuta el workflow cd.yml por SSH, y también se puede correr a mano:
#
#   ./deploy.sh <tag>        # despliega esa versión (sha corto o v1.0.0)
#   ./deploy.sh              # despliega latest
#
# Variables opcionales:
#   GHCR_USER, GHCR_PAT   credenciales si los paquetes de GHCR son privados
#   IMAGE_PREFIX          por defecto ghcr.io/andreszum04/gamestats
#   SKIP_PULL=1           usa imágenes que ya estén en la máquina (pruebas)
set -euo pipefail
cd "$(dirname "$0")"

export TAG="${1:-${TAG:-latest}}"
DATA="$(pwd)/gamestats-data"
# En Git Bash, Docker Desktop necesita la ruta con letra de unidad (C:/...).
if command -v cygpath >/dev/null 2>&1; then DATA="$(cygpath -m "$DATA")"; fi
COMPOSE=(docker compose -f docker-compose.prod.yml)

echo "==> Desplegando GameStats con TAG=$TAG"
for sub in events results rejected outbox state; do mkdir -p "$DATA/$sub"; done
cat > .env <<ENV
GAMESTATS_DATA=$DATA
GAMESTATS_UID=$(id -u)
GAMESTATS_GID=$(id -g)
TAG=$TAG
${IMAGE_PREFIX:+IMAGE_PREFIX=$IMAGE_PREFIX}
ENV

if [ -n "${GHCR_PAT:-}" ]; then
  echo "$GHCR_PAT" | docker login ghcr.io -u "${GHCR_USER:?falta GHCR_USER}" --password-stdin
fi

if [ "${SKIP_PULL:-0}" != "1" ]; then
  "${COMPOSE[@]}" --profile demo pull
fi
"${COMPOSE[@]}" up -d --wait --wait-timeout 180
"${COMPOSE[@]}" ps
docker image prune -f >/dev/null
echo "==> GameStats $TAG desplegado"
