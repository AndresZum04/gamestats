# Estadísticas y patrones

GameStats calcula 21 estadísticas y detecta 6 patrones. Todo vive en `analyzer/src/main/scala/gamestats/analysis/` y son funciones puras: reciben datos inmutables y devuelven datos nuevos, sin `var`, sin colecciones mutables y sin efectos.

Las estadísticas son G1 a G6 (generales), T1 a T5 (trivia), S1 a S5 (snake) y B1 a B5 (blackjack). Los ejemplos de salida son reales: salen de cargar `data/samples/demo-small.jsonl` y consultar la API.

## Cómo cumple el enunciado

| Mínimo del enunciado | Dónde |
| --- | --- |
| Estadística agregada por jugador | T1, T2, S1, S2, S3, B1, B2, B3 |
| Estadística agregada por partida | G1, G2, T4, B5 |
| Estadística que combina tipos de eventos distintos | T3, S4, B4 |
| Regla basada en secuencia o combinación de eventos | P1 a P6 |

Además hay estadísticas de todo el juego, sobre todas sus partidas: G4, T5 y S5.

## Generales (todos los juegos)

Archivo: `analysis/GenericStats.scala`. Las calcula `GenericAnalyzer`, que es lo que recibe un juego sin analizador propio. Los analizadores de trivia, snake y blackjack también las incluyen.

| ID | Nivel | Qué calcula | Cómo | Operaciones |
| --- | --- | --- | --- | --- |
| G1 | partida | Eventos por tipo | Agrupa los eventos por `type` y cuenta | `groupBy`, `view.mapValues(_.size)` |
| G2 | partida | Duración | `durationMs` de `MATCH_FINISHED`; en un lote `PARTIAL`, último timestamp menos el primero | `collectFirst`, `minBy`, `maxBy` |
| G3 | jugador | Desconexiones y tiempo ausente | Cantidad de `PLAYER_DISCONNECTED` y suma de `awayMs` de `PLAYER_RECONNECTED` | `collect`, `groupBy`, `foldLeft` |
| G4 | juego | Tasa de abandono | Participaciones con `PLAYER_LEFT` entre participaciones totales, sobre todas las partidas del juego. Por partida se guarda `left` por jugador | `flatMap`, `count` (en `Aggregates.scala`) |
| G5 | jugador | Puntaje final y racha | Último `total` de `SCORE_CHANGED` y la racha más larga de `delta` positivos seguidos | `groupBy`, `lastOption`, `foldLeft` |
| G6 | jugador | Tiempo por turno | Promedio y máximo de `durationMs` en `TURN_ENDED`; si el jugador no tiene turnos, se omite | `collect`, `groupBy`, `max` |

Ejemplo (`bj-0001`, blackjack, que usa `TURN_STARTED` y `TURN_ENDED` en cada mano):

```json
"eventsByType": {"CARD_DEALT": 110, "DECISION": 53, "BET_PLACED": 40, "HAND_RESULT": 40, "TURN_STARTED": 40,
  "TURN_ENDED": 40, "DEALER_CARD": 31, "BUST": 11, "ROUND_STARTED": 10, "PLAYER_JOINED": 4, "BLACKJACK": 2,
  "MATCH_STARTED": 1, "MATCH_FINISHED": 1},
"durationMs": 265184,
"players": [{"playerId": "p-pablo", "placement": 1, "metrics": {
  "disconnections": 0, "awayMs": 0, "left": false, "turns": 10, "avgTurnMs": 3726.3, "maxTurnMs": 7391, … }}]
```

G4 en `GET /api/v1/games/blackjack/summary`: `"playerEntries": 11, "playersLeft": 1, "abandonmentRate": 0.091`. En blackjack un jugador sale con `PLAYER_LEFT` cuando se queda sin fichas.

## Trivia

Archivo: `analysis/trivia/TriviaStats.scala`. Cada estadística es una función con nombre y tipo explícito. La cantidad de preguntas sale de `MATCH_STARTED.questions` (10 si falta).

| ID | Nivel | Qué calcula | Fórmula | Operaciones |
| --- | --- | --- | --- | --- |
| T1 | jugador | Aciertos, errores, sin responder y % de aciertos | `ANSWER_SUBMITTED` con `correct` verdadero o falso, `ANSWER_TIMEOUT`; % = aciertos / preguntas × 100 | `foldLeft` hacia un `Answers` inmutable |
| T2 | jugador | Tiempo de respuesta | Promedio de `responseMs` de todas sus respuestas (los timeouts no tienen tiempo) y el menor `responseMs` con `correct = true` | `groupBy`, `filter`, `minOption` |
| T3 | jugador | % de aciertos por categoría | Une cada respuesta (o timeout) con su `QUESTION_SHOWN` por `questionId` para saber la categoría; aciertos / intentos de esa categoría | `toMap` como índice, `flatMap`, `groupMapReduce` |
| T4 | partida | Resumen | Pregunta más difícil (menor `correctCount`; en empate, la de mayor `number`), jugador más rápido (menor promedio de `responseMs` en aciertos) y % de aciertos de la partida | `minByOption`, `groupBy` |
| T5 | juego | Categoría más difícil | Suma aciertos e intentos por categoría sobre todas las partidas y toma el menor %. Por partida se guarda `categoryTotals` | `groupMapReduce`, `minByOption` |

Ejemplo (`tv-scn-streak`, p-ana):

```json
{"playerId": "p-ana", "placement": 1, "metrics": {
  "correct": 7, "wrong": 3, "timeouts": 0, "correctPct": 70.0,
  "avgResponseMs": 4350.0, "fastestCorrectMs": 3300,
  "correctPctByCategory": {"CIENCIA": 66.7, "DEPORTES": 66.7, "GEOGRAFIA": 0.0, "HISTORIA": 100.0},
  "finalScore": 1050.0, "longestScoreStreak": 6 }}
"matchMetrics": {"hardestQuestion": {"questionId": "q-021", "number": 8, "correctCount": 0},
  "fastestPlayer": {"playerId": "p-ana", "avgCorrectMs": 4242.9}, "matchCorrectPct": 63.3, …}
```

T5 en `GET /api/v1/games/trivia/summary`:

```json
"gameMetrics": {"hardestCategory": {"category": "DEPORTES", "correctPct": 46.4},
  "correctPctByCategory": {"CIENCIA": 48.8, "DEPORTES": 46.4, "ENTRETENIMIENTO": 46.9, "GEOGRAFIA": 50.0, "HISTORIA": 54.4}}
```

## Snake

Archivo: `analysis/snake/SnakeStats.scala`. Una vida va desde el inicio (o una reaparición) hasta un `SNAKE_DIED`; la función `lives` parte las frutas de un jugador por vida y la usan S2, S4 y P3.

| ID | Nivel | Qué calcula | Fórmula | Operaciones |
| --- | --- | --- | --- | --- |
| S1 | jugador | Largo máximo y frutas | Mayor `length` entre `FOOD_EATEN` y `SNAKE_DIED`; cantidad de `FOOD_EATEN` | `collect`, `maxOption`, `count` |
| S2 | jugador | Ritmo | Frutas / duración en minutos (G2), y promedio de ms entre frutas seguidas de la misma vida | `sliding(2)` por vida, `Metrics.average` |
| S3 | jugador | Muertes por causa | `SNAKE_DIED` agrupados por `cause` | `groupMapReduce` |
| S4 | jugador | Frutas por vida | Parte los `FOOD_EATEN` con los `SNAKE_DIED`: lista por vida y promedio. El promedio se arma componiendo funciones: `lives andThen (_.map(_.size.toDouble)) andThen Metrics.average` | `foldLeft`, `andThen` |
| S5 | juego | Récord y causa más común | Mayor largo sobre todas las partidas (jugador, partida y largo; en empate, la primera partida) y la causa de muerte más repetida | `minByOption`, `groupMapReduce` |

Ejemplo (`sn-scn-frenzy`, p-kev):

```json
{"playerId": "p-kev", "placement": 1, "metrics": {
  "maxLength": 15, "fruits": 24, "fruitsPerMinute": 11.25, "avgMsBetweenFruits": 4619.0,
  "deaths": 3, "deathsByCause": {"OBSTACLE": 1, "SELF": 1, "WALL": 1},
  "fruitsPerLife": [12, 6, 6], "avgFruitsPerLife": 8.0, "finalScore": 250.0, … }}
```

S5 en `GET /api/v1/games/snake/summary`:

```json
"gameMetrics": {"lengthRecord": {"playerId": "p-sofi", "matchId": "sn-0002", "length": 16},
  "mostCommonDeathCause": "OBSTACLE", "deathsByCause": {"OBSTACLE": 6, "SELF": 3, "WALL": 3}}
```

Cada jugador guarda también `lengthSeries` (tiempo y largo de cada fruta y cada muerte), que el tablero usa para el gráfico del largo.

## Blackjack

Archivo: `analysis/blackjack/BlackjackStats.scala`. Las fichas iniciales salen de `MATCH_STARTED.startingChips` (1000 si falta). La casa no es un jugador: sus eventos no tienen `playerId`.

| ID | Nivel | Qué calcula | Fórmula | Operaciones |
| --- | --- | --- | --- | --- |
| B1 | jugador | % de victoria | `WIN` / manos jugadas × 100. Un `PUSH` cuenta como mano, no como victoria | `groupBy`, `count` |
| B2 | jugador | Ganancia neta, mejor y peor mano | Fichas de la última `HAND_RESULT` − fichas iniciales; mayor y menor `payout` | `maxBy`, `max`, `min` |
| B3 | jugador | Busts y blackjacks | Cantidad de `BUST` y de `BLACKJACK` | `foldLeft` |
| B4 | jugador | Efectividad al doblar | Une cada `DECISION` con `action = DOUBLE` con la `HAND_RESULT` del mismo (jugador, ronda): % ganadas y ganancia neta de esas manos | `toMap` por `(playerId, round)`, `flatMap` |
| B5 | partida | Resumen de la mesa | Ganancia de la casa (suma de `payout` con el signo invertido), rondas en que el dealer se pasó (su último `DEALER_CARD` de la ronda tiene `dealerValue` > 21) y apuesta más alta | `groupBy(_.round)`, `maxBy`, `minByOption` |

Ejemplo (`bj-0001`, p-diego y la partida):

```json
{"playerId": "p-diego", "placement": 2, "metrics": {
  "hands": 10, "wins": 5, "winPct": 50.0,
  "netGain": 970, "bestHand": 950, "worstHand": -100,
  "busts": 2, "blackjacks": 0,
  "doubles": 1, "doubleWinPct": 100.0, "doubleNet": 180, … }}
"matchMetrics": {"houseGain": -3435, "dealerBusts": 5, "hands": 40,
  "highestBet": {"playerId": "p-pablo", "round": 8, "amount": 1640}, …}
```

Cada jugador guarda también `chipsByRound` (fichas después de cada mano), que el tablero usa para el gráfico de fichas.

## Agregados entre partidas

Archivo: `analysis/Aggregates.scala`. Las rutas leen todos los resultados guardados una sola vez y se los pasan a estas funciones.

- Perfil de un jugador (`GET /api/v1/players/{id}`): partidas jugadas, victorias y promedio de la métrica del juego, por cada juego. Se arma con `groupBy(_.playerId)` y un `foldLeft` hacia un `Record` inmutable.
- Leaderboard (`GET /api/v1/games/{id}/leaderboard`): victoria es el primer lugar (`placement` 1) en los tres juegos. Ordena por victorias y desempata por la métrica del juego: % de aciertos (trivia), largo máximo (snake) o ganancia neta (blackjack).
- Resumen del juego (`GET /api/v1/games/{id}/summary`): partidas, duración promedio, G4, patrones por tipo y `gameMetrics`, que calcula el analizador de cada juego sobre todas sus partidas (T5 en trivia, S5 en snake).

```json
{"gameId": "blackjack", "metric": "netGain", "entries": [
  {"rank": 1, "playerId": "p-pablo", "matches": 1, "wins": 1, "avgMetric": 2100.0},
  {"rank": 2, "playerId": "p-gabo", "matches": 2, "wins": 1, "avgMetric": 350.0},
  {"rank": 3, "playerId": "p-mari", "matches": 2, "wins": 1, "avgMetric": 250.0}]}
```

## Patrones

Un archivo por patrón en `analysis/patterns/`. Cada uno es un `PatternDetector[E]`, es decir una función `MatchContext[E] => List[PatternMatch]`, y el analizador de cada juego aplica su lista con `detectors.flatMap(detect => detect(ctx))`. Todo patrón trae `evidence`: los `eventId` que lo prueban.

| ID | Juego | Patrón | Condición | Técnica | Archivo |
| --- | --- | --- | --- | --- | --- |
| P1 | trivia | Racha de aciertos | 5 o más `ANSWER_SUBMITTED` correctos seguidos del mismo jugador, ordenados por `number`. Un error o un timeout corta la racha; se reporta una vez por racha | `Patterns.runs`, un `foldLeft` que parte la lista en tramos | `AnswerStreak.scala` |
| P2 | trivia | Remontada | Después de algún `QUESTION_CLOSED` desde la pregunta 2, el jugador estaba solo en el último lugar por puntaje, y terminó con `placement` 1 | `scanLeft` sobre los `SCORE_CHANGED`: la tabla de totales después de cada evento | `TriviaComeback.scala` |
| P3 | snake | Frenesí | 5 `FOOD_EATEN` con 15 s o menos entre el primero y el último, en la misma vida. Una vez por vida | `sliding(5)` sobre las frutas de cada vida y `find` | `Frenzy.scala` |
| P4 | snake | Muerte por codicia | `SNAKE_DIED` menos de 2 s después de un `FOOD_EATEN` | `foldLeft` que guarda la última fruta de cada jugador | `GreedyDeath.scala` |
| P5 | blackjack | Mano caliente | 4 o más `HAND_RESULT` `WIN` seguidos del mismo jugador, por ronda. `PUSH` corta la racha | `Patterns.runs` | `HotHand.scala` |
| P6 | blackjack | All-in por frustración | `BET_PLACED` con `amount == chipsBefore` justo después de 3 `HAND_RESULT` `LOSE` seguidos del mismo jugador | `filter`, `takeRight(3)`, `forall` | `TiltAllIn.scala` |

Descripciones reales que genera cada uno:

| ID | Partida | Descripción |
| --- | --- | --- |
| P1 | `tv-scn-streak` | p-ana acertó 6 preguntas seguidas (de la 2 a la 7) |
| P2 | `tv-scn-comeback` | p-luis iba solo en el último lugar después de la pregunta 2 y ganó la partida |
| P3 | `sn-scn-frenzy` | p-kev comió 5 frutas en 14 s (vida 1) |
| P4 | `sn-scn-greedy` | p-dani murió (WALL) 1 s después de comer, con largo 11 |
| P5 | `bj-scn-hot` | p-mari ganó 5 manos seguidas (rondas 2 a 6) |
| P6 | `bj-scn-allin` | p-gabo perdió 3 manos seguidas y apostó todas sus fichas (700) en la ronda 4 |

```json
{"patternId": "P3", "name": "Frenesí", "gameId": "snake", "matchId": "sn-scn-frenzy",
 "playerId": "p-kev", "teamId": null, "atMs": 34000,
 "description": "p-kev comió 5 frutas en 14 s (vida 1)",
 "evidence": ["447515d8-…", "b1ccdd2d-…", "d76bc982-…", "2daaa0c8-…", "491b8ae5-…"]}
```

Los cinco `eventId` de `evidence` son las cinco frutas. Se pueden buscar en `data/samples/demo-small.jsonl` para ver los eventos originales.

### Partidas de escenario

El simulador genera 6 partidas que fuerzan cada patrón exactamente una vez: `tv-scn-streak`, `tv-scn-comeback`, `sn-scn-frenzy`, `sn-scn-greedy`, `bj-scn-hot` y `bj-scn-allin`. Sus respuestas, tiempos de frutas y cartas son fijos, y los comentarios de `simulator/internal/scenario/scenario.go` muestran la cuenta que garantiza el patrón (por ejemplo, la tabla de aciertos después de cada pregunta en las dos partidas de trivia). Hay dos pruebas que lo verifican: una en Go (que el escenario cumple la condición) y otra en Scala, `ScenarioPatternsSuite` (que el analyzer detecta ese patrón y ningún otro).

En partidas al azar los patrones también aparecen. P3 y P4 son los más frecuentes en snake: un jugador hábil come cada 2 o 3 s, y la muerte llega en cualquier momento entre dos frutas. En blackjack, P6 aparece cuando un jugador va con todo después de perder, que es justo lo que hace el simulador con cierta probabilidad. El tablero tiene filtros por tipo de patrón para que no tapen a los demás.

## Pruebas

Cada estadística tiene su prueba en `analyzer/src/test/scala/gamestats/analysis/` (`TriviaStatsSuite`, `SnakeStatsSuite`, `BlackjackStatsSuite`), con una partida chica escrita a mano y el valor esperado calculado en un comentario, por ejemplo `// (2000 + 1000 + 6000) / 3`. Cada patrón tiene en `PatternsSuite` una prueba positiva y una negativa que casi lo cumple; por ejemplo, P3 con 5 frutas en 15,001 s no es un frenesí, y P4 con la muerte justo 2 s después de comer tampoco cuenta. `GenericStatsSuite` prueba `GenericAnalyzer` con `card-duel`, un juego inventado que solo existe en la prueba. `DeterminismSuite` comprueba que analizar el mismo lote dos veces da el mismo resultado.
