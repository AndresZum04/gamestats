# Simulador (Go): hace de consola de juegos y escribe en la carpeta
# compartida.  docker build -f simulator/Dockerfile .
FROM golang:1.22-alpine AS build
WORKDIR /src/simulator
ENV GOWORK=off CGO_ENABLED=0
COPY simulator/go.mod simulator/go.sum ./
RUN go mod download
COPY simulator/ ./
RUN go build -trimpath -ldflags="-s -w" -o /out/simulator ./cmd/simulator

FROM alpine:3.20
RUN adduser -D -H -u 10001 gamestats
COPY --from=build /out/simulator /app/simulator
USER gamestats
ENTRYPOINT ["/app/simulator"]
