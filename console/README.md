# GameConsole



## Qué es y cómo se conecta con GameStats

GameConsole es una consola web que puede ejecutar varios juegos simultaneamente, mostrar la cantidad de partidas en ejecucion y enviar sus eventos detectados en archivos JSON a un analizador de eventos y patrones llamado GameStats

## Requisitos
Docker con Compose 2.24 o mayor
Los puertos 3000, 4000, 8080 y 8081 libres
Internet durante la primer instalacion

## Instalación
pasos de la instalacion a detalle en [instrucciones.md](https://github.com/AndresZum04/gamestats/blob/main/console/docs/instalacion.md)

## Cómo jugar
una vez instalado GameConsole, se debe abrir este link para jugar localmente: http://localhost:3000/
(agregar el link del azure cuando este listo)
una vez en gameconsole se presentara la siguiente pantalla
![pantalla inicial de gameconsole](docs/img/captura_pantalla_gameConsole.png)

para jugar un juego en esa misma pestaña se debe hacer click en el boto azul que dice "jugar", pero si se quiere jugar en otra pestaña, se debe hacer click en el boton blanco que dice "abrir en pestaña nueva" y el juego se ejecutara en otra pestaña.

Los juegos son muy intuitivos, pero para los juegos que no son tan obvios como el snake o el blackjack, se cuentan con instrucciones en la parte inferior de la pantalla de juego (el recuadro en el que se ejecuta el juego) del snake, y antes de iniciar la partida en el blackjack.

### ejemplos de partidas en ejecucion:

#### Trivia
![partida de trivia en ejecucion](docs/img/captura_ejecucion_trivia.png)
#### Culebrita
![partida de culebrita en ejecucion](docs/img/captura_ejecucion_snake.png)
#### Blackjack
##### apuesta
![apuesta de partida de blackjack en ejecucion](docs/img/captura_ejecucion_blackjack1.png)
##### juego
![partida de blackjack en ejecucion](docs/img/captura_ejecucion_blackjack2.png)

## Varias instancias a la vez
GameConsole puede registrar eventos de partidas concurrentes, enviarlos a GameStats,  y cada evento se actualiza en el panel de manera concurrente.

### ejemplo de concurrencia

#### GameConsole ejecutando varios juegos a la vez
![3 partidas (1 de trivia, 1 de culebrita y 1 de blackjack) en ejecucion simultanea](docs/img/captura_ejecucion_gameconsole.png)

#### GameStats reflejando eventos en el panel
![panel de gameconsole donde gamestats refleja patrones y eventos](docs/img/captura_panel_gameconsole.png)

## Panel de estadísticas
GameConsole trabaja en conjunto con GameStats. GameConsole ejecuta juegos  y envia sus eventos a GameStats, quien procesa y analiza esos eventos en busca de patrones y los ilustra en el panel de GameConsole.
Cabe recalcar que GameConsole no analiza los juegos de su panel en ninguna manera, solo se limita a enviar eventos y dejar esa responsabilidad a GameStats.

#### Panel de estadisticas de GameConsole
![panel de gameconsole donde gamestats refleja patrones y eventos](docs/img/captura_panel_gameconsole.png)

## Pruebas
Varios juegos y el mismo GameConsole pueden manejar errores.
### Panel
en el caso de que se pierda conexion con GameStats, el panel muestra los ultimos eventos antes de que se perdiera la conexion mientras GameConsole guarda los nuevos eventos que esten ocurriendo en ese momento y apenas recupere conexion los envia a GameStats para que siga su curso.

#### caso en el que gameStats no responde
![panel de gameconsole cuando gamestats no responde](docs/img/captura_fallo_gamestats_gameconsole.png)
### BlackJack
en el caso que la IA en prolog deje de responder, se manejan dos acciones predeterminadas de respaldo:
1. al apostar, se apuesta el minimo de 10 fichas
2. al jugar, siempre se elije plantarse (STAND)
#### Caso en el que prolog no responde

##### apuesta
aqui el jugador cpu 1 apuesta 10 fichas como accion predeterminada
![apuesta predeterminada de blackjack cuando prolog no responde](docs/img/captura_error_controlado_blackjack1.png)
##### jugada
aqui los jugadores cpu 1 y 2 eligieron plantarse como jugada predeterminada
![jugada predeterminada de blackjack cuando prolog no responde](docs/img/captura_error_controlado_blackjack2.png)

## Enlaces y video
