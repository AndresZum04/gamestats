# Formato de eventos

Este documento define cómo se ve un evento de GameStats. Lo usan el `ingestor` (Go) para validar, el `analyzer` (Scala) para analizar y cualquier sistema que produzca eventos: hoy el simulador y, en la segunda parte del curso, la consola de juegos.

Archivos relacionados:

- [`schemas/event.schema.json`](../schemas/event.schema.json): JSON Schema (draft 2020-12) del sobre común.
- [`configs/games/`](../configs/games/): tipos de evento permitidos por juego y claves obligatorias de `data`.
- [`data/samples/examples.jsonl`](../data/samples/examples.jsonl): un evento válido de cada tipo.

## Para qué sirve el formato

Un evento es una línea JSON que describe algo que pasó en una partida: alguien completó una vuelta, eliminó a otro jugador o se desconectó. Todos los eventos comparten un sobre con los mismos campos (quién, cuándo, en qué partida y en qué orden), y lo propio de cada juego va dentro de `data`.

Con esa separación, el `ingestor` puede validar y agrupar eventos de cualquier juego sin saber nada de carreras ni de combate. Las reglas de cada juego viven en un archivo de configuración y no en el código. Como no sabemos qué juegos va a traer la consola de la segunda parte, también hay eventos genéricos de puntaje, turnos y acciones que sirven para casi cualquier juego.

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
| `timestamp` | string | sí | RFC 3339 en UTC con milisegundos, por ejemplo `2026-10-10T14:03:22.120Z` |
| `gameId` | string | sí | Minúsculas y guiones (`racing-pro`). Tiene que existir en `configs/games/` |
| `gameVersion` | string | sí | Tiene que estar en `versions` de la configuración del juego |
| `matchId` | string | sí | Único entre juegos, por ejemplo `rp-0007`. Solo letras, dígitos, `-` y `_`, máximo 128 caracteres |
| `seq` | entero | sí | Mayor o igual a 1. Orden del evento dentro de la partida |
| `playerId` | string o null | según el tipo | Obligatorio si el tipo tiene `playerRequired: true`. Si no, puede ir `null` o no venir |
| `type` | string | sí | MAYÚSCULAS_CON_GUION_BAJO, permitido para ese juego |
| `action` | string | no | Subtipo, por ejemplo la causa de un cambio de posición |
| `source` | objeto | no | Quién produjo el evento: `{"consoleId", "sessionId"}`. Lo llena la consola; hoy lo pone el simulador |
| `data` | objeto | sí | Puede ser `{}`. Sus claves obligatorias dependen del tipo |

`matchId` y `gameId` tienen caracteres restringidos porque se usan como nombres de archivos y carpetas. Los campos que no están en esta tabla se ignoran: no son error, así una versión futura del formato puede agregar campos sin romper lo que ya existe.

Un evento completo se ve así:

```json
{"schemaVersion":"1.0","eventId":"6f1c2a4e-9b1d-4c3e-8a77-2d5e9f0b1c11","timestamp":"2026-10-10T14:00:00.000Z","gameId":"racing-pro","gameVersion":"1.0","matchId":"rp-0007","seq":1,"playerId":null,"type":"MATCH_STARTED","source":{"consoleId":"sim-01","sessionId":"s-42"},"data":{"players":["p-ana","p-luis","p-sofi"],"mode":"GRAND_PRIX","track":"Monza"}}
```

En los catálogos de abajo, los ejemplos muestran solo `playerId`, `type`, `action` y `data` para que se lean mejor. El resto del sobre siempre va igual. Las líneas completas están en `data/samples/examples.jsonl`.

## Eventos generales

Sirven para todos los juegos. Están en [`configs/games/_common.json`](../configs/games/_common.json).

| Tipo | `playerId` | Claves de `data` |
| --- | --- | --- |
| `MATCH_STARTED` | null | `players` (lista de ids), `mode` (string). Opcionales: `teams` (objeto equipo a lista de ids), `track` o `map` (string) |
| `MATCH_FINISHED` | null | `durationMs` (número), `results` (lista de `{playerId, placement, teamId?}`). Opcionales: `winnerTeam`, `score` (objeto equipo a número) |
| `PLAYER_JOINED` | requerido | Opcional: `teamId` |
| `PLAYER_LEFT` | requerido | `reason` (string) |
| `PLAYER_DISCONNECTED` | requerido | ninguna |
| `PLAYER_RECONNECTED` | requerido | `awayMs` (número) |
| `SCORE_CHANGED` | requerido | `delta`, `total` (números). Opcionales: `teamId`, `reason` |
| `TURN_STARTED` | requerido | `turn` (número) |
| `TURN_ENDED` | requerido | `turn`, `durationMs` (números) |
| `PLAYER_ACTION` | requerido | Libre. El campo `action` del sobre dice qué acción fue |

Los últimos cuatro son genéricos de jugabilidad. Un juego de cartas o de mesa puede reportar puntos y turnos con ellos sin definir tipos nuevos, y GameStats ya calcula estadísticas a partir de eso (G5 y G6 en [estadisticas.md](estadisticas.md)). `PLAYER_ACTION` sirve para juegos que todavía no tienen tipos propios.

```json
{"playerId":null,"type":"MATCH_STARTED","data":{"players":["p-ana","p-luis","p-sofi"],"mode":"GRAND_PRIX","track":"Monza"}}
{"playerId":null,"type":"MATCH_FINISHED","data":{"durationMs":965300,"results":[{"playerId":"p-ana","placement":1},{"playerId":"p-sofi","placement":2},{"playerId":"p-luis","placement":3}]}}
{"playerId":"p-ana","type":"PLAYER_JOINED","data":{}}
{"playerId":"p-dani","type":"PLAYER_LEFT","data":{"reason":"QUIT"}}
{"playerId":"p-sofi","type":"PLAYER_DISCONNECTED","data":{}}
{"playerId":"p-sofi","type":"PLAYER_RECONNECTED","data":{"awayMs":4300}}
{"playerId":"p-luis","type":"SCORE_CHANGED","data":{"delta":3,"total":3,"reason":"CAPTURE_KNIGHT"}}
{"playerId":"p-ana","type":"TURN_STARTED","data":{"turn":1}}
{"playerId":"p-ana","type":"TURN_ENDED","data":{"turn":1,"durationMs":4250}}
{"playerId":"p-mari","type":"PLAYER_ACTION","action":"EMOTE","data":{"emote":"WAVE"}}
```

## Carreras (`racing-pro`, versión 1.0)

Carrera de 8 a 12 pilotos y 10 vueltas. Todos los tipos llevan el `playerId` del piloto.

| Tipo | `action` | Claves de `data` |
| --- | --- | --- |
| `LAP_COMPLETED` | no | `lap`, `lapTimeMs`, `position`, `topSpeedKmh` (números) |
| `POSITION_CHANGED` | `OVERTAKE`, `OVERTAKEN`, `PIT` o `CRASH` | `lap`, `from`, `to` (números). Opcional: `otherPlayerId` |
| `PIT_STOP` | no | `lap`, `durationMs` (números), `tire` (`SOFT`, `MEDIUM` o `HARD`) |
| `PENALTY` | no | `lap`, `seconds` (números), `reason` (string) |
| `CRASH` | no | `lap` (número), `severity` (`LOW` o `HIGH`). Opcional: `otherPlayerId` |

```json
{"playerId":"p-ana","type":"LAP_COMPLETED","data":{"lap":1,"lapTimeMs":92410,"position":7,"topSpeedKmh":318.4}}
{"playerId":"p-ana","type":"POSITION_CHANGED","action":"OVERTAKE","data":{"lap":2,"from":7,"to":6,"otherPlayerId":"p-luis"}}
{"playerId":"p-sofi","type":"PIT_STOP","data":{"lap":5,"durationMs":22400,"tire":"MEDIUM"}}
{"playerId":"p-luis","type":"PENALTY","data":{"lap":6,"seconds":5,"reason":"TRACK_LIMITS"}}
{"playerId":"p-luis","type":"CRASH","data":{"lap":7,"severity":"LOW","otherPlayerId":"p-sofi"}}
```

## Combate (`arena-clash`, versión 1.0)

Dos equipos (`RED` y `BLUE`) de 5 jugadores, con reaparición. Gana el primero que llegue a 30 eliminaciones, o el que tenga más cuando se cumplan 10 minutos. Los equipos se declaran en `data.teams` de `MATCH_STARTED`.

| Tipo | `playerId` | Claves de `data` |
| --- | --- | --- |
| `DAMAGE_DEALT` | atacante | `targetId`, `weapon` (strings), `amount`, `distanceM` (números), `headshot` (booleano) |
| `PLAYER_ELIMINATED` | quien elimina | `victimId`, `weapon` (strings), `distanceM` (número), `assistIds` (lista, puede ir vacía) |
| `ITEM_PICKED` | quien recoge | `itemId` (string), `itemType` (`WEAPON`, `HEALTH` o `ARMOR`) |
| `OBJECTIVE_CAPTURED` | quien captura | `objectiveId`, `teamId` (strings) |
| `PLAYER_RESPAWNED` | quien reaparece | ninguna |

```json
{"playerId":null,"type":"MATCH_STARTED","data":{"players":["p-kev","p-gabo","p-dani","p-mari"],"mode":"TEAM_DEATHMATCH","teams":{"RED":["p-kev","p-gabo"],"BLUE":["p-dani","p-mari"]},"map":"Foundry"}}
{"playerId":"p-kev","type":"DAMAGE_DEALT","data":{"targetId":"p-dani","weapon":"RIFLE","amount":42,"distanceM":41.5,"headshot":true}}
{"playerId":"p-kev","type":"PLAYER_ELIMINATED","data":{"victimId":"p-dani","weapon":"RIFLE","distanceM":41.5,"assistIds":["p-gabo"]}}
{"playerId":"p-mari","type":"ITEM_PICKED","data":{"itemId":"it-17","itemType":"WEAPON"}}
{"playerId":"p-gabo","type":"OBJECTIVE_CAPTURED","data":{"objectiveId":"obj-B","teamId":"RED"}}
{"playerId":"p-dani","type":"PLAYER_RESPAWNED","data":{}}
```

## Ajedrez (`chess-lite`, versión 1.0)

No tiene analizador propio en Scala. Existe para demostrar que un juego registrado solo con un archivo de configuración ya recibe las estadísticas generales. Usa además `TURN_STARTED`, `TURN_ENDED` y `SCORE_CHANGED` (valor del material capturado).

| Tipo | `playerId` | Claves de `data` |
| --- | --- | --- |
| `MOVE` | quien mueve | `turn` (número), `from`, `to`, `notation` (strings), `thinkMs` (número), `capture` (booleano) |

```json
{"playerId":"p-ana","type":"MOVE","data":{"turn":1,"from":"e2","to":"e4","notation":"e4","thinkMs":4200,"capture":false}}
```

## Configuración de un juego

Cada archivo de `configs/games/` dice qué tipos acepta un juego. Al cargar, el `ingestor` combina `_common.json` con cada juego.

```json
{
  "gameId": "racing-pro",
  "versions": ["1.0"],
  "events": {
    "CRASH": {
      "playerRequired": true,
      "data": { "lap": "number", "severity": "string" }
    }
  }
}
```

- `playerRequired`: si es `true`, el evento sin `playerId` se rechaza.
- `data`: claves obligatorias y su tipo JSON. Los tipos válidos son `number`, `string`, `boolean`, `array` y `object`. `number` acepta enteros y decimales.
- Las claves opcionales no se listan.
- Un juego no puede redefinir un tipo de `_common.json`. Si lo hace, el `ingestor` no arranca.

El `ingestor` solo revisa que la clave exista y tenga el tipo JSON correcto. No revisa los valores permitidos de un string, como `tire` o `itemType`. Esos valores están documentados aquí para quien produce eventos, y Scala ignora los que no reconoce.

## Códigos de rechazo

El `ingestor` aplica las reglas en este orden y se queda con el primer error. Cada rechazo se escribe en `data/rejected/rejected.jsonl` como `{"receivedAt", "reason", "detail", "raw"}`.

| Código | Cuándo se aplica |
| --- | --- |
| `MALFORMED_JSON` | La línea o el cuerpo no es JSON válido |
| `MISSING_FIELD` | Falta un campo obligatorio del sobre o viene vacío |
| `INVALID_FIELD` | `eventId` no es UUID, `timestamp` no se puede leer o está más de 5 minutos en el futuro, `seq` es menor a 1, `schemaVersion` no está soportada |
| `UNKNOWN_GAME` | `gameId` o `gameVersion` no están registrados |
| `UNKNOWN_TYPE` | `type` no está permitido para ese juego |
| `MISSING_PLAYER` | El tipo exige `playerId` y no viene |
| `MISSING_DATA_FIELD` | Falta una clave obligatoria de `data` o tiene el tipo JSON equivocado |
| `DUPLICATE_EVENT` | Ya se aceptó un evento con ese `eventId` |
| `LATE_EVENT` | Llega después de que la partida ya se envió a Scala |

Un evento de jugador que llega antes de `MATCH_STARTED` se acepta. El desorden se resuelve ordenando por `seq` antes de enviar la partida a Scala.

## Cómo agregar un juego nuevo

1. Crear `configs/games/<gameId>.json` con `gameId`, `versions` y sus tipos propios. Los tipos generales ya vienen incluidos.
2. Crear la carpeta `data/events/<gameId>/` y empezar a escribir partidas ahí.
3. Reiniciar el `ingestor` para que cargue la configuración.

Con eso el juego ya se valida, se agrupa por partida y recibe las estadísticas generales (G1 a G6). No hay que tocar código de Go. Si además se quieren métricas y patrones propios, se agrega un analizador en Scala. Ese paso se documenta cuando exista el registro de analizadores (tarea T12).

## Versiones del formato

`schemaVersion` versiona el sobre y `gameVersion` versiona los eventos de cada juego. Si un juego cambia sus eventos, se agrega una versión nueva a `versions` en vez de modificar la anterior. Si cambia el sobre, se publica `schemaVersion` 2.0 y el `ingestor` acepta las dos mientras haga falta.
