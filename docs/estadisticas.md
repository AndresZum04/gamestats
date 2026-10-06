# Estadísticas y patrones

GameStats calcula 19 estadísticas y detecta 6 patrones. Todo vive en `analyzer/src/main/scala/gamestats/analysis/` y son funciones puras: reciben datos inmutables y devuelven datos nuevos, sin `var`, sin colecciones mutables y sin efectos.

Los ejemplos de salida son reales. Salen de cargar `data/samples/demo-small.jsonl` y consultar la API.

## Cómo cumple el enunciado

| Mínimo del enunciado | Dónde |
| --- | --- |
| Estadística agregada por jugador | R1 a R4, A1, A2 |
| Estadística agregada por partida | G1, G2, R5, A3 |
| Estadística que combina tipos de eventos distintos | R6, R7, A4, A5 |
| Regla basada en secuencia o combinación de eventos | P1 a P6 |

## Generales (todos los juegos)

Archivo: `analysis/GenericStats.scala`. Las calcula `GenericAnalyzer`, que es lo que recibe un juego sin analizador propio, como `chess-lite`. Los analizadores de carreras y combate también las incluyen.

| ID | Nivel | Qué calcula | Cómo | Operaciones |
| --- | --- | --- | --- | --- |
| G1 | partida | Eventos por tipo | Agrupa los eventos por `type` y cuenta | `groupBy`, `view.mapValues(_.size)` |
| G2 | partida | Duración | `durationMs` de `MATCH_FINISHED`; en un lote `PARTIAL`, último timestamp menos el primero | `collectFirst`, `minBy`, `maxBy` |
| G3 | jugador | Desconexiones y tiempo ausente | Cantidad de `PLAYER_DISCONNECTED` y suma de `awayMs` de `PLAYER_RECONNECTED` | `collect`, `groupBy`, `foldLeft` |
| G4 | juego | Tasa de abandono | Participaciones con `PLAYER_LEFT` entre participaciones totales, sobre todas las partidas del juego. Por partida se guarda `left` por jugador | `flatMap`, `count` (en `Aggregates.scala`) |
| G5 | jugador | Puntaje final y racha | Último `total` de `SCORE_CHANGED` y la racha más larga de `delta` positivos seguidos | `groupBy`, `lastOption`, `foldLeft` |
| G6 | jugador | Tiempo por turno | Promedio y máximo de `durationMs` en `TURN_ENDED`; si el jugador no tiene turnos, se omite | `collect`, `groupBy`, `max` |

Ejemplo (`cl-0001`, ajedrez):

```json
"eventsByType": {"MOVE": 44, "TURN_STARTED": 44, "TURN_ENDED": 44, "SCORE_CHANGED": 8, "PLAYER_JOINED": 2, "MATCH_STARTED": 1, "MATCH_FINISHED": 1},
"durationMs": 506299,
"players": [{"playerId": "p-fer", "placement": 1, "metrics": {
  "disconnections": 0, "awayMs": 0, "left": false,
  "finalScore": 24.0, "longestScoreStreak": 6,
  "turns": 22, "avgTurnMs": 10580.2, "maxTurnMs": 20360 }}]
```

G4 en `GET /api/v1/games/arena-clash/summary`: `"playerEntries": 60, "playersLeft": 1, "abandonmentRate": 0.017`.

## Carreras (`racing-pro`)

Archivo: `analysis/racing/RacingStats.scala`. Cada estadística es una función con nombre y tipo explícito.

| ID | Nivel | Qué calcula | Cómo | Operaciones |
| --- | --- | --- | --- | --- |
| R1 | jugador | Mejor vuelta, promedio y desviación estándar | Sobre `lapTimeMs` de sus `LAP_COMPLETED`. Desviación poblacional; suma y suma de cuadrados en una sola pasada | `collect`, `groupBy`, `foldLeft` |
| R2 | jugador | Índice de consistencia | `1 - desviación / promedio`, a 3 decimales | `lapStats andThen (_.map(consistency))` |
| R3 | jugador | Posiciones ganadas | Posición tras la vuelta 1 menos el puesto final. Se omite en lotes `PARTIAL` | `collectFirst`, `for` sobre `Option` |
| R4 | jugador | Adelantamientos | `POSITION_CHANGED` con `action = OVERTAKE` | `collect`, `groupBy`, `size` |
| R5 | partida | Resumen de carrera | Vuelta rápida (piloto y tiempo), adelantamientos, choques y segundos de penalización | `minByOption`, `foldLeft` |
| R6 | jugador | Impacto de incidentes | Por cada vuelta con `CRASH` o `PENALTY`: su tiempo menos el promedio de las vueltas limpias del piloto, más los segundos de penalización | `collect`, `groupBy`, `sum` |
| R7 | jugador | Efecto de las paradas | Promedio de las 3 vueltas después de cada `PIT_STOP` menos el de las 3 anteriores; la vuelta de la parada no cuenta. Negativo = mejoró | `span`, `take`, `takeRight` |

Ejemplo (`rp-scn-comeback`, p-ana, que chocó en la vuelta 2):

```json
{"playerId": "p-ana", "placement": 2, "metrics": {
  "bestLapMs": 88000, "avgLapMs": 91500.0, "lapStdDevMs": 6652.1, "consistency": 0.927,
  "positionsGained": -1, "overtakes": 5, "incidentImpactMs": 21667 }}
"matchMetrics": {"fastestLapMs": 88000, "fastestLapPlayer": "p-ana", "overtakes": 12, "crashes": 1, "penaltySeconds": 0.0}
```

El choque le costó 21.7 s (R6). Su consistencia es baja (0.927) justamente por esa vuelta. R7 en `rp-0001`: `"pitEffectMs": -1157.3` para p-pablo, que después de parar fue 1.2 s más rápido por vuelta.

Cada piloto guarda también `lapTimesMs`, la serie de sus vueltas, que el tablero usa para el gráfico.

## Combate (`arena-clash`)

Archivo: `analysis/arena/ArenaStats.scala`.

| ID | Nivel | Qué calcula | Cómo | Operaciones |
| --- | --- | --- | --- | --- |
| A1 | jugador | Eliminaciones, muertes, asistencias, K/D | Muertes leídas por `victimId`, asistencias desde `assistIds`. K/D = eliminaciones / max(muertes, 1) | `flatMap`, `groupBy`, `foldLeft` |
| A2 | jugador | Daño, daño por impacto, % de headshots, eliminación más lejana | Sobre `DAMAGE_DEALT` y `PLAYER_ELIMINATED` | `collect`, `partition`, `maxByOption` |
| A3 | partida | Resumen | Marcador, equipo ganador, primera sangre, daño por equipo y MVP con puntaje `2 × eliminaciones + asistencias + daño / 100` | `groupBy`, `sortBy`, `headOption` |
| A4 | jugador | Daño por eliminación | Daño total entre eliminaciones; cruza las dos agrupaciones por jugador | `groupBy`, `flatMap` sobre los pares |
| A5 | jugador | Conversión de armas | % de `ITEM_PICKED` con `itemType = WEAPON` seguidos de una eliminación del mismo jugador en menos de 30 s | `filter`, `exists` en ventana |
| A6 | juego | Arma más efectiva | Eliminaciones por `weapon` sobre todas las partidas. Por partida se guarda `killsByWeapon` | `groupBy`, `sortBy` (en `Aggregates.scala`) |

Ejemplo (`ac-scn-spree`, p-ana):

```json
{"playerId": "p-ana", "teamId": "RED", "metrics": {
  "kills": 10, "deaths": 5, "assists": 0, "kd": 2.0,
  "damageDealt": 596.0, "avgDamagePerHit": 23.8, "headshotPct": 36.0, "longestKillM": 57.5,
  "damagePerKill": 59.6 }}
"matchMetrics": {"score": {"RED": 30, "BLUE": 25}, "winnerTeam": "RED",
  "firstBlood": {"playerId": "p-ana", "victimId": "p-vale", "atMs": 15000},
  "mvp": {"playerId": "p-ana", "score": 25.96}, "damageByTeam": {"RED": 1995.0, "BLUE": 1761.0},
  "killsByWeapon": {"RIFLE": 51, "SMG": 4}}
```

A6 en `GET /api/v1/games/arena-clash/summary`: `"mostEffectiveWeapon": {"weapon": "RIFLE", "kills": 241}`.

## Agregados entre partidas

Archivo: `analysis/Aggregates.scala`. Las rutas leen todos los resultados guardados una sola vez y se los pasan a estas funciones.

- Perfil de un jugador (`GET /api/v1/players/{id}`): partidas jugadas, victorias y promedio de la métrica del juego, por cada juego. Se arma con `groupBy(_.playerId)` y un `foldLeft` hacia un `Record` inmutable.
- Leaderboard (`GET /api/v1/games/{id}/leaderboard`): ordenado por victorias. En carreras, victoria es el podio y el desempate es la consistencia promedio. En combate, victoria es el equipo ganador y el desempate es el K/D promedio.
- Resumen del juego (`GET /api/v1/games/{id}/summary`): partidas, duración promedio, G4, A6 y patrones por tipo.

```json
{"gameId": "racing-pro", "metric": "consistency", "entries": [
  {"rank": 1, "playerId": "p-sofi", "matches": 2, "wins": 2, "avgMetric": 0.984},
  {"rank": 2, "playerId": "p-luis", "matches": 3, "wins": 2, "avgMetric": 0.963},
  {"rank": 3, "playerId": "p-ana", "matches": 2, "wins": 2, "avgMetric": 0.955}]}
```

## Patrones

Un archivo por patrón en `analysis/patterns/`. Cada uno es un `PatternDetector[E]`, es decir una función `MatchContext[E] => List[PatternMatch]`, y el analizador de cada juego aplica su lista con `detectors.flatMap(detect => detect(ctx))`. Todo patrón trae `evidence`: los `eventId` que lo prueban.

| ID | Juego | Patrón | Condición | Técnica | Archivo |
| --- | --- | --- | --- | --- | --- |
| P1 | racing-pro | Remontada | Desde la vuelta 2 estuvo en alguna de las 3 últimas posiciones y terminó 3.º o mejor | `foldLeft` que guarda la peor vuelta | `Comeback.scala` |
| P2 | racing-pro | Racha consistente | 3 vueltas seguidas con tiempos a 1 % o menos de su promedio. Las ventanas que se solapan son una sola racha | `sliding(3)` y `foldLeft` para unir ventanas | `ConsistentStreak.scala` |
| P3 | arena-clash | Racha de eliminaciones | 3 o más eliminaciones del mismo jugador en 10 s sin morir entre ellas | `foldLeft` con un `StreakState` inmutable | `KillStreak.scala` |
| P4 | arena-clash | Venganza | A elimina a B y B elimina a A en los 60 s siguientes | `flatMap` y `find` en ventana | `Revenge.scala` |
| P5 | arena-clash | Remontada de equipo | El equipo ganador estuvo 5 o más eliminaciones abajo | `scanLeft` del marcador y `exists` | `TeamComeback.scala` |
| P6 | arena-clash | Abandono por frustración | 3 muertes en 60 s seguidas de `PLAYER_LEFT` en menos de 30 s | `sliding(3)` y `find` | `RageQuit.scala` |

Descripciones reales que genera cada uno:

| ID | Partida | Descripción |
| --- | --- | --- |
| P1 | `rp-scn-comeback` | p-ana estuvo en la posición 8 en la vuelta 2 y terminó en el puesto 2 |
| P2 | `rp-scn-steady` | p-kev hizo las vueltas 4 a 7 con tiempos dentro del 1 % de su promedio |
| P3 | `ac-scn-spree` | p-ana eliminó a 4 rivales en 8 s sin morir |
| P4 | `ac-0001` | p-vale eliminó a p-mari y p-mari se vengó 24,7 s después |
| P5 | `ac-scn-teamback` | BLUE estuvo 8 eliminaciones abajo (5 a 13) y ganó 30 a 27 |
| P6 | `ac-scn-ragequit` | p-gabo murió 3 veces en 40 s y se fue 10 s después |

```json
{"patternId": "P3", "name": "Racha de eliminaciones", "gameId": "arena-clash", "matchId": "ac-scn-spree",
 "playerId": "p-ana", "teamId": "RED", "atMs": 208000,
 "description": "p-ana eliminó a 4 rivales en 8 s sin morir",
 "evidence": ["c35b855e-…", "2aea6997-…", "4b9fa3b4-…", "a7f6ad05-…"]}
```

Los cuatro `eventId` de `evidence` son las cuatro eliminaciones. Se pueden buscar en `data/samples/demo-small.jsonl` para ver los eventos originales.

### Partidas de escenario

El simulador genera 6 partidas que fuerzan cada patrón exactamente una vez: `rp-scn-comeback`, `rp-scn-steady`, `ac-scn-spree`, `ac-scn-revenge`, `ac-scn-teamback` y `ac-scn-ragequit`. Sus tiempos de vuelta y secuencias de eliminaciones son fijos, y los comentarios de `simulator/internal/scenario/scenario.go` muestran la cuenta que garantiza el patrón. Hay dos pruebas que lo verifican: una en Go (que el escenario cumple la condición) y otra en Scala (que el analyzer detecta ese patrón y ningún otro).

En partidas al azar los patrones también aparecen. P2 y P4 son los más frecuentes: con tiempos de vuelta que varían cerca de 1 %, tres vueltas parecidas seguidas son comunes, y con 10 jugadores y unas 55 eliminaciones por partida, también lo son las venganzas. El tablero tiene filtros por tipo de patrón para que no tapen a los demás.

## Pruebas

Cada estadística tiene su prueba en `analyzer/src/test/scala/gamestats/analysis/`, con una partida chica escrita a mano y el valor esperado calculado en un comentario. Cada patrón tiene una prueba positiva y una negativa que casi lo cumple; por ejemplo, P3 con la tercera eliminación a los 10,5 s no es una racha. `DeterminismSuite` comprueba que analizar el mismo lote dos veces da el mismo resultado.
