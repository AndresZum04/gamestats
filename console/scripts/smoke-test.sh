#!/usr/bin/env bash
# Prueba de humo de GameConsole levantada: a través de la consola, confirma
# que GameStats tiene partidas analizadas de los tres juegos y eventos
# AI_DECISION de los CPU de Blackjack (es decir, que Prolog jugó).
#
# Uso: scripts/smoke-test.sh
# Variables:
#   CONSOLE_URL      (http://localhost:3000)
#   TIMEOUT_SECONDS  espera máxima (120)
# Solo usa bash, curl y grep, para correr igual en Linux, macOS y Git Bash.
set -euo pipefail

CONSOLE_URL="${CONSOLE_URL:-http://localhost:3000}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-120}"

fail() { echo "FALLA: $*" >&2; exit 1; }

# The checks that must all pass on the same snapshot of /api/stats.
check() {
  local body="$1"
  printf '%s' "$body" | grep -q '"gamestatsUp":true' || { echo "GameStats no responde"; return 1; }
  for game in trivia snake blackjack; do
    # Game summary of the analyzer: {"gameId":"<game>","matches":N,...}
    printf '%s' "$body" | grep -q "\"gameId\":\"$game\",\"matches\":[1-9]" ||
      { echo "sin partidas analizadas de $game"; return 1; }
  done
  printf '%s' "$body" | grep -q '"AI_DECISION":[1-9]' || { echo "sin eventos AI_DECISION"; return 1; }
  printf '%s' "$body" | grep -q '"aiDecisions":[1-9]' || { echo "sin decisiones de IA en B6"; return 1; }
}

echo "Revisando GameStats a través de $CONSOLE_URL (máximo ${TIMEOUT_SECONDS}s)..."
deadline=$((SECONDS + TIMEOUT_SECONDS))
while :; do
  body="$(curl -fsS "$CONSOLE_URL/api/stats" 2>/dev/null || true)"
  if reason="$(check "$body")"; then break; fi
  [ "$SECONDS" -lt "$deadline" ] || fail "$reason"
  sleep 3
done

rejected="$(printf '%s' "$body" | grep -o '"rejected":[0-9]*' | head -1 | grep -o '[0-9]*$')"
echo "OK: partidas de trivia, snake y blackjack analizadas, eventos AI_DECISION presentes, ${rejected:-0} eventos rechazados."
