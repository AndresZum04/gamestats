# Eventos y envio

en este documento se encuentran los eventos que surgen de cada accion del jugador, tanto los especificos de cada juego como los generales, ademas de como funciona el envio de estos eventos.

## Eventos
### reglas comunes entre eventos

Todos los eventos llevan estos campos, con estas reglas:

| Campo | Valor que pone la consola |
| --- | --- |
| `schemaVersion` | `"1.0"` |
| `eventId` | `crypto.randomUUID()` |
| `timestamp` | `new Date().toISOString()` (UTC con milisegundos) |
| `gameId` | `trivia`, `snake` o `blackjack` |
| `gameVersion` | `"1.0"` |
| `matchId` | prefijo del juego más un id corto único segun su juego: `tv-`(trivia), `sn-`(culebrita) o `bj-`(blackjack) seguido de `Date.now().toString(36)` y 6 caracteres aleatorios, por ejemplo `bj-lz3k9a-x81fq2` |
| `seq` | contador de la partida, empieza en 1 y nunca se repite |
| `playerId` | id del jugador, o `null` en eventos de partida o de la casa |
| `type` | tipo de evento registrado en GameStats |
| `action` | solo donde el juego lo usa (por ejemplo `DECISION`) |
| `source` | `{"consoleId": "gameconsole-web", "sessionId": <id de la pestaña>}` |
| `data` | claves obligatorias del tipo más las opcionales que se indiquen |

Ids de jugador: los humanos usan `p-` más el nombre en minúsculas sin espacios (`p-andres`); los CPU usan `cpu-1`, `cpu-2`, `cpu-3`.
### Eventos generales

| Tipo | Cuándo lo emite la consola |
| --- | --- |
| `MATCH_STARTED` | Al empezar la partida, siempre con `seq = 1` |
| `MATCH_FINISHED` | Al terminar, siempre como último evento, con `durationMs` y `results` |
| `PLAYER_JOINED` | Por cada jugador al armar la partida |
| `PLAYER_LEFT` | Si el jugador cierra la pestaña o abandona, con `reason` (`CLOSED_TAB`, `QUIT`, `IDLE`, `NO_CHIPS`) |
| `PLAYER_DISCONNECTED` / `PLAYER_RECONNECTED` | Cuando la pestaña queda oculta más de 10 s y cuando vuelve, con `awayMs` |
| `SCORE_CHANGED` | Cada vez que cambia el puntaje, con `delta` y `total` |

### Trivia (`trivia`)

| Tipo | `playerId` | `data` |
| --- | --- | --- |
| `MATCH_STARTED` | null | `players`, `mode: "CLASSIC"`, `questions: 10` |
| `QUESTION_SHOWN` | null | `questionId`, `number`, `category`, `difficulty`, `timeLimitMs` |
| `ANSWER_SUBMITTED` | jugador | `questionId`, `option`, `correct`, `responseMs` |
| `ANSWER_TIMEOUT` | jugador | `questionId` |
| `QUESTION_CLOSED` | null | `questionId`, `correctOption`, `correctCount` |
| `SCORE_CHANGED` | jugador | `delta`, `total` |
| `MATCH_FINISHED` | null | `durationMs`, `results` con `placement` por puntaje |

### Snake (`snake`)

| Tipo | `playerId` | `data` |
| --- | --- | --- |
| `MATCH_STARTED` | null | `players` (uno), `mode: "CLASSIC"`, `lives: 3`, `grid: "20x20"` |
| `FOOD_EATEN` | jugador | `foodType`, `length`, `points` |
| `POWERUP_PICKED` | jugador | `powerup`, `durationMs` |
| `LEVEL_UP` | jugador | `level`, `speed` |
| `SNAKE_DIED` | jugador | `cause`, `length`, `livesLeft` |
| `PLAYER_RESPAWNED` | jugador | `livesLeft` |
| `MATCH_FINISHED` | null | `durationMs`, `results` con `placement: 1`, `finalScore` |

### Blackjack (`blackjack`)

| Tipo | `playerId` | `data` |
| --- | --- | --- |
| `MATCH_STARTED` | null | `players`, `startingChips: 1000`,`mode: "Table"`, `rounds: 10`, `bots` (lista de ids CPU) |
| `ROUND_STARTED` | null | `round` |
| `BET_PLACED` | jugador | `round`, `amount`, `chipsBefore` |
| `CARD_DEALT` | jugador | `round`, `card`, `handValue` |
| `DEALER_CARD` | null | `round`, `card`, `hidden`, `dealerValue` |
| `DECISION` | jugador | `action` del sobre `HIT`, `STAND` o `DOUBLE`; `data`: `round`, `handValue` |
| `AI_DECISION` | jugador CPU | `round`, `decision`, `handValue`, `dealerUpcard`, `evHit`, `evStand`, `evDouble`, `elapsedMs`, `fallback` (nuevo en GameStats v1.1) |
| `BUST` | jugador | `round`, `handValue` |
| `BLACKJACK` | jugador | `round` |
| `HAND_RESULT` | jugador | `round`, `result`, `payout`, `chips` |
| `MATCH_FINISHED` | null | `durationMs`, `results` con `placement` por fichas finales |

Cada decisión de un CPU produce dos eventos: `AI_DECISION` (qué calculó Prolog) y luego el `DECISION` normal.

## Envío concurrente de eventos

Navegador, una instancia de `EventPublisher` por partida:

1. Cola en memoria más copia en `localStorage` con clave `outbox:<matchId>`. Así un fallo de red o una pestaña que se cae no pierde eventos.
2. Envía cada 500 ms o al juntar 20 eventos. Nunca hay dos envíos de la misma partida en vuelo a la vez, así el orden de llegada sigue el de `seq`. Partidas distintas sí envían en paralelo.
3. Si falla, reintenta con esperas de 1, 2, 4, 8 y 16 s, y sigue reintentando cada 30 s mientras la pestaña esté abierta. El juego no espera a la red en ningún caso.
4. Al cerrar la pestaña (`pagehide`), emite `PLAYER_LEFT` y `MATCH_FINISHED` si la partida estaba abierta y vacía la cola con `navigator.sendBeacon`.
5. Al cargar la consola, busca outboxes huérfanos de pestañas anteriores y los reenvía.
6. Los reenvíos duplicados no son problema: GameStats descarta `eventId` repetidos como `DUPLICATE_EVENT`.

Servidor:

1. `POST /api/events` recibe un arreglo de hasta 500 eventos. Revisa solo lo necesario para escribir el archivo (`gameId` y `matchId` presentes y con caracteres seguros para una ruta). La validación real la hace GameStats.
2. `MatchWriteQueue`: un mapa `matchId → promesa encadenada`. Cada lote de una partida espera a que termine la escritura anterior de esa misma partida, así las líneas nunca se intercalan. Partidas distintas escriben en paralelo.
3. `EventSink` es una interfaz con dos implementaciones elegidas por `EVENT_SINK`: `FileSink` (por defecto) agrega líneas con `fs.promises.appendFile` a `EVENTS_DIR/<gameId>/<matchId>.jsonl`; `HttpSink` reenvía al `ingestor` con reintentos.
4. Responde 202 `{"written": n}` cuando las líneas quedaron escritas, o 503 si el disco o el `ingestor` fallan, para que el navegador reintente.
