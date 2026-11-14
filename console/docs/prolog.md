# logica de la IA en prolog

## EV (Expected value)

es el resultado promedio obtenido por prolog despues de hacer backtracking a varias posibilidades de una jugada. se calcula de la siguiente forma: EV = (% de ganar)(fichas apostadas) - (% de perder)(fichas apostadas)

entonces, si se apostaron 20 fichas y en una jugada plantarse (no pedir mas cartas) tiene 60% de posibilidades de ganar y 40% de perder, el EV seria EV= 0.6*(20)-0.4*(20)=4
eso significa que en promedio se ganan 4 fichas por esa jugada.
Un EV positivo significa que se gana fichas en promedio, y un EV negativo significa que se gana fichas en promedio. Esta es la metrica que la IA de prolog consulta antes de tomar cualquier decision

En el codigo de prolog se tienen dos decisiones:
    1. que jugada hacer (STAND, HIT, DOUBLE)
    2. cuantas fichas apostar

## Que jugada hacer
La IA de prolog sigue el siguiente proceso para decidir cual de las tres jugadas jugar:

Paso 1 – Probabilidad de cada carta (shoe_probs). La consola le pasa cuántas cartas de cada valor quedan. La probabilidad de sacar un valor es (cuántas hay) ÷ (total). Los ases valen 1 (el código decide si cuentan 11) y J/Q/K valen 10, por eso el 10 es el valor más probable.

Paso 2 – Qué le pasará al crupier (dealer_dist). El crupier tiene reglas fijas: pide con menos de 17 y se planta con 17 o más. El código calcula la probabilidad de que termine en 17, 18, 19, 20, 21 o se pase (“bust”). Lo hace recursivamente: desde su total actual, para cada carta posible, multiplica su probabilidad por lo que pasaría después. La línea :- table le dice a Prolog que recuerde los resultados ya calculados para no repetir trabajo.

Paso 3 – EV de plantarse (ev_stand). Con el total fijo de cartas y la distribución del crupier calcula:

EV = (% de ganar)(fichas apostadas) - (% de perder)(fichas apostadas)

Gana si el crupier se pasa o termina más bajo; pierde si termina más alto; empatar vale 0. Si la cpu se pasa de 21, el EV es −1.

Paso 4 – EV de pedir (ev_hit). Para cada carta que podría salir, mira cómo quedaría la mano y supone que después la CPU juega lo mejor posible: plantarse o pedir otra vez, lo que dé más EV. Si se pasa, vale −1. Luego promedia todo ponderando por la probabilidad de cada carta

Paso 5 – EV de doblar (ev_double). Promedio de plantarte tras recibir una sola carta, multiplicado por 2, porque la apuesta es doble (se gana o pierde el doble).

Paso 6 – Elegir. Se compara el EV de las tres y se escoge la mayor. Además arma una explicación en texto, por ejemplo: “pedir: EV -0.42 contra plantarse -0.54”, para que la consola le muestre al usuario por qué decidió así.

Mientras calcula una jugada, el código supone que las probabilidades no cambian al sacar cartas, como si el mazo fuera infinito con la composición actual. Con 6 mazos el error es muy pequeño.

## cuantas fichas apostar

Usa el conteo Hi-Lo. Compara el mazo actual con un zapato completo de 6 mazos para saber qué cartas ya salieron:

|Cartas que salieron|Puntos|
|-------------------||-----|
|2 a 6 | +1|
|7 a 9	| 0|
|10, J, Q, K, A| −1|

Un conteo alto significa que salieron muchas cartas bajas, así que en el mazo quedan más dieces y ases, lo cual favorece al jugador. la apuesta se calcula de la siguiente manera:

conteo verdadero = conteo / mazos restantes.

apuesta = unidad mínima × max(1, conteo verdadero + 1), limitada por `maxBet` y por las fichas.

## integracion

el navegador llama a `POST /api/ai/blackjack/decision` del servidor de la consola, que reenvía a Prolog con un timeout de 2 s y 2 reintentos. Si Prolog no responde, el CPU se planta y el `AI_DECISION` sale con `fallback: true`; la vista muestra un aviso. Un CPU tarda entre 400 y 800 ms en mostrar su jugada (pausa visual), sin bloquear otras instancias.