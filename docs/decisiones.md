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
| 2026-10-06 | Al recibir `MATCH_FINISHED` el worker envía el lote solo cuando tiene todos los `seq` de 1 al del fin; si falta alguno espera `MATCH_FINISH_GRACE` (5 s) y envía lo que tenga | El simulador desordena eventos en ventanas de 5; enviar al instante convertiría en `LATE_EVENT` eventos válidos que llegaron un poco después del fin |
| 2026-10-06 | Mientras espera, un evento con `seq` mayor al de `MATCH_FINISHED` es `LATE_EVENT` | Ningún evento válido puede ir después del fin; así el evento tardío que inyecta el simulador se sigue rechazando |
| 2026-10-06 | El worker avisa al dispatcher por el canal `done` antes de armar el lote y, mientras espera, sigue leyendo su canal (rechaza como tardíos) | Si dejara de leer, el dispatcher podría bloquearse enviándole un evento mientras el worker se bloquea avisándole: un deadlock |
| 2026-10-06 | Para apagar, se cierra el canal de entrada; el dispatcher cierra el canal de cada worker y cada uno emite su partida como `PARTIAL` | El cierre en cascada de canales no necesita `context` en los workers y garantiza que ninguna partida abierta se pierda |
| 2026-10-06 | Un evento cuyo `matchId` ya pertenece a otro juego se rechaza como `INVALID_FIELD` | Un lote debe tener un solo `gameId`; la tabla de códigos no cubría el caso |
| 2026-10-06 | `lastEventAt` es la hora en que el ingestor recibió el último evento, no el `timestamp` del juego | La inactividad se mide con el reloj real; en modo `file` los timestamps son de otra fecha |
| 2026-10-06 | El ticker del worker revisa cada `min(5 s, MATCH_IDLE_TIMEOUT/2)` | Con el timeout de 50 ms que usan las pruebas, revisar cada 5 s no detectaría la inactividad a tiempo |
| 2026-10-06 | `GET /api/v1/matches` y `/matches/{matchId}` se implementan en T05, el resto de la API en T07 | Los criterios de T04 y T05 los usan para verificar |
| 2026-10-06 | Un 4xx distinto de 429 marca la partida `SEND_FAILED` pero no va al outbox | Reenviar un lote que el analizador rechazó daría el mismo error cada 30 s |
| 2026-10-06 | Con el contexto cancelado (apagado), el sender guarda el lote en el outbox sin intentar enviarlo | T07 pide que el apagado deje las partidas en el outbox y que todo termine en 15 s; los reintentos con espera no caben |
| 2026-10-06 | El reintentador hace un solo intento por archivo y por ronda, y corta la ronda al primer error de red o 5xx | La ronda de 30 s ya es el reintento; si el analizador sigue caído, los demás archivos fallarían igual |
| 2026-10-06 | Antes de borrar un archivo del outbox se verifica que no cambió desde que se leyó | Si mientras tanto se guardó un lote más nuevo de la misma partida, no se pierde |
| 2026-10-06 | Los archivos del outbox corruptos o rechazados con 4xx se renombran a `.json.failed` | Se conservan para revisarlos a mano, pero no se reintentan para siempre |
| 2026-10-06 | En `/api/v1/stats`, `rejected` incluye `LATE_EVENT`, que se decide después de aceptar el evento; por eso `accepted + rejected` puede superar a `received` | Todos los rechazos pasan por `RejectedWriter`, que es donde se cuentan; separar los tardíos complicaría la lectura |
| 2026-10-06 | `activeMatches` cuenta las partidas en estado `OPEN`; además se expone `matchesByState` | Es la cifra que pide el plan y el desglose ayuda en la demo |
| 2026-10-06 | El middleware no registra `GET /health` | Docker lo llama cada 5 s y taparía el resto de los logs |
| 2026-10-06 | `GET /api/v1/rejected` acepta `limit` de 1 a 200 (por defecto 50); fuera de rango responde 400 | En memoria solo se guardan los últimos 200 |
| 2026-10-06 | Si el apagado tarda más de 15 s, el proceso sale con código 1 | Cumple el límite del plan y deja claro en los logs que algo se trabó |
| 2026-10-06 | Un `api.Server` arma todas las rutas y el middleware | `main` solo conecta piezas; las rutas se prueban sin abrir un puerto |
| 2026-10-06 | En modo `stream` y `http` cada partida se ancla en el pasado: `ancla = arranque − duración × (1 − 1/speed)` | Si la partida empezara "ahora" y se acelerara, sus timestamps quedarían hasta 15 min en el futuro y el ingestor los rechazaría; comprimir los timestamps rompería las ventanas de tiempo de los patrones. Así ningún evento queda adelantado al reloj y las duraciones de juego son reales |
| 2026-10-06 | En modo `file` la partida i empieza en `2026-09-10T14:00:00Z + i × 3 min` | Fecha fija para que la salida sea reproducible y en el pasado para que se acepte |
| 2026-10-06 | Los escenarios tienen tiempos de vuelta y secuencias de eliminaciones fijos, y no reciben errores inyectados | Así cada escenario produce solo su patrón; sus pruebas lo verifican |
| 2026-10-06 | En los escenarios de combate, las eliminaciones de relleno siguen una rotación fija (RED i elimina a BLUE i+2, BLUE j a RED j+1) | Ningún par se elimina en ambos sentidos (sin venganzas accidentales) y cada jugador elimina una vez cada 10 eliminaciones (sin rachas accidentales) |
| 2026-10-06 | Los eventos inválidos se agregan como líneas extra (copias rotas con otro `eventId`) en vez de reemplazar eventos válidos | Las partidas quedan completas (`seq` 1..n) y cada línea inyectada produce exactamente un rechazo; el total coincide con `/stats` |
| 2026-10-06 | Un evento tardío con probabilidad 30 % por partida; duplicados 1 % de los eventos; desorden en el 10 % de las partidas | El plan no fijaba la frecuencia del evento tardío |
| 2026-10-06 | Con `--loop`, cada vuelta usa la semilla siguiente y agrega `-l<n>` a los `matchId` | Repetir un `matchId` ya cerrado haría que toda la partida se rechace como `LATE_EVENT` |
| 2026-10-06 | La probabilidad de enfrentamiento en combate es 0.25 por paso (no 0.45) y la de que un piloto se retire, 30 % por carrera | Con 0.45 las partidas terminaban en 4 min; con 15 % de retiros la semilla 42 no generaba ningún `PLAYER_LEFT` en carreras |
| 2026-10-06 | Las pruebas de los escenarios recalculan en Go los patrones de esas partidas | Son un oráculo del diseño del simulador, solo en pruebas; el análisis real sigue siendo de Scala |
| 2026-10-06 | `demo-full.jsonl` usa 8 partidas de ajedrez además de 8 de cada juego principal | Hace que el análisis genérico tenga suficientes datos en la demo |
| 2026-10-06 | En los eventos tipados de Scala, `playerId` es un campo `String` de cada evento de jugador y no un `Option` dentro de `Meta`; `Meta` lleva `eventId`, `seq` y `atMs` | Si un evento de jugador llega sin jugador, la conversión devuelve `None` y se descarta; así el código de análisis nunca necesita `.get` sobre un `Option` |
| 2026-10-06 | `track` y `map` de `MATCH_STARTED` se unen en un solo campo `venue` | Son el mismo concepto (dónde se juega) según el juego |
| 2026-10-06 | En `data`, una clave opcional ausente es válida, pero con el tipo equivocado hace que el evento se descarte | Mismo criterio que las claves obligatorias: un dato mal formado no debe producir estadísticas a medias |
| 2026-10-06 | Scala escribe las fechas con milisegundos (`2026-09-10T14:03:22.120Z`), igual que Go | El `Encoder[Instant]` por defecto de circe omite los milisegundos cuando son cero |
| 2026-10-06 | Los tipos de los agregados entre partidas se definen en T16 y no en T10 | Se crean junto con las funciones que los usan |
| 2026-10-06 | El analyzer se compila y prueba con la imagen `sbtscala/scala-sbt` (Temurin 21) | sbt no está instalado en Windows; es la misma imagen que usará el Dockerfile de T19 |
| 2026-10-06 | `GameAnalyzer`, `AnalyzerRegistry` y un `GenericAnalyzer` con G1 y G2 se crean en T11; T12 los completa | El POST necesita un análisis desde T11; así no se escribe código provisional que después se bota |
| 2026-10-06 | `analyze` pone `analyzedAt = sentAt` del lote y la ruta lo reemplaza por la hora real | El análisis sigue siendo puro y determinista; el reloj es un efecto y vive en la capa HTTP |
| 2026-10-06 | El POST responde 400 si `matchId` no cumple el patrón del esquema | El analyzer acepta POST de cualquiera y `matchId` se usa como nombre de archivo; evita escribir fuera de `results/` |
| 2026-10-06 | `RESULTS_DIR` toma por defecto `../data/results` (no `/data/results`) | Igual que el ingestor con `../data`: funciona al correr con sbt desde `analyzer/`; docker compose define `/data/results` |
| 2026-10-06 | `GET /api/v1/matches/{matchId}` se implementa en T11; los demás GET en T16 | El criterio de T11 lo usa para comprobar que los resultados sobreviven a un reinicio |
| 2026-10-06 | Los logs del analyzer usan slf4j directo y un middleware propio | Evita agregar log4cats; logback ya trae slf4j |
| 2026-10-06 | Las pruebas de rutas corren el `IO` con `unsafeRunSync` en vez de agregar munit-cats-effect | El plan solo lista munit como dependencia de pruebas |
| 2026-10-06 | G1 y G2 leen los `Event` crudos; G3, G5 y G6 leen los `CommonEvent` tipados | Contar tipos y medir tiempos no necesita tipos; para leer `awayMs` o `delta` el `match` sobre el evento tipado garantiza que el campo existe |
| 2026-10-06 | G4 (tasa de abandono) se guarda por partida como la métrica `left` de cada jugador y `playersLeft` de la partida; la tasa se calcula en T16 sobre todas las partidas | Es una cifra por juego, no por partida |
| 2026-10-06 | Todo jugador recibe `disconnections`, `awayMs` y `left` (en cero si no aplica); G5 y G6 solo aparecen si el jugador tuvo eventos de puntaje o de turno | El contrato muestra los dos primeros siempre; el plan dice que G6 se omite si no hay turnos |
| 2026-10-06 | La composición `buildContext andThen computeStats andThen attachPatterns` vive una sola vez en `ComposedAnalyzer[E]`; cada juego solo aporta conversión, métricas y detectores | Evita repetir el armado en cada analizador y deja claro qué es propio de cada juego |
| 2026-10-06 | Los jugadores del resultado se ordenan por `placement` y luego por id | Lectura natural en la API y el tablero |
