# Paradigmas: imperativo en Go, funcional en Scala

El enunciado pide justificar qué se hizo de forma imperativa y qué de forma funcional. En GameStats la división sigue el tipo de trabajo:

- Go hace lo que tiene estado que cambia y efectos: leer archivos que crecen, recibir HTTP, mantener el estado de cada partida mientras llegan eventos, coordinar goroutines, reintentar envíos.
- Scala hace lo que es transformar datos: una partida completa entra y sale un análisis, siempre el mismo para la misma entrada.

La regla del proyecto es que Go nunca calcula métricas de juego y Scala nunca valida el formato básico de entrada.

## Imperativo en Go

### Estado que cambia por partida

Cada partida tiene un `MatchState` que se modifica con cada evento (`ingestor/internal/state/match.go`):

```go
func (m *MatchState) Apply(ev model.Event, receivedAt time.Time) {
	m.Events = append(m.Events, ev)
	m.seqs[ev.Seq] = true
	m.LastEventAt = receivedAt
	switch ev.Type {
	case "MATCH_FINISHED":
		m.State = StatusFinished
		m.FinishedSeq = ev.Seq
	case "PLAYER_DISCONNECTED":
		m.setPlayer(ev, PlayerDisconnected)
	// ...
	}
}
```

Es natural escribirlo así porque es literalmente lo que pasa: el estado de la partida avanza. Modelarlo de forma puramente funcional obligaría a reconstruir el estado en cada evento, y el resultado sería el mismo, con más ruido.

### Concurrencia con goroutines y canales

El pipeline es imperativo y concurrente (ver [arquitectura.md](arquitectura.md)):

- Una goroutine por archivo (`FileTailer`) y una por partida (worker).
- Un dispatcher que reparte eventos por canal.
- Un pool de 4 senders.

El worker es un ciclo con `select` sobre tres cosas que pueden pasar en cualquier orden (`ingestor/internal/pipeline/worker.go`):

```go
for {
	select {
	case ev, ok := <-w.events:   // llegó un evento (o se cerró el canal: apagado)
		// ...
	case <-*grace:               // pasó el margen después de MATCH_FINISHED
		return model.StatusComplete, false
	case <-tick:                 // revisar inactividad
		if time.Since(w.match.LastEventAt) >= w.deps.cfg.IdleTimeout {
			return model.StatusPartial, false
		}
	}
}
```

La regla que usamos es que cada dato tiene un solo dueño. El mapa de partidas es del dispatcher y el estado de cada partida es de su worker. Por eso casi no hay locks; donde sí se comparte algo hay un `Mutex`, un `RWMutex` o un contador atómico. Todas las pruebas corren con `go test -race`.

### Contrapresión y fallas

Lo que en Go es control de flujo explícito:

- Si el canal de entrada está lleno, el tailer espera y el handler HTTP responde 503.
- Si el analyzer no responde, el sender reintenta con espera creciente y después guarda el lote en `outbox/`.
- Al apagar, se cierran los canales en cascada y cada partida abierta termina en el outbox.

## Funcional en Scala

### Transformaciones puras

Todo el paquete `analysis/` son funciones de datos inmutables a datos inmutables. Un ejemplo es G1, eventos por tipo:

```scala
def eventsByType(events: List[Event]): Map[String, Int] =
  events.groupBy(_.eventType).view.mapValues(_.size).toMap
```

Otro es T1. Aciertos, errores y timeouts salen de un solo `foldLeft` hacia un `Answers` inmutable: cada paso devuelve un mapa nuevo, sin acumuladores mutables (`analysis/trivia/TriviaStats.scala`):

```scala
def answers(events: List[TriviaEvent]): Map[String, Answers] =
  events.foldLeft(Map.empty[String, Answers]) {
    case (acc, a: AnswerSubmitted) =>
      val r = acc.getOrElse(a.playerId, Answers.empty)
      acc.updated(a.playerId, if a.correct then r.copy(correct = r.correct + 1) else r.copy(wrong = r.wrong + 1))
    case (acc, t: AnswerTimeout) =>
      val r = acc.getOrElse(t.playerId, Answers.empty)
      acc.updated(t.playerId, r.copy(timeouts = r.timeouts + 1))
    case (acc, _) => acc
  }
```

### Composición

El promedio de S4 (frutas por vida) se define encadenando funciones con `andThen`: los eventos se parten en vidas, cada vida se convierte en su cantidad de frutas y se promedia (`analysis/snake/SnakeStats.scala`):

```scala
val avgFruitsPerLife: List[SnakeEvent] => Option[Double] =
  lives andThen (_.map(_.size.toDouble)) andThen Metrics.average
```

`lives` es la misma función que usan S2 y el patrón P3, así que las tres comparten la definición de "vida".

Y cada analizador es una composición de tres pasos (`analysis/GameAnalyzer.scala`):

```scala
final def analyze(batch: MatchBatch): MatchAnalysis =
  (buildContext andThen computeStats andThen attachPatterns)(batch)
```

Un juego nuevo solo aporta las piezas que cambian: cómo leer sus eventos, sus métricas y sus detectores. Los detectores son valores de tipo `MatchContext[E] => List[PatternMatch]` y se aplican con `detectors.flatMap(detect => detect(ctx))`.

### Inmutabilidad y Option en vez de null

Los eventos tipados son `enum` de Scala 3 y la conversión devuelve `Option`. Un evento al que le falta un dato no se construye, y se descarta con `flatMap`:

```scala
case "HAND_RESULT" =>
  player(p =>
    for
      round <- field[Int](d, "round")
      result <- field[String](d, "result")
      payout <- field[Long](d, "payout")
      chips <- field[Long](d, "chips")
    yield HandResult(m, p, round, result, payout, chips)
  )
```

Es el equivalente funcional del `if err != nil` de Go: si cualquier paso da `None`, todo da `None`.

### Efectos solo en los bordes

Los únicos efectos del analyzer están en `http/` (red, reloj, logs) y en `store/` (archivos), dentro de `IO` de cats-effect. Hasta el reloj se queda afuera: `analyze` no lee la hora, y la ruta le pone `analyzedAt` después. `StyleSuite` hace cumplir esa frontera: la prueba falla si `analysis/` usa `var`, colecciones mutables, `null`, `cats.effect` o E/S.

### Pruebas sin dependencias

Como el análisis es puro, las pruebas son "esta entrada da esta salida". No hay mocks, ni base de datos, ni servidor, ni reloj. `DeterminismSuite` verifica que analizar dos veces la misma partida da exactamente el mismo resultado.

## La misma métrica en los dos estilos: % de victoria en blackjack

En GameStats el % de victoria (B1) lo calcula Scala. La versión de Go es ilustrativa: muestra cómo se vería en estilo imperativo.

Go, imperativo (no está en el repositorio):

```go
func winPct(events []model.Event) map[string]float64 {
	wins := map[string]int{}
	hands := map[string]int{}
	for _, e := range events {
		if e.Type != "HAND_RESULT" {
			continue
		}
		hands[*e.PlayerID]++
		if e.Data["result"].(string) == "WIN" {
			wins[*e.PlayerID]++
		}
	}
	pct := map[string]float64{}
	for p, w := range wins {
		pct[p] = 100 * float64(w) / float64(hands[p])
	}
	return pct
}
```

Scala, funcional (`analysis/blackjack/BlackjackStats.scala`):

```scala
final case class Record(hands: Int, wins: Int):
  def winPct: Double = if hands == 0 then 0.0 else 100.0 * wins / hands

def record(events: List[BlackjackEvent]): Map[String, Record] =
  hands(events)
    .groupBy(_.playerId)
    .view
    .mapValues(hs => Record(hs.size, hs.count(_.result == "WIN")))
    .toMap
```

Lo que se nota al compararlas:

- En Go, los mapas `wins` y `hands` se van llenando dentro del ciclo, y hay que seguir el ciclo entero para saber qué contienen. En Scala cada jugador se convierte de una vez en un `Record` que no cambia.
- La versión de Go tiene un error típico del estilo imperativo: un jugador que jugó manos pero nunca ganó no aparece en el resultado, porque el segundo ciclo solo recorre `wins`. En Scala el `Record` se arma a partir de las manos de cada jugador, así que el que nunca ganó aparece con 0 %; una prueba de `BlackjackStatsSuite` lo verifica con un jugador que solo pierde y empata.
- `e.Data["result"].(string)` en Go entra en pánico si el dato no es un string. En Scala ese caso ya se descartó al convertir a `HandResult`, así que `record` trabaja con datos que el compilador garantiza.
- La versión de Go es más fácil de seguir paso a paso con un depurador. La de Scala se lee como una definición: "el récord de un jugador son sus manos y cuántas de ellas son `WIN`".

## Ventajas y limitaciones que observamos

### Go

#### Ventajas
- La concurrencia queda a la vista. Un `select` con tres casos dice exactamente qué puede pasar, y el detector de carreras (`-race`) atrapa errores que en revisión no se ven.
- Para E/S es directo: leer un archivo desde un offset, guardar con un archivo temporal y renombrar, responder 503. Cada paso es una instrucción.
- El binario pesa 14 MB, arranca al instante y no necesita runtime.
- El uso de variables es muy comodo para manejar los detalles de los eventos de los juegos que despues interpreta el analizador

#### Limitaciones
- El cierre de un worker exigió razonar sobre todos los órdenes posibles. El diseño obvio tiene un deadlock: el worker espera que el dispatcher le reciba el aviso de cierre mientras el dispatcher espera poder enviarle un evento, y los dos quedan bloqueados. Lo evitamos haciendo que el worker siga leyendo su canal mientras avisa, y una prueba de estrés (`TestClosingMatchesUnderLoad`) cierra 50 partidas mientras siguen llegando eventos. En Scala este tipo de problema no existe, porque no hay estado compartido.
- El manejo de errores es repetitivo (`if err != nil` en cada paso), y el validador con sus nueve códigos lo muestra.
- El estado mutable exige disciplina. La regla de "un solo dueño" no la impone el lenguaje: la sostienen las pruebas con `-race` y la revisión.

### Scala

#### Ventajas
- Las pruebas son simples y confiables. Cada estadística se probó con una partida de 1 o 2 jugadores escrita a mano, y el valor esperado se calculó en un comentario. Hacer las cuentas a mano también sirvió para el simulador: al escribir la tabla de aciertos del escenario `tv-scn-streak` encontramos que el comentario decía mal en qué preguntas un jugador iba solo en el último lugar.
- La composición permitió agregar juegos sin tocar lo existente. La prueba de `CardDuelAnalyzer` agrega un juego en 6 líneas.
- `Option` y los `enum` eliminan toda una clase de errores: ninguna estadística hace `.get` ni compara con `null`.
- es muy util como lenguaje del analizador porque su paradigma siempre devuelve un resultado

#### Limitaciones
- Algunas reglas se leen peor como `foldLeft`. Partir una lista en rachas (P1 y P5, en `Patterns.runs`) es una máquina de estados, y escrita como `foldLeft` sobre una tupla de racha actual y rachas cerradas es más difícil de seguir que un ciclo con dos variables.
- Hay que cuidar el orden. Un `Map` no garantiza orden, así que en varios lugares hay `sortBy` explícitos para que la salida sea determinista: jugadores por puesto, patrones por tiempo, récord de largo con desempate por partida.
- La compilación es lenta: el analyzer tarda varios minutos en compilarse desde cero, contra segundos en Go. Por eso el Dockerfile separa la descarga de dependencias en su propia capa.
- La imagen pesa 234 MB, contra 14 MB de Go, por la JVM.

## Resumen

| | Go (ingestor) | Scala (analyzer) |
| --- | --- | --- |
| Problema | flujo de eventos que llegan en desorden y en paralelo | partida completa que se convierte en análisis |
| Estilo | imperativo, estado mutable con dueño único | funcional, datos inmutables, funciones puras |
| Concurrencia | goroutines y canales, explícita | no la necesita: cada análisis es independiente |
| Errores | códigos de rechazo, reintentos, outbox | `Option`: lo inválido se descarta al tipar |
| Efectos | en todas partes, controlados | solo en `http/` y `store/` |
| Cómo se prueba | `go test -race`, servidores falsos, tiempos cortos | entrada y salida, sin dependencias |
