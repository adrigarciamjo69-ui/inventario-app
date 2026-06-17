#!/usr/bin/env bash
#
# Compila los binarios del agente para Windows / Linux / macOS usando Docker.
# No requiere tener Go instalado en la maquina anfitriona, solo Docker.
#
# Uso:
#   chmod +x build.sh
#   ./build.sh
#
# Los binarios resultantes quedan en ./bin/ listos para subir a la app desde
# Ajustes -> Agentes -> "Binarios del agente".
#
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p bin

GO_IMAGE="${GO_IMAGE:-golang:1.22-alpine}"

echo "[build] usando imagen $GO_IMAGE"
echo "[build] cross-compilando 4 binarios (Windows, Linux, macOS Intel, macOS Apple Silicon)..."

docker run --rm \
  -v "$PWD":/src \
  -w /src \
  -e CGO_ENABLED=0 \
  "$GO_IMAGE" \
  sh -c '
    set -e
    echo "[docker] go version: $(go version)"
    echo "[docker] descargando dependencias..."
    go mod tidy
    BUILD_FLAGS="-trimpath -ldflags=-s -w"
    echo "[docker] -> windows/amd64"
    GOOS=windows GOARCH=amd64 go build $BUILD_FLAGS -o bin/inventario-agent-windows.exe .
    echo "[docker] -> linux/amd64"
    GOOS=linux   GOARCH=amd64 go build $BUILD_FLAGS -o bin/inventario-agent-linux .
    echo "[docker] -> darwin/amd64 (Intel)"
    GOOS=darwin  GOARCH=amd64 go build $BUILD_FLAGS -o bin/inventario-agent-darwin-amd64 .
    echo "[docker] -> darwin/arm64 (Apple Silicon)"
    GOOS=darwin  GOARCH=arm64 go build $BUILD_FLAGS -o bin/inventario-agent-darwin-arm64 .
    # alias "darwin" -> arm64 (lo mas comun en Mac modernos). Si tu parque es
    # mayoritariamente Intel, copia el -amd64 sobre este alias en su lugar.
    cp bin/inventario-agent-darwin-arm64 bin/inventario-agent-darwin
  '

echo
echo "[build] OK. Binarios generados:"
ls -lh bin/
echo
echo "Subelos desde Ajustes -> Agentes -> Binarios del agente, uno por SO."
