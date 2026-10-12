# Formato de eventos

Este documento define cómo se ve un evento de GameStats. Lo usan el `ingestor` (Go) para validar, el `analyzer` (Scala) para analizar y cualquier sistema que produzca eventos: hoy el simulador y, en la segunda parte del curso, la consola de juegos.

Archivos relacionados:

- [`schemas/event.schema.json`](../schemas/event.schema.json): JSON Schema (draft 2020-12) del sobre común.
- [`configs/games/`](../configs/games/): tipos de evento permitidos por juego y claves obligatorias de `data`.
- [`data/samples/examples.jsonl`](../data/samples/examples.jsonl): un evento válido de cada tipo.

## Para qué sirve el formato

Un evento es una línea JSON que describe algo que pasó en una partida: alguien respondió una pregunta, la serpiente comió una fruta o un jugador pidió carta. Todos los eventos comparten un sobre con los mismos campos (quién, cuándo, en qué partida y en qué orden), y lo propio de cada juego va dentro de `data`.

Con esa separación, el `ingestor` puede validar y agrupar eventos de cualquier juego sin saber nada de Trivia, de Snake ni de Blackjack. Las reglas de cada juego viven en un archivo de configuración y no en el código. Como no sabemos qué juegos va a traer la consola de la segunda parte, también hay eventos genéricos de puntaje, turnos y acciones que sirven para casi cualquier juego.

## Cómo se entregan los eventos

La forma principal es por archivos. Cada juego escribe en una carpeta compartida y el `ingestor` la revisa cada segundo. Quien escriba archivos de eventos tiene que cumplir esto:

1. Ruta: `data/events/<gameId>/<matchId>.jsonl`, un archivo por partida.
2. Solo se agrega al final. Nunca se reescriben ni se borran líneas ya escritas.
3. Un evento por línea, terminado en `\n`. Una línea sin `\n` final se considera incompleta y se vuelve a leer en la siguiente pasada.
4. Si una partida es muy larga, puede seguir en `<matchId>.part2.jsonl`, `<matchId>.part3.jsonl` y así. El `ingestor` agrupa por el `matchId` de cada evento, no por el nombre del archivo.
5. Codificación UTF-8 sin BOM.

La otra forma es `POST /api/v1/events` en el `ingestor` (puerto 8080), con un evento o un arreglo de hasta 1000.

## Sobre común

| Campo | Tipo | Obligatorio | Regla |
| --- | --- | --- | --- |
| `schemaVersion` | string | sí | Versión del formato del sobre. Hoy solo existe `"1.0"` |
| `eventId` | string | sí | UUID v4 en minúsculas, único entre todos los eventos |
| `timestamp` | string | sí | RFC 3339 en UTC con milisegundos, por ejemplo `2026-09-10T14:03:22.120Z` |
| `gameId` | string | sí | Minúsculas y guiones (`trivia`, `snake`, `blackjack`). Tiene que existir en `configs/games/` |
| `gameVersion` | string | sí | Tiene que estar en `versions` de la configuración del juego |
| `matchId` | string | sí | Único entre juegos, por ejemplo `tv-0007`. Solo letras, dígitos, `-` y `_`, máximo 128 caracteres |
| `seq` | entero | sí | Mayor o igual a 1. Orden del evento dentro de la partida |
| `playerId` | string o null | según el tipo | Obligatorio si el tipo tiene `playerRequired: true`. Si no, puede ir `null` o no venir |
| `type` | string | sí | MAYÚSCULAS_CON_GUION_BAJO, permitido para ese juego |
| `action` | string | no | Subtipo, por ejemplo la decisión `HIT`, `STAND` o `DOUBLE` en Blackjack |
| `source` | objeto | no | Quién produjo el evento: `{"consoleId", "sessionId"}`. Lo llena la consola; hoy lo pone el simulador |
| `data` | objeto | sí | Puede ser `{}`. Sus claves obligatorias dependen del tipo |

`matchId` y `gameId` tienen caracteres restringidos porque se usan como nombres de archivos y carpetas. Los campos que no están en esta tabla se ignoran: no son error, así una versión futura del formato puede agregar campos sin romper lo que ya existe.

Un evento completo se ve así:

```json
{"schemaVersion":"1.0","eventId":"6513270e-269e-4d37-b2a7-4de452e6b438","timestamp":"2026-09-10T14:00:00.000Z","gameId":"trivia","gameVersion":"1.0","matchId":"tv-0007","seq":1,"playerId":null,"type":"MATCH_STARTED","source":{"consoleId":"sim-01","sessionId":"s-tv-0007"},"data":{"players":["p-ana","p-luis","p-sofi"],"mode":"CLASSIC","questions":10}}
```

En los catálogos de abajo, los ejemplos muestran solo `playerId`, `type`, `action` y `data` para que se lean mejor. El resto del sobre siempre va igual. Las líneas completas están en `data/samples/examples.jsonl`.

## Eventos generales

Sirven para todos los juegos. Están en [`configs/games/_common.json`](../configs/games/_common.json).

| Tipo | `playerId` | Claves de `data` |
| --- | --- | --- |
| `MATCH_STARTED` | null | `players` (lista de ids), `mode` (string). Cada juego agrega las suyas (ver abajo) |
| `MATCH_FINISHED` | null | `durationMs` (número), `results` (lista de `{playerId, placement}`). Opcional: `finalScore` |
| `PLAYER_JOINED` | requerido | Opcional: `teamId` |
| `PLAYER_LEFT` | requerido | `reason` (string) |
| `PLAYER_DISCONNECTED` | requerido | ninguna |
| `PLAYER_RECONNECTED` | requerido | `awayMs` (número) |
| `SCORE_CHANGED` | requerido | `delta`, `total` (números). Opcionales: `teamId`, `reason` |
| `TURN_STARTED` | requerido | `turn` (número) |
| `TURN_ENDED` | requerido | `turn`, `durationMs` (números) |
| `PLAYER_ACTION` | requerido | Libre. El campo `action` del sobre dice qué acción fue |

Los últimos cuatro son genéricos de jugabilidad. Un juego que todavía no tiene tipos propios puede reportar puntos, turnos y acciones con ellos, y GameStats ya calcula estadísticas a partir de eso (G5 y G6 en [estadisticas.md](estadisticas.md)). Trivia usa `SCORE_CHANGED` para los puntos de cada respuesta.

```json
{"playerId":null,"type":"MATCH_STARTED","data":{"players":["p-ana","p-luis","p-sofi"],"mode":"CLASSIC","questions":10}}
{"playerId":null,"type":"MATCH_FINISHED","data":{"durationMs":250000,"results":[{"playerId":"p-ana","placement":1},{"playerId":"p-luis","placement":2},{"playerId":"p-sofi","placement":3}]}}
{"playerId":"p-ana","type":"PLAYER_JOINED","data":{}}
{"playerId":"p-gabo","type":"PLAYER_LEFT","data":{"reason":"NO_CHIPS"}}
{"playerId":"p-luis","type":"PLAYER_DISCONNECTED","data":{}}
{"playerId":"p-luis","type":"PLAYER_RECONNECTED","data":{"awayMs":4500}}
{"playerId":"p-ana","type":"SCORE_CHANGED","data":{"delta":150,"total":150,"reason":"CORRECT_FAST"}}
{"playerId":"p-mari","type":"TURN_STARTED","data":{"turn":1}}
{"playerId":"p-mari","type":"TURN_ENDED","data":{"turn":1,"durationMs":2500}}
{"playerId":"p-kev","type":"PLAYER_ACTION","action":"PAUSE","data":{"reason":"pause"}}
```

## Trivia (`trivia`, versión 1.0)

De 2 a 6 jugadores responden las mismas 10 preguntas. El que acierta suma puntos, más si responde rápido. Prefijo de `matchId`: `tv-`.

`MATCH_STARTED` lleva además `questions` (número de preguntas, 10) y `mode` es `"CLASSIC"`. Después de cada respuesta el juego emite `SCORE_CHANGED` con `delta` y `total`. `MATCH_FINISHED` ordena a los jugadores por puntaje final en `results`.

| Tipo | `playerId` | Claves de `data` |
| --- | --- | --- |
| `QUESTION_SHOWN` | null | `questionId` (string), `number` (1 a 10), `category` (`CIENCIA`, `HISTORIA`, `DEPORTES`, `GEOGRAFIA` o `ENTRETENIMIENTO`), `difficulty` (`EASY`, `MEDIUM` o `HARD`), `timeLimitMs` (número) |
| `ANSWER_SUBMITTED` | quien responde | `questionId` (string), `option` (`A`, `B`, `C` o `D`), `correct` (booleano), `responseMs` (número) |
| `ANSWER_TIMEOUT` | quien no respondió a tiempo | `questionId` (string) |
| `QUESTION_CLOSED` | null | `questionId`, `correctOption` (strings), `correctCount` (cuántos jugadores acertaron) |

```json
{"playerId":null,"type":"QUESTION_SHOWN","data":{"questionId":"q-017","number":1,"category":"CIENCIA","difficulty":"MEDIUM","timeLimitMs":15000}}
{"playerId":"p-ana","type":"ANSWER_SUBMITTED","data":{"questionId":"q-017","option":"C","correct":true,"responseMs":4320}}
{"playerId":"p-sofi","type":"ANSWER_TIMEOUT","data":{"questionId":"q-017"}}
{"playerId":null,"type":"QUESTION_CLOSED","data":{"questionId":"q-017","correctOption":"C","correctCount":2}}
```

## Snake (`snake`, versión 1.0)

Un jugador con 3 vidas. La serpiente crece al comer, sube de nivel cada 5 frutas y la partida termina cuando pierde la última vida. Prefijo de `matchId`: `sn-`.

`MATCH_STARTED` lleva `players` con un solo jugador, `mode` `"CLASSIC"`, `lives` (3) y, opcional, `grid` (por ejemplo `"20x20"`). `SCORE_CHANGED` es opcional. `MATCH_FINISHED` tiene un solo resultado con `placement` 1 y, opcional, `finalScore`.

| Tipo | `playerId` | Claves de `data` |
| --- | --- | --- |
| `FOOD_EATEN` | el jugador | `foodType` (`APPLE`, `GOLDEN` o `BONUS`), `length` (largo después de comer), `points` (números) |
| `POWERUP_PICKED` | el jugador | `powerup` (`SPEED`, `SLOW`, `SHIELD` o `DOUBLE_POINTS`), `durationMs` (número) |
| `LEVEL_UP` | el jugador | `level`, `speed` (números) |
| `SNAKE_DIED` | el jugador | `cause` (`WALL`, `SELF` u `OBSTACLE`), `length`, `livesLeft` (números) |
| `PLAYER_RESPAWNED` | el jugador | `livesLeft` (número) |

```json
{"playerId":"p-kev","type":"FOOD_EATEN","data":{"foodType":"APPLE","length":4,"points":10}}
{"playerId":"p-kev","type":"POWERUP_PICKED","data":{"powerup":"SLOW","durationMs":5000}}
{"playerId":"p-kev","type":"LEVEL_UP","data":{"level":2,"speed":1.2}}
{"playerId":"p-kev","type":"SNAKE_DIED","data":{"cause":"SELF","length":11,"livesLeft":2}}
{"playerId":"p-kev","type":"PLAYER_RESPAWNED","data":{"livesLeft":2}}
```

## Blackjack (`blackjack`, versión 1.0)

De 2 a 4 jugadores contra la casa, 10 rondas, 1000 fichas iniciales. La casa no es un jugador: sus eventos llevan `playerId` null. Prefijo de `matchId`: `bj-`.

`MATCH_STARTED` lleva además `startingChips` (1000) y `rounds` (10). `MATCH_FINISHED` ordena a los jugadores por fichas finales. Un jugador que se queda sin fichas sale con `PLAYER_LEFT` y `reason` `"NO_CHIPS"`.

| Tipo | `playerId` | Claves de `data` |
| --- | --- | --- |
| `ROUND_STARTED` | null | `round` (número) |
| `BET_PLACED` | el jugador | `round`, `amount`, `chipsBefore` (números) |
| `CARD_DEALT` | el jugador | `round` (número), `card` (por ejemplo `"KS"`, `"10H"`, `"AD"`), `handValue` (número) |
| `DEALER_CARD` | null | `round` (número), `card` (string), `hidden` (booleano), `dealerValue` (número) |
| `DECISION` | el jugador | `round`, `handValue` (números). El campo `action` del sobre dice la decisión: `HIT`, `STAND` o `DOUBLE` |
| `BUST` | el jugador | `round`, `handValue` (números) |
| `BLACKJACK` | el jugador | `round` (número) |
| `HAND_RESULT` | el jugador | `round` (número), `result` (`WIN`, `LOSE` o `PUSH`), `payout` (ganancia neta de la mano, negativa si perdió), `chips` (fichas después de la mano) |

El dealer se pasa cuando su último `DEALER_CARD` de la ronda tiene `dealerValue` mayor que 21.

```json
{"playerId":null,"type":"ROUND_STARTED","data":{"round":1}}
{"playerId":"p-mari","type":"BET_PLACED","data":{"round":1,"amount":100,"chipsBefore":1000}}
{"playerId":"p-mari","type":"CARD_DEALT","data":{"round":1,"card":"10H","handValue":10}}
{"playerId":null,"type":"DEALER_CARD","data":{"round":1,"card":"6S","hidden":false,"dealerValue":6}}
{"playerId":"p-mari","type":"DECISION","action":"DOUBLE","data":{"round":1,"handValue":11}}
{"playerId":"p-gabo","type":"BUST","data":{"round":1,"handValue":24}}
{"playerId":"p-mari","type":"BLACKJACK","data":{"round":4}}
{"playerId":"p-mari","type":"HAND_RESULT","data":{"round":1,"result":"WIN","payout":200,"chips":1200}}
```

### Claves propias en los eventos generales

Algunos juegos piden claves extra en eventos generales: `questions` en el `MATCH_STARTED` de Trivia, `lives` en el de Snake, `startingChips` y `rounds` en el de Blackjack. Son parte del formato y los juegos tienen que enviarlas. El `ingestor` no las valida, porque un juego no puede redefinir un tipo general en su configuración; el `analyzer` las lee y, si faltan, usa los valores por defecto (10 preguntas, 3 vidas, 1000 fichas y 10 rondas).

## Configuración de un juego

Cada archivo de `configs/games/` dice qué tipos acepta un juego. Al cargar, el `ingestor` combina `_common.json` con cada juego.

```json
{
  "gameId": "snake",
  "versions": ["1.0"],
  "events": {
    "SNAKE_DIED": {
      "playerRequired": true,
      "data": { "cause": "string", "length": "number", "livesLeft": "number" }
    }
  }
}
```

- `playerRequired`: si es `true`, el evento sin `playerId` se rechaza.
- `data`: claves obligatorias y su tipo JSON. Los tipos válidos son `number`, `string`, `boolean`, `array` y `object`. `number` acepta enteros y decimales.
- Las claves opcionales no se listan.
- Un juego no puede redefinir un tipo de `_common.json`. Si lo hace, el `ingestor` no arranca.

El `ingestor` solo revisa que la clave exista y tenga el tipo JSON correcto. No revisa los valores permitidos de un string, como `category` o `cause`. Esos valores están documentados aquí para quien produce eventos, y Scala ignora los que no reconoce.

## Códigos de rechazo

El `ingestor` aplica las reglas en este orden y se queda con el primer error. Cada rechazo se escribe en `data/rejected/rejected.jsonl` como `{"receivedAt", "reason", "detail", "raw"}`.

| Código | Cuándo se aplica |
| --- | --- |
| `MALFORMED_JSON` | La línea o el cuerpo no es JSON válido |
| `MISSING_FIELD` | Falta un campo obligatorio del sobre o viene vacío |
| `INVALID_FIELD` | `eventId` no es UUID, `timestamp` no se puede leer o está más de 5 minutos en el futuro, `seq` es menor a 1, `schemaVersion` no está soportada, `matchId` tiene caracteres no permitidos, un campo del sobre tiene el tipo JSON equivocado (por ejemplo `seq: "14"`), o el `matchId` ya pertenece a otro juego |
| `UNKNOWN_GAME` | `gameId` o `gameVersion` no están registrados |
| `UNKNOWN_TYPE` | `type` no está permitido para ese juego |
| `MISSING_PLAYER` | El tipo exige `playerId` y no viene |
| `MISSING_DATA_FIELD` | Falta una clave obligatoria de `data` o tiene el tipo JSON equivocado |
| `DUPLICATE_EVENT` | Ya se aceptó un evento con ese `eventId` |
| `LATE_EVENT` | Llega después de que la partida se cerró, o su `seq` es mayor que el de `MATCH_FINISHED` |

Un evento de jugador que llega antes de `MATCH_STARTED` se acepta. El desorden se resuelve ordenando por `seq` antes de enviar la partida a Scala. Si `MATCH_FINISHED` llega antes que otros eventos de la partida, el ingestor espera hasta tener todos los `seq` del 1 al del fin, o hasta 5 segundos (`MATCH_FINISH_GRACE`), antes de cerrarla.

## Cómo agregar un juego nuevo

1. Crear `configs/games/<gameId>.json` con `gameId`, `versions` y sus tipos propios. Los tipos generales ya vienen incluidos.
2. Crear la carpeta `data/events/<gameId>/` y empezar a escribir partidas ahí.
3. Reiniciar el `ingestor` para que cargue la configuración.

Con eso el juego ya se valida, se agrupa por partida y recibe las estadísticas generales (G1 a G6). No hay que tocar código de Go.

### Métricas y patrones propios (opcional)

Si el juego necesita estadísticas propias, se agrega un analizador en Scala. Son dos pasos:

1. Crear un objeto que extienda `ComposedAnalyzer[E]` en `analyzer/src/main/scala/gamestats/analysis/<juego>/`. `E` es el tipo de los eventos del juego. El objeto define cuatro cosas, todas funciones puras:
   - `gameId`: el mismo de la configuración.
   - `toTyped`: cómo convertir un `Event` a `E`. Devuelve `None` para lo que no le interesa.
   - `playerMetrics` y `matchMetrics`: las métricas propias, por jugador y por partida.
   - `detectors`: la lista de detectores de patrones, cada uno de tipo `MatchContext[E] => List[PatternMatch]`.
2. Agregar el objeto a la lista de `AnalyzerRegistry.all` en `analysis/GameAnalyzer.scala`.

Las estadísticas generales se siguen calculando solas: `ComposedAnalyzer` arma el análisis como `buildContext andThen computeStats andThen attachPatterns` y les suma las métricas del juego. Un juego sin analizador propio no es un error: recibe `GenericAnalyzer`, que calcula G1 a G6.

```scala
object CardDuelAnalyzer extends ComposedAnalyzer[Event]:
  val gameId = "card-duel"
  protected def toTyped(e: Event, start: Instant): Option[Event] =
    Option.when(e.eventType == "CARD_PLAYED")(e)
  override protected def matchMetrics(ctx: MatchContext[Event]): Map[String, Json] =
    Map("cardsPlayed" -> Json.fromInt(ctx.events.size))
```

Este ejemplo está en las pruebas (`GenericStatsSuite`).

## Versiones del formato

`schemaVersion` versiona el sobre y `gameVersion` versiona los eventos de cada juego. Si un juego cambia sus eventos, se agrega una versión nueva a `versions` en vez de modificar la anterior. Si cambia el sobre, se publica `schemaVersion` 2.0 y el `ingestor` acepta las dos mientras haga falta.
