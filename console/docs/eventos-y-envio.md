# Eventos y envio

en este documento se encuentran los eventos que surgen de cada accion del jugador, tanto los especificos de cada juego como los generales. 

### Eventos generales

| Tipo | Cuándo lo emite la consola |
| --- | --- |
| `MATCH_STARTED` | Al empezar la partida, siempre con `seq = 1` |
| `MATCH_FINISHED` | Al terminar, siempre como último evento, con `durationMs` y `results` |
| `PLAYER_JOINED` | Por cada jugador al armar la partida |
| `PLAYER_LEFT` | Si el jugador cierra la pestaña o abandona, con `reason` (`CLOSED_TAB`, `QUIT`, `IDLE`, `OUT_OF_CHIPS`) |
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
| `MATCH_STARTED` | null | `players`, `startingChips: 1000`, `rounds: 10`, `bots` (lista de ids CPU, opcional) |
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

Cada decisión de un CPU produce dos eventos: `AI_DECISION` (qué calculó Prolog) y luego el `DECISION` normal, para que las estadísticas B1 a B5 de GameStats no cambien.