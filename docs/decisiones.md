# Registro de decisiones

Decisiones tomadas durante la implementación que no estaban cubiertas por el plan.

| Fecha | Decisión | Motivo |
| --- | --- | --- |
| 2026-10-05 | Módulos Go con ruta `github.com/AndresZum/gamestats/...` | El plan dejaba `USUARIO` sin definir; se usa el usuario de Git del equipo |
| 2026-10-05 | El repositorio vive en la raíz de `proyecto1Lenguajes/`, sin subcarpeta `gamestats/` | Opción más simple; la estructura interna es la del plan |
| 2026-10-05 | Se agrega `simulator/internal/chess/` | T09 pide un generador de ajedrez que no aparecía en el árbol del repositorio |
| 2026-10-05 | `.gitattributes` fuerza LF (CRLF solo en `.ps1`) | En Windows, Git convierte a CRLF y los scripts `.sh` fallan dentro de contenedores Linux |
| 2026-10-05 | Una sola `.scalafmt.conf` en la raíz; `build.sbt` apunta a ella con `scalafmtConfig` | Evita duplicar la configuración de formato |
| 2026-10-05 | `make` acepta `SBT=...` para compilar Scala con la imagen `sbtscala/scala-sbt` | No todos los equipos tienen sbt instalado; con Docker alcanza |
| 2026-10-05 | La entrada por archivos usa `data/events/`, no `inbox/` | El checklist mencionaba `inbox/`, pero la especificación define `data/events/<gameId>/` |
| 2026-10-05 | Se agrega `configs/games/chess-lite.json` (T02 pedía tres configs) | Sin él, los eventos de ajedrez se rechazarían como `UNKNOWN_GAME` |
| 2026-10-05 | `playerId` puede faltar cuando el tipo no lo exige; se trata igual que `null` | Es la opción más tolerante para quien produce eventos |
| 2026-10-05 | Los campos del sobre que no están en la especificación se ignoran | Permite agregar campos en una versión futura sin romper la actual; no hay código de rechazo para ellos |
| 2026-10-05 | `matchId` solo admite letras, dígitos, `-` y `_` (máx. 128); `gameId` es minúsculas con guiones | Ambos se usan como nombres de archivo o carpeta; así se evita salir de la carpeta con `../` |
| 2026-10-05 | Go valida solo el tipo JSON de las claves de `data`, no los valores permitidos (`tire`, `itemType`, `severity`) | El formato de configuración del plan solo describe tipos; Scala ignora valores desconocidos |
| 2026-10-05 | Un juego no puede redefinir un tipo de `_common.json`; si lo hace, el `ingestor` no arranca | Cumple "sin tipos repetidos" y evita reglas ambiguas |
| 2026-10-05 | El patrón de `timestamp` usa `[.]` en vez de `\.` | Evita errores de escape al editar el JSON |
| 2026-10-05 | `Event` guarda `timestamp` tal como llegó (string) y además el valor parseado en `Time` (no se serializa) | Scala recibe exactamente el texto que escribió el juego; Go usa `Time` para ordenar y medir inactividad |
| 2026-10-05 | Los números dentro de `data` se decodifican como `json.Number` | Se reenvían a Scala sin perder precisión (un `float64` redondea enteros mayores a 2^53) |
| 2026-10-05 | `MatchBatch.finishedAt` es `null` en los lotes `PARTIAL` | Una partida enviada por inactividad no tiene hora de fin |
| 2026-10-05 | Un campo del sobre con tipo JSON equivocado (por ejemplo `seq: "14"`) es `INVALID_FIELD`; un string vacío es `MISSING_FIELD`; algo que no es un objeto JSON es `MALFORMED_JSON` | La tabla de códigos no cubría estos casos |
| 2026-10-05 | El validador tolera un BOM inicial y el `\r` de finales CRLF | Editores de Windows los agregan; rechazarlos no aporta nada |
| 2026-10-05 | `Dedup` va aparte de `Validate`; `LATE_EVENT` lo decide el dispatcher (T05) | Solo se marcan como vistos los eventos que pasaron la validación, y solo el dispatcher sabe qué partidas ya se enviaron |
| 2026-10-05 | El nombre de cada archivo de `configs/games/` debe ser `<gameId>.json` y no se permiten campos desconocidos | Un error de tipeo en la configuración detiene el arranque en vez de validar con reglas equivocadas |
| 2026-10-05 | `go test -race` se corre en el contenedor `golang:1.22` | El detector de carreras necesita cgo y gcc, que no están en Windows; además confirma la versión de Go del plan |
| 2026-10-05 | Las fechas de los ejemplos pasan de `2026-10-10` a `2026-09-10`; el simulador usará esa fecha base en modo `file` | Con el reloj real, eventos del 10 de octubre se rechazan como `INVALID_FIELD` (más de 5 min en el futuro) hasta esa fecha |
| 2026-10-05 | El paquete `config` se crea en T04 y no en T07 | `main` ya necesita `DATA_DIR`, `CONFIG_DIR`, `WATCH_INTERVAL` e `INPUT_BUFFER` |
| 2026-10-05 | Tailers y HTTP comparten un `Intake` (validar, `Dedup`, encolar o rechazar) | Una sola ruta de entrada: las dos fuentes aplican exactamente las mismas reglas |
| 2026-10-05 | HTTP revisa si hay espacio para todo el lote antes de procesarlo y si no responde 503 | Evita aceptar la mitad de un arreglo y dejar al cliente sin saber qué reintentar |
| 2026-10-05 | Arreglo de más de 1000 eventos: 400. Cuerpo de más de 5 MB: 413. Cuerpo que no es JSON: 202 con un rechazo `MALFORMED_JSON` | El primer caso es un error del cliente, no de un evento; el último queda registrado en `rejected.jsonl` como pide la especificación |
| 2026-10-05 | El tailer abre el archivo solo cuando creció y lo cierra después de leer | En Windows un archivo abierto no se puede renombrar ni borrar; así el juego nunca queda bloqueado |
| 2026-10-05 | Las líneas en blanco de un archivo de eventos se ignoran, no se rechazan | No son eventos; rechazarlas solo ensucia `rejected.jsonl` |
| 2026-10-05 | Entre reinicios, el reemplazo de un archivo se detecta solo si quedó más corto que el offset | `os.SameFile` compara datos que no se pueden guardar en disco; dentro de una misma ejecución sí se usa |
| 2026-10-05 | Si el proceso muere sin apagado limpio, se pueden releer hasta 5 s de eventos | Los offsets se guardan cada 5 s y `Dedup` vive en memoria; con SIGINT o SIGTERM se guardan al salir y no pasa |
