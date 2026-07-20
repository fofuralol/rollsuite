#!/usr/bin/env bash
# Compila o updater.exe (Windows GUI, sem console) para electron/bin/.
# Requer Go 1.20+. No sandbox Nix: `nix run nixpkgs#go -- version`.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p ../electron/bin
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
  go build -trimpath -ldflags="-s -w -H=windowsgui" \
  -o ../electron/bin/updater.exe .
echo "OK: $(ls -la ../electron/bin/updater.exe)"
