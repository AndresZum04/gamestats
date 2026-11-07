#!/usr/bin/env bash
# Opens the console in the browser with 6 automatic matches at once
# (2 of each game) to show concurrency in the video, and the panel in another
# tab. The system must already be running (./install.sh).
#
#   ./scripts/demo.sh            seed 1
#   SEED=7 ./scripts/demo.sh     another seed (another set of matches)
#   CONSOLE_URL=http://host:3000 ./scripts/demo.sh
set -euo pipefail

url="${CONSOLE_URL:-http://localhost:3000}"
seed="${SEED:-1}"
games="trivia,snake,blackjack,trivia,snake,blackjack"

if ! curl -fsS "$url/health" >/dev/null 2>&1; then
  echo "La consola no responde en $url. Levantá el sistema con ./install.sh." >&2
  exit 1
fi

open_url() {
  case "$(uname -s)" in
    Darwin) open "$1" ;;
    MINGW* | MSYS* | CYGWIN*) powershell.exe -NoProfile -Command "Start-Process '$1'" ;;
    *)
      if command -v xdg-open >/dev/null; then
        xdg-open "$1" >/dev/null 2>&1 &
      else
        echo "Abrí en el navegador: $1"
      fi
      ;;
  esac
}

open_url "$url/?autoplay=1&seed=$seed&open=$games"
sleep 1
open_url "$url/panel"
echo "Consola con 6 partidas automáticas (semilla $seed) y panel abiertos en $url"
