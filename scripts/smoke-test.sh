#!/usr/bin/env bash
# Prueba de humo del sistema levantado: falla si el analyzer no tiene todas
# las partidas, si falta algún patrón P1-P6 o si los rechazos del ingestor
# no coinciden con los que reportó el simulador.
#
# Uso: scripts/smoke-test.sh
# Variables:
#   ANALYZER_URL         (http://localhost:8081)
#   INGESTOR_URL         (http://localhost:8080)
#   EXPECTED_MATCHES     partidas mínimas esperadas (16: 4+4+2 y 6 escenarios)
#   EXPECTED_REJECTIONS  si se define, rechazos exactos esperados
#   TIMEOUT_SECONDS      espera máxima a que lleguen las partidas (180)
# Solo usa bash y curl, para correr igual en Linux, macOS y Git Bash.
set -euo pipefail

ANALYZER_URL="${ANALYZER_URL:-http://localhost:8081}"
INGESTOR_URL="${INGESTOR_URL:-http://localhost:8080}"
EXPECTED_MATCHES="${EXPECTED_MATCHES:-16}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-180}"

fail() { echo "FALLA: $*" >&2; exit 1; }

count_matches() {
  curl -fsS "$ANALYZER_URL/api/v1/matches?limit=1000" | grep -o '"matchId"' | wc -l | tr -d ' '
}

echo "Esperando $EXPECTED_MATCHES partidas en $ANALYZER_URL (máximo ${TIMEOUT_SECONDS}s)..."
deadline=$((SECONDS + TIMEOUT_SECONDS))
matches=0
while :; do
  matches=$(count_matches || echo 0)
  [ "$matches" -ge "$EXPECTED_MATCHES" ] && break
  [ "$SECONDS" -ge "$deadline" ] && fail "solo hay $matches partidas analizadas, se esperaban $EXPECTED_MATCHES"
  sleep 3
done
echo "OK  partidas analizadas: $matches"

patterns=$(curl -fsS "$ANALYZER_URL/api/v1/patterns?limit=1000" | grep -o '"patternId":"P[1-6]"' | sort -u | grep -o 'P[1-6]' | tr '\n' ' ')
for p in P1 P2 P3 P4 P5 P6; do
  case " $patterns " in
    *" $p "*) ;;
    *) fail "no se detectó el patrón $p (encontrados: ${patterns:-ninguno})" ;;
  esac
done
echo "OK  patrones: $patterns"

for path in /dashboard /api/v1/games/racing-pro/leaderboard /api/v1/games/arena-clash/summary; do
  curl -fsS -o /dev/null "$ANALYZER_URL$path" || fail "$path no responde"
done
echo "OK  tablero y endpoints de consulta"

stats=$(curl -fsS "$INGESTOR_URL/api/v1/stats")
rejected=$(printf '%s' "$stats" | grep -o '"rejected":[0-9]*' | grep -o '[0-9]*$')
outbox=$(printf '%s' "$stats" | grep -o '"outboxSize":[0-9]*' | grep -o '[0-9]*$')
[ "$outbox" = "0" ] || fail "el outbox del ingestor tiene $outbox lotes sin enviar"
if [ -n "${EXPECTED_REJECTIONS:-}" ]; then
  [ "$rejected" = "$EXPECTED_REJECTIONS" ] || fail "el ingestor rechazó $rejected eventos, el simulador inyectó $EXPECTED_REJECTIONS"
fi
echo "OK  ingestor: $rejected rechazos${EXPECTED_REJECTIONS:+ (esperados $EXPECTED_REJECTIONS)}, outbox vacío"
echo "Prueba de humo superada."
