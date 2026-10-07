#!/usr/bin/env bash
# Prepara una VM Ubuntu nueva para GameStats. Se corre una sola vez:
#   curl -fsSL https://raw.githubusercontent.com/AndresZum04/gamestats/main/deploy/setup-vm.sh | bash
# o copiando este archivo a la VM y corriendo: bash setup-vm.sh
set -euo pipefail

echo "==> Instalando Docker con el script oficial"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo systemctl enable --now docker

echo "==> Permitiendo usar Docker sin sudo"
sudo usermod -aG docker "$USER"

# Una VM B1s tiene 1 GB de RAM: 1 GB de swap evita que el sistema mate un
# contenedor en un pico de memoria.
if ! swapon --show | grep -q /swapfile; then
  echo "==> Creando 1 GB de swap"
  sudo fallocate -l 1G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

mkdir -p ~/gamestats
echo "==> Listo. Cerrá la sesión SSH y volvé a entrar para que el grupo docker tenga efecto."
