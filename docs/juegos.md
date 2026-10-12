# Juegos analizados

GameStats analiza tres juegos: Trivia (`trivia`), Snake (`snake`) y Blackjack (`blackjack`). Este documento explica por qué se eligieron, qué eventos se capturan de cada uno y qué estadísticas permiten esos eventos.

El catálogo completo de eventos con ejemplos está en [eventos.md](eventos.md), y cada estadística con su fórmula en [estadisticas.md](estadisticas.md).

## Por qué estos juegos

En la segunda parte del curso hay que programar juegos reales para una consola que escriba estos mismos eventos. Por eso los juegos se eligieron pensando en que se puedan programar de verdad, y el profesor pidió que fueran simples:

- Trivia y Blackjack son por turnos. No tienen física, ni ciclo de juego en tiempo real, ni gráficos complejos: alcanza con texto y botones. Cada evento corresponde a una acción del flujo del juego (mostrar una pregunta, responder, apostar, pedir carta), así que emitirlo es agregar una línea en el lugar donde ya pasa esa acción.
- Snake es en tiempo real, pero sobre una cuadrícula. La serpiente se mueve de a una casilla y los choques son comparaciones de posiciones. Los eventos salen de la detección de choques que el juego ya hace en cada paso.

Al principio el proyecto tenía carreras de autos y un combate 5 contra 5. Se cambiaron porque, como juegos reales, son difíciles de programar y de instrumentar: un 5 contra 5 tiene que sincronizar a 10 jugadores y producir eventos coherentes entre todos. El cambio se registró en [decisiones.md](decisiones.md).

Los tres juegos cubren los dos tipos de análisis que necesita el proyecto:

- Varios jugadores compitiendo (Trivia y Blackjack). Todos responden la misma pregunta o juegan en la misma mesa, así que se pueden comparar entre sí, armar rankings y detectar remontadas.
- Series de tiempo de un solo jugador (Snake). Lo interesante es cómo evoluciona el jugador a lo largo de la partida: qué tan rápido come, cuánto dura cada vida, cómo muere.

## Trivia: `trivia`

De 2 a 6 jugadores responden las mismas 10 preguntas. Cada pregunta tiene categoría y dificultad; el que acierta suma puntos, más si responde rápido.

Qué se captura:

| Evento | Qué registra |
| --- | --- |
| `QUESTION_SHOWN` | La pregunta: categoría, dificultad, número y tiempo límite |
| `ANSWER_SUBMITTED` | La respuesta de cada jugador: la opción, si fue correcta y cuánto tardó |
| `ANSWER_TIMEOUT` | Un jugador que no respondió a tiempo |
| `QUESTION_CLOSED` | La respuesta correcta y cuántos jugadores acertaron |
| `SCORE_CHANGED` | El puntaje después de cada respuesta |

Qué permite calcular:

- Con `ANSWER_SUBMITTED` y `ANSWER_TIMEOUT` salen los aciertos, errores y preguntas sin responder de cada jugador (T1), y con `responseMs`, su velocidad (T2).
- Uniendo cada respuesta con su `QUESTION_SHOWN` por `questionId` se obtiene el porcentaje de aciertos por categoría (T3), y sobre todas las partidas, la categoría más difícil (T5).
- `QUESTION_CLOSED` da cuántos acertaron cada pregunta, y de ahí la pregunta más difícil de la partida (T4).
- La secuencia de respuestas de un jugador permite detectar rachas de aciertos (P1), y los totales de `SCORE_CHANGED` después de cada pregunta, remontadas (P2).

`questionId` está en todos los eventos de una pregunta justamente para poder unirlos sin depender del orden de llegada.

## Snake: `snake`

Un jugador con 3 vidas. La serpiente crece al comer, sube de nivel (y de velocidad) cada 5 frutas, y la partida termina cuando pierde la última vida.

Qué se captura:

| Evento | Qué registra |
| --- | --- |
| `FOOD_EATEN` | Qué comió, cuánto mide después y cuántos puntos sumó |
| `POWERUP_PICKED` | Qué power-up agarró y cuánto dura |
| `LEVEL_UP` | Nivel y velocidad nuevos |
| `SNAKE_DIED` | Contra qué chocó, cuánto medía y cuántas vidas le quedan |
| `PLAYER_RESPAWNED` | Cuándo vuelve a empezar con la vida siguiente |

Qué permite calcular:

- `length` de `FOOD_EATEN` y `SNAKE_DIED` da el largo máximo, y contar las comidas, las frutas (S1). Con los timestamps salen las frutas por minuto y el tiempo entre frutas (S2).
- `cause` de `SNAKE_DIED` da las muertes por causa (S3) y, sobre todas las partidas, la causa más común (S5).
- Partiendo las comidas por las muertes se obtienen las frutas de cada vida (S4). Esta estadística combina dos tipos de evento.
- Los tiempos entre comidas permiten detectar rachas rápidas (P3), y una muerte justo después de comer, la "muerte por codicia" (P4).

## Blackjack: `blackjack`

De 2 a 4 jugadores contra la casa, durante 10 rondas, con 1000 fichas iniciales. Cada ronda: apuestas, reparto, decisiones (pedir, plantarse o doblar), juego de la casa y pago.

Qué se captura:

| Evento | Qué registra |
| --- | --- |
| `ROUND_STARTED` | El inicio de cada ronda |
| `BET_PLACED` | Cuánto apuesta cada jugador y cuántas fichas tenía |
| `CARD_DEALT`, `DEALER_CARD` | Cada carta y el valor de la mano del jugador o de la casa |
| `DECISION` | Qué decidió el jugador (`HIT`, `STAND` o `DOUBLE`) y con qué mano |
| `BUST`, `BLACKJACK` | Cuando un jugador se pasa de 21 o saca 21 con dos cartas |
| `HAND_RESULT` | Si ganó, perdió o empató, cuánto ganó o perdió y con cuántas fichas quedó |

Qué permite calcular:

- `HAND_RESULT` da el porcentaje de victoria (B1), y con `payout` y `chips`, la ganancia neta y la mejor y peor mano (B2).
- `BUST` y `BLACKJACK` se cuentan por jugador (B3).
- Uniendo `DECISION` con `HAND_RESULT` por jugador y ronda se ve si doblar le sirvió (B4).
- Los pagos con el signo invertido dan la ganancia de la casa, y los `DEALER_CARD` sobre 21, los busts del dealer (B5).
- La secuencia de resultados de un jugador permite detectar la "mano caliente", 4 victorias seguidas (P5), y una apuesta de todas las fichas después de 3 derrotas, el all-in por frustración (P6).

La casa no es un jugador: sus eventos llevan `playerId` null, así no aparece en los rankings.

## Eventos comunes a todos los juegos

Los tres juegos usan los eventos generales: `MATCH_STARTED` y `MATCH_FINISHED` marcan el inicio, el fin y la posición final de cada jugador (y dan la duración, G2). `PLAYER_DISCONNECTED`, `PLAYER_RECONNECTED` y `PLAYER_LEFT` dan las desconexiones, el tiempo ausente y la tasa de abandono (G3 y G4). En Blackjack, un jugador que se queda sin fichas sale con `PLAYER_LEFT`.
