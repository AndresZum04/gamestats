# Guion de la demostración

La demo dura menos de 10 minutos y muestra el sistema completo: instalación, CI, el pipeline en vivo, el tablero, un patrón con su evidencia, la tolerancia a fallos y el despliegue. Los comandos están escritos para Linux, macOS o Git Bash; en Windows también corren desde Git Bash.

## Antes de empezar (no cuenta en el tiempo)

- [ ] Docker Desktop abierto y "Engine running".
- [ ] Imágenes ya compiladas: correr `docker compose --profile demo build` antes. La primera compilación de Scala tarda varios minutos y no conviene esperarla en vivo.
- [ ] Datos limpios: `docker compose down` y borrar `gamestats-data/`.
- [ ] Pestañas abiertas:
  - el repositorio en GitHub;
  - la pestaña Actions con la última corrida en verde;
  - `http://localhost:8081/dashboard`;
  - el tablero desplegado en Azure.
- [ ] Dos terminales en la raíz del repositorio.

## Tiempos

| # | Paso | Tiempo |
| --- | --- | --- |
| 1 | Repositorio, historial e instalación | 1:30 |
| 2 | CI en verde y artefactos | 1:00 |
| 3 | `make demo` en vivo | 2:00 |
| 4 | Estadísticas del ingestor | 0:45 |
| 5 | Tablero: una carrera y un combate | 1:30 |
| 6 | Un patrón y su evidencia | 1:00 |
| 7 | Tolerancia a fallos | 1:15 |
| 8 | Despliegue en Azure | 0:45 |
| | Total | 9:45 |

## 1. Repositorio, historial e instalación (1:30)

```bash
git log --oneline | head -15
git log --oneline | wc -l
git shortlog -sn
```

Qué decir:
- Cada tarea del plan tiene al menos un commit con formato `tipo(alcance): descripción`.
- `git shortlog` muestra los commits de los dos integrantes.
- Se entrega código fuente, no ejecutables.

Instalación (las imágenes ya están en caché, así que tarda unos 20 segundos):

```bash
./install.sh --yes
```

Qué decir:
- El instalador verifica Docker y los puertos, crea la carpeta de datos, compila Go y Scala dentro de contenedores y espera a que los servicios estén sanos.
- En una máquina sin nada más que Docker funciona igual; la CI lo prueba en cada push con el job `install-test`.

## 2. CI en verde y artefactos (1:00)

En la pestaña Actions, abrir la última corrida de CI. Mostrar los cuatro jobs:
- `go`: formato, vet y pruebas con `-race`.
- `scala`: formato, 84 pruebas y el jar.
- `integration`: compose, simulador y prueba de humo.
- `install-test`: el instalador en una máquina limpia.

Descargar `ci-artifacts.tar.gz` y mostrar que trae `logs/compose.log` y los JSON de `results/`.

Qué decir:
- Si alguien mete un `var` en el paquete de análisis, la prueba `StyleSuite` hace fallar la CI.
- La prueba de humo compara los rechazos del ingestor con los que reporta el simulador.

## 3. `make demo` en vivo (2:00)

Terminal 1:

```bash
make demo          # sin make: scripts/demo.sh
```

Terminal 2, mientras el simulador corre, mostrar los archivos creciendo:

```bash
watch -n1 'wc -l gamestats-data/events/*/*.jsonl | tail -20'
```

En Windows sin `watch`, desde PowerShell:

```powershell
while ($true) { cls; Get-ChildItem gamestats-data\events -Recurse -Filter *.jsonl | Select Name, Length; sleep 1 }
```

Qué decir:
- El script carga `demo-full.jsonl` copiándolo a la carpeta de eventos: así se conectará la consola de juegos de la segunda parte.
- Después el simulador escribe 16 partidas en paralelo, una goroutine por partida, cada una en su propio archivo.
- El ingestor revisa la carpeta cada segundo y lee solo las líneas nuevas de cada archivo.
- Al final el script imprime partidas por juego, el top 3 de cada leaderboard, los patrones y los rechazos.

## 4. Estadísticas del ingestor (0:45)

```bash
curl -s localhost:8080/api/v1/stats
```

Qué decir:
- `goroutines` muestra la concurrencia: durante el simulador pasan de 30, con una goroutine por archivo, una por partida y 4 senders.
- `rejectedByCode` muestra los nueve tipos de validación funcionando con los errores que inyecta el simulador.

## 5. Tablero (1:30)

En `http://localhost:8081/dashboard`:

1. Pestaña Carreras, abrir `rp-scn-comeback`. Mostrar el gráfico de tiempos por vuelta (se ve el choque de p-ana en la vuelta 2), la tabla con consistencia, posiciones ganadas e impacto de incidentes, y la vuelta rápida.
2. Pestaña Combate, abrir `ac-scn-spree`. Mostrar el marcador, el MVP, la primera sangre, el gráfico de eliminaciones por equipo y la tabla con K/D y headshots.
3. Mostrar el leaderboard y los filtros de patrones recientes.

Qué decir:
- Todo lo que se ve sale de funciones puras en Scala. El tablero se refresca cada 5 s sin recargar la página.

## 6. Un patrón y su evidencia (1:00)

```bash
curl -s localhost:8081/api/v1/patterns?patternId=P3 | head -c 600
```

Copiar uno de los `eventId` de `evidence` y buscarlo en los eventos originales:

```bash
grep '<eventId>' gamestats-data/events/*.jsonl
```

Qué decir:
- Cada patrón guarda los eventos que lo prueban.
- P3 usa un `foldLeft` sobre un estado inmutable que recorre eliminaciones y muertes en orden.
- Las 6 partidas `*-scn-*` del simulador fuerzan cada patrón exactamente una vez, y hay pruebas que lo verifican.

## 7. Tolerancia a fallos (1:15)

```bash
docker compose stop analyzer
docker compose --profile demo run --rm --no-deps simulator   # --no-deps: no volver a levantar el analyzer
ls gamestats-data/outbox                                     # esperar unos 20 s: aparecen los lotes
curl -s localhost:8080/api/v1/stats                          # partidas en SEND_FAILED
docker compose start analyzer
ls gamestats-data/outbox                                     # en menos de 30 s queda vacío
```

Qué decir:
- Con el analyzer caído, cada sender reintenta 3 veces y después guarda la partida en `outbox/`.
- Al volver el analyzer, una goroutine que revisa el outbox cada 30 s reenvía todo. No se pierde ni se duplica nada, porque reenviar el mismo `matchId` reemplaza el resultado.

## 8. Despliegue en Azure (0:45)

Desde la computadora local, mandar eventos a la VM por HTTP y mostrar el tablero remoto llenándose:

```bash
docker run --rm ghcr.io/andreszum04/gamestats-simulator:latest --mode http --target http://IP_DE_LA_VM:8080 --seed 0
```

Abrir `http://IP_DE_LA_VM:8081/dashboard`.

Qué decir:
- Cada push a `main` que pasa la CI publica las imágenes en GHCR y actualiza la VM por SSH.
- La versión `v1.0.0` es la entregada; volver atrás es `./deploy.sh <sha>`.

## Checklist contra el enunciado

| Requisito | Sección | Dónde se cumple |
| --- | --- | --- |
| Modelo de eventos coherente y documentado | 5 | [eventos.md](eventos.md), `schemas/event.schema.json`, `configs/games/` |
| Relaciones entre eventos, partidas y jugadores | 5 | Sobre común (`matchId`, `playerId`, `seq`) y `ingestor/internal/state/match.go` |
| Datos de prueba suficientes | 5, 8 | `simulator/` y `data/samples/` |
| Go recibe o carga eventos | 6.1 | Carpeta `events/` (`ingest/watcher.go`, `tailer.go`) y `POST /api/v1/events` (`ingest/http.go`) |
| Go valida estructura básica | 6.1 | `ingestor/internal/validation/`: 9 códigos de rechazo |
| Go administra el flujo | 6.1 | `pipeline/` (dispatcher, workers) y `sender/` (reintentos, outbox) |
| Go mantiene estado de partidas | 6.1 | `state/match.go` y `GET /api/v1/matches` |
| Concurrencia en Go | 6.1 | Goroutine por archivo y por partida, canales, pool de senders; pruebas con `-race` |
| Go prepara y envía a Scala | 6.1, 7 | `MatchBatch` por HTTP (`sender/sender.go`) |
| Scala recibe y transforma con colecciones funcionales | 6.2 | `analyzer/.../codec/Typed.scala`, `analysis/` |
| Scala calcula estadísticas | 6.2 | [estadisticas.md](estadisticas.md): G1 a G6, R1 a R7, A1 a A6 |
| Scala detecta patrones | 6.2 | `analysis/patterns/`: P1 a P6 |
| Resultados estructurados consultables | 6.2, 9 | `results/*.json`, API REST y `/dashboard` |
| Módulos independientes y comunicación documentada | 7 | [arquitectura.md](arquitectura.md), `docker-compose.yml` |
| Fuente simulada realista y con partidas en paralelo | 8 | `simulator/` (goroutine por partida, modo stream) |
| Estadística por jugador, por partida y combinada | 9 | R1 y A1 / R5 y A3 / R6, R7, A4 y A5 |
| Regla basada en secuencia de eventos | 9 | P1 a P6 |
| Git con historial | 10 | `git log` |
| Construcción reproducible y Docker | 10 | Dockerfiles multietapa, `docker-compose.yml` |
| CI/CD con compilación y manejo de contenedores y archivos | 10 | [cicd.md](cicd.md): `ci.yml` y `cd.yml`, artefacto `ci-artifacts.tar.gz` |
| Deployment funcional | 10 | [deployment.md](deployment.md) |
| Documentación de instalación, ejecución y deployment | 11 | [instalacion.md](instalacion.md), README, [deployment.md](deployment.md) |
| Justificación imperativo frente a funcional | 13 | [paradigmas.md](paradigmas.md) |
| Demostración funcional | 11 | Este guion y `scripts/demo.sh` |
| Lectura casi en tiempo real de archivos que se actualizan | video | `DirWatcher` y `FileTailer`; el simulador en modo stream |
| Formato válido para los juegos de la segunda parte | video | `schemaVersion`, eventos genéricos, `chess-lite` y [consola-futura.md](consola-futura.md) |
| Código fuente e instalación simple en una máquina de terceros | video | `install.sh`, `install.ps1` y el job `install-test` |
| Resultados escritos para un tablero futuro | video | `results/` y `/dashboard` |
