#!/usr/bin/env bash
# Desinstalador de GameStats: baja los contenedores y borra las imágenes que
# construyó el instalador. Pregunta antes de borrar la carpeta de datos.
#
# Uso: ./uninstall.sh [--yes] [--delete-data]
#   --yes          no pregunta; conserva los datos salvo que se pida --delete-data
#   --delete-data  borra también la carpeta de datos
set -euo pipefail
cd "$(dirname "$0")"

YES=0
DELETE=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) YES=1 ;;
    --delete-data) DELETE=1 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "Opción desconocida: $arg" >&2; exit 2 ;;
  esac
done

DATA=""
if [ -f .env ]; then
  DATA="$(sed -n 's/^GAMESTATS_DATA="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' .env)"
fi

echo "==> Bajando contenedores y borrando las imágenes de GameStats"
docker compose --profile demo down --rmi all --remove-orphans

if [ -n "$DATA" ] && [ -d "$DATA" ]; then
  if [ "$DELETE" -eq 0 ] && [ "$YES" -eq 0 ] && [ -t 0 ]; then
    read -r -p "¿Borrar también la carpeta de datos $DATA? [s/N]: " answer
    case "$answer" in s|S|si|SI|sí|Sí) DELETE=1 ;; esac
  fi
  if [ "$DELETE" -eq 1 ]; then
    rm -rf "$DATA"
    echo "Carpeta de datos borrada."
  else
    echo "Se conservan los datos en: $DATA"
  fi
fi
rm -f .env
echo "GameStats desinstalado."
