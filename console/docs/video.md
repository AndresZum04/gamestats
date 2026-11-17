# Que es Gameconsole y como se conecta con GameStats (1 min)

GameConsole es una consola web que puede ejecutar varios juegos simultaneamente, mostrar la cantidad de partidas en ejecucion y enviar sus eventos detectados en archivos JSON a un analizador de eventos y patrones llamado GameStats.

# Instalacion (1 min)

(aqui se siguen los pasos definidos en instalacion.md desde cero)
1. se ejecuta git clone https://github.com/AndresZum04/gamestats.git en la carpeta donde se quiera almacenar la copia del repositorio (debe ser en una carpeta, porque si se hace directamente en downloads podria aparecer todo muy disperso)
cd gamestats
cd console

2. ejecutar powershell -ExecutionPolicy Bypass -File .\install.ps1 en la carpeta console, en windows.

3. probar con el link http://localhost:3000


# prueba de los tres juegos (3 min) 
una vez abierto GameConsole, abrir la carpeta 'gameStats-data/eventos/(juego que se este probando)', activar la vista dividida del windows y poner GameConsole a la izquierda y la carpeta a la derecha para mostrar que los eventos se actualizan.

1. se juega una partida de trivia contra cpu. (muestra la carpeta 'gameStats-data/eventos/trivia' para que se vean los JSON aparecer, menciona que el codigo de partida identifica a cada juego)

2. se juega una partida de snake (muestra la carpeta 'gameStats-data/eventos/snake' para que se vean los JSON aparecer)

3. se juega una partida de blackjack (muestra la carpeta 'gameStats-data/eventos/blackjack' para que se vean los JSON aparecer)

# concurrencia (2 min)

si ya esta listo el deployment y funciona, abrir varios juegos en varias ventanas (preferiblemente que sea Trivia o blackjack) y mostrar como crecen los JSON de sus respectivas carpetas concurrentemente.

# partida de blackjack (3 min)

esta es una partida distinta de blackjack a la que se le va a hacer mas enfasis (las anteriores eran para demostrar la conexion con gamestats y concurrencia)

en esta partida, mientras se juega se explica brevemente que es el EV y como lo usa prolog para calcular sus movimientos

explicacion breve del EV y toma de decisiones: "es el resultado promedio obtenido por prolog despues de hacer backtracking a varias posibilidades de una jugada. se calcula de la siguiente forma: EV = (% de ganar)(fichas apostadas) - (% de perder)(fichas apostadas). Entonces, compara el EV de plantarse, el de doblar la apuesta y el de seguir pidiendo cartas, y elije la opcion con el EV mas alto."

Ademas, se debe mostrar la lista de decisiones que la cpu toma durante la partida para ilustrar la explicacion

# panel (2 min)

abrir una ventana aparte con el panel y mostrar como se actualizan los eventos (existe un pequenno delay de unos segundos), mencionar los eventos que comparten cada juego y cuales son especificos de cada juego, se puede revisar brevemente cada juego. Mencioonar que toda la logica de este sistema es resultado de GameStats y no de calculos de la consola.

# Tolerancia a fallos (1 min)

1. apagar manualmente el prolog (comando: `docker compose stop prolog`, dentro de `console/`) y demostrar que el blackjack funciona con el aviso de respaldo (jugadas esperadas de la cpu: apuesta minima como respaldo, plantarse como respaldo). volver a encenderlo en media partida (comando: `docker compose start prolog`) y demostrar que vuelve a funcionar.

2. apagar gameStats (comando: `docker compose stop analyzer`, dentro de `console/`), iniciar una partida una vez esta apagado. jugar un poco, demostrar que no hay conexion con gamestats en el panel, volver a encender GameStats (comando: `docker compose start analyzer`, dentro de `console/`) y demostrar que los eventos al final si llegan como debe.

# repositorio (1 min)

mostrar el repositorio y el CI en verde.

# despedida 

se despiden ambos


