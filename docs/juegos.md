# Juegos analizados

GameStats analiza a fondo dos juegos: uno de carreras (`racing-pro`) y otro de combate por equipos (`arena-clash`). Un tercero, ajedrez (`chess-lite`), se registra solo con configuración. Este documento explica por qué se eligieron, qué eventos se capturan de cada uno y qué estadísticas permiten esos eventos.

El catálogo completo de eventos con ejemplos está en [eventos.md](eventos.md).

## Por qué carreras y combate

Se buscaron dos juegos que generaran datos de forma muy distinta. Si el núcleo funciona con los dos, es razonable pensar que va a funcionar con los que traiga la consola de la segunda parte del curso.

Una carrera produce series de tiempo. Cada piloto completa las mismas 10 vueltas y su posición cambia vuelta a vuelta, así que se puede medir qué tan regular fue, cuánto perdió en un choque o si una parada en pits le sirvió. Los jugadores casi no interactúan entre ellos: cada uno tiene su propia secuencia.

El combate por equipos es lo contrario. Lo interesante son las relaciones: quién elimina a quién, quién asiste, qué equipo va ganando. Los eventos llegan de forma irregular y en ráfagas, y muchos involucran a dos jugadores. Eso permite buscar rachas, venganzas y remontadas de equipo.

Entre los dos se cubren los dos tipos de análisis que pide el enunciado: estadísticas sobre la secuencia de un jugador y patrones que combinan eventos de varios jugadores.

## Carreras: `racing-pro`

Carrera de 8 a 12 pilotos y 10 vueltas.

Qué se captura:

| Evento | Qué registra |
| --- | --- |
| `LAP_COMPLETED` | Tiempo de cada vuelta, posición al cerrarla y velocidad máxima |
| `POSITION_CHANGED` | Cada cambio de posición con su causa (`OVERTAKE`, `OVERTAKEN`, `PIT`, `CRASH`) y el otro piloto involucrado |
| `PIT_STOP` | Vuelta de la parada, duración y neumático |
| `PENALTY` | Segundos de penalización y motivo |
| `CRASH` | Vuelta, gravedad y si hubo otro piloto |
| `MATCH_FINISHED` | Posición final de cada piloto en `results` |

Qué permite calcular:

- Con los tiempos de `LAP_COMPLETED` salen la mejor vuelta, el promedio, la desviación estándar y el índice de consistencia (R1 y R2). También la racha consistente (P2): tres vueltas seguidas con tiempos casi iguales.
- La `position` de la vuelta 1 contra el `placement` final da las posiciones ganadas (R3). Si además el piloto estuvo entre los últimos tres en algún momento y terminó en el podio, hay una remontada (P1).
- `POSITION_CHANGED` con `action` `OVERTAKE` cuenta adelantamientos (R4) y alimenta el resumen de la carrera (R5).
- `CRASH` y `PENALTY` se cruzan con el tiempo de la vuelta en que ocurrieron para medir cuánto le costó cada incidente al piloto (R6). Esta métrica combina tres tipos de evento.
- `PIT_STOP` se cruza con las vueltas de antes y de después para ver si la parada mejoró el ritmo (R7).

Se guarda `lap` en casi todos los eventos de carrera justamente para poder hacer estos cruces sin depender del timestamp.

## Combate: `arena-clash`

Dos equipos (`RED` y `BLUE`) de 5 jugadores, con reaparición. Gana el primero que llegue a 30 eliminaciones o el que tenga más a los 10 minutos.

Qué se captura:

| Evento | Qué registra |
| --- | --- |
| `MATCH_STARTED` | Composición de los equipos en `data.teams` |
| `DAMAGE_DEALT` | Atacante, víctima, arma, cantidad, distancia y si fue headshot |
| `PLAYER_ELIMINATED` | Quién elimina a quién, con qué arma, a qué distancia y quiénes asistieron |
| `ITEM_PICKED` | Qué recogió el jugador (arma, vida o armadura) |
| `OBJECTIVE_CAPTURED` | Qué objetivo y para qué equipo |
| `PLAYER_RESPAWNED` | Cuándo vuelve a entrar un jugador eliminado |
| `MATCH_FINISHED` | Marcador final y equipo ganador |

Qué permite calcular:

- `PLAYER_ELIMINATED` da eliminaciones por jugador y, leído al revés por `victimId`, las muertes. `assistIds` da las asistencias. Con eso sale el K/D (A1).
- `DAMAGE_DEALT` da daño total, daño promedio por impacto y porcentaje de headshots (A2). Si se divide entre las eliminaciones, da el daño necesario por eliminación (A4).
- Con los equipos de `MATCH_STARTED` se arma el marcador después de cada eliminación. De ahí salen el resumen de la partida con primera sangre y MVP (A3) y la remontada de equipo (P5).
- `ITEM_PICKED` de tipo `WEAPON` seguido de una eliminación del mismo jugador en menos de 30 segundos mide si recoger armas sirve de algo (A5).
- El arma de cada eliminación, sumada sobre todas las partidas, da el arma más efectiva del juego (A6).
- Ordenar eliminaciones y muertes por tiempo permite detectar rachas (P3), venganzas (P4) y abandonos por frustración (P6), que cruzan las muertes con `PLAYER_LEFT`.

`victimId` y `assistIds` van dentro del evento de eliminación, en vez de emitirse como eventos separados, para que cada relación entre jugadores quede en un solo evento con un solo `eventId` que se pueda citar como evidencia.

## Ajedrez: `chess-lite`

El ajedrez no tiene analizador propio. Está para probar que un juego nuevo se integra escribiendo solo [`configs/games/chess-lite.json`](../configs/games/chess-lite.json), sin tocar Go ni Scala.

Usa un tipo propio, `MOVE`, y los eventos generales de turnos y puntaje. Con eso recibe las estadísticas generales: eventos por tipo, duración, desconexiones, puntaje final y racha de puntos (G5), y tiempo promedio y máximo por turno (G6).

Es el caso más parecido a lo que va a pasar en la segunda parte del curso, cuando lleguen juegos que hoy no conocemos.

## Eventos comunes a todos los juegos

Los dos juegos principales también emiten `PLAYER_DISCONNECTED`, `PLAYER_RECONNECTED` y `PLAYER_LEFT`. Con ellos se calculan las desconexiones y el tiempo ausente por jugador (G3) y la tasa de abandono de cada juego (G4). `MATCH_STARTED` y `MATCH_FINISHED` marcan el inicio y el fin de cada partida y dan la duración (G2).
