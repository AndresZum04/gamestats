# Ingestor (Go). Se construye desde la raíz del repositorio porque necesita
# configs/games:  docker build -f ingestor/Dockerfile .
FROM golang:1.22-alpine AS build
WORKDIR /src/ingestor
# GOWORK=off: dentro de la imagen solo está este módulo, no el go.work.
ENV GOWORK=off CGO_ENABLED=0
# Primero las dependencias, para que Docker reutilice esta capa si solo
# cambia el código.
COPY ingestor/go.mod ingestor/go.sum ./
RUN go mod download
COPY ingestor/ ./
RUN go build -trimpath -ldflags="-s -w" -o /out/ingestor ./cmd/ingestor

FROM alpine:3.20
RUN adduser -D -H -u 10001 gamestats
WORKDIR /app
COPY --from=build /out/ingestor /app/ingestor
COPY configs/games /app/configs/games
ENV PORT=8080 CONFIG_DIR=/app/configs/games DATA_DIR=/data
USER gamestats
EXPOSE 8080
ENTRYPOINT ["/app/ingestor"]
