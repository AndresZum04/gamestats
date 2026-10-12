#!/usr/bin/env bash
# Demo de GameStats de punta a punta: levanta todo, carga demo-full.jsonl
# copiándolo a la carpeta de eventos, corre el simulador en vivo y muestra
# un resumen con partidas, leaderboards, patrones y rechazos.
#
# Uso: scripts/demo.sh        (o: make demo)
# Solo necesita Docker; si jq no está instalado lo corre desde su imagen.
set -euo pipefail
cd "$(dirname "$0")/.."

ANALYZER=http://localhost:8081
INGESTOR=http://localhost:8080

# Carpeta de datos: la del instalador si existe, si no ./gamestats-data.
DATA="./gamestats-data"
if [ -f .env ]; then
  DATA="$(sed -n 's/^GAMESTATS_DATA="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' .env)"
  DATA="${DATA:-./gamestats-data}"
fi
mkdir -p "$DATA/events"

jqx() {
  if command -v jq >/dev/null 2>&1; then jq "$@"; else docker run --rm -i ghcr.io/jqlang/jq:1.7.1 "$@"; fi
}
title() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
count_matches() { curl -fsS "$ANALYZER/api/v1/matches?limit=1000" 2>/dev/null | jqx 'length' 2>/dev/null || echo 0; }
wait_for() {
  local want=$1 deadline=$((SECONDS + 180))
  until [ "$(count_matches)" -ge "$want" ]; do
    [ "$SECONDS" -ge "$deadline" ] && { echo "No llegaron $want partidas en 3 minutos" >&2; exit 1; }
    sleep 3
  done
}

title "1. Levantando analyzer e ingestor (compila si hace falta)"
docker compose up -d --build --wait --wait-timeout 300
before=$(count_matches)

title "2. Cargando data/samples/demo-full.jsonl en la carpeta de eventos"
if [ -f "$DATA/events/demo-full.jsonl" ]; then
  echo "Ya estaba cargado; se omite para no repetir eventos."
else
  cp data/samples/demo-full.jsonl "$DATA/events/"
  echo "Copiado a $DATA/events/. El ingestor lo lee en menos de 2 s."
  wait_for $((before + 30))
fi
echo "Partidas analizadas: $(count_matches)"

title "3. Simulador en vivo: varias partidas en paralelo escribiendo en events/"
echo "Abrí $ANALYZER/dashboard para verlas aparecer."
start=$(count_matches)
docker compose --profile demo run --rm simulator | sed 's/^/   /'
wait_for $((start + 18))

title "Partidas por juego"
curl -fsS "$ANALYZER/api/v1/matches?limit=1000" |
  jqx -r 'group_by(.gameId)[] | "  \(.[0].gameId): \(length) partidas"'

for game in trivia snake blackjack; do
  title "Top 3 de $game"
  # $m es una variable de jq, no de bash: las comillas simples son a propósito.
  # shellcheck disable=SC2016
  curl -fsS "$ANALYZER/api/v1/games/$game/leaderboard?limit=3" |
    jqx -r '.metric as $m | .entries[] | "  \(.rank). \(.playerId)  victorias \(.wins)/\(.matches)  \($m // "") \(.avgMetric // "")"'
done

title "Patrones detectados"
curl -fsS "$ANALYZER/api/v1/patterns?limit=1000" |
  jqx -r 'group_by(.patternId)[] | "  \(.[0].patternId) \(.[0].name): \(length)"'
echo "  Ejemplos:"
curl -fsS "$ANALYZER/api/v1/patterns?limit=1000" |
  jqx -r '[group_by(.patternId)[] | .[0]][] | "   - [\(.patternId)] \(.description) (\(.matchId))"'

title "Ingestor"
curl -fsS "$INGESTOR/api/v1/stats" |
  jqx -r '"  recibidos \(.received), aceptados \(.accepted), rechazados \(.rejected)",
          "  por código: \(.rejectedByCode | to_entries | map("\(.key) \(.value)") | join(", "))",
          "  lotes enviados \(.batchesSent), outbox \(.outboxSize), goroutines \(.goroutines)"'

title "Listo"
echo "  Tablero: $ANALYZER/dashboard"
echo "  Datos:   $DATA (events/, results/, rejected/)"
