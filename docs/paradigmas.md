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

Otro es R1. La suma y la suma de cuadrados salen de un solo `foldLeft`, sin acumuladores mutables:

```scala
val lapStats: List[Long] => Option[LapStats] = times =>
  Option.when(times.nonEmpty) {
    val (sum, sumSq) = times.foldLeft((0.0, 0.0)) { case ((s, sq), t) => (s + t, sq + t.toDouble * t) }
    val avg = sum / times.size
    LapStats(times.min, avg, math.sqrt(math.max(sumSq / times.size - avg * avg, 0.0)))
  }
```

### Composición

R2 se define a partir de R1 con `andThen`:

```scala
val consistencyOf: List[Long] => Option[Double] = lapStats andThen (_.map(consistency))
```

Y cada analizador es una composición de tres pasos (`analysis/GameAnalyzer.scala`):

```scala
final def analyze(batch: MatchBatch): MatchAnalysis =
  (buildContext andThen computeStats andThen attachPatterns)(batch)
```

Un juego nuevo solo aporta las piezas que cambian: cómo leer sus eventos, sus métricas y sus detectores. Los detectores son valores de tipo `MatchContext[E] => List[PatternMatch]` y se aplican con `detectors.flatMap(detect => detect(ctx))`.

### Inmutabilidad y Option en vez de null

Los eventos tipados son `enum` de Scala 3 y la conversión devuelve `Option`. Un evento al que le falta un dato no se construye, y se descarta con `flatMap`:

```scala
case "LAP_COMPLETED" =>
  for
    lap <- field[Int](d, "lap")
    time <- field[Long](d, "lapTimeMs")
    position <- field[Int](d, "position")
    speed <- field[Double](d, "topSpeedKmh")
  yield LapCompleted(m, p, lap, time, position, speed)
```

Es el equivalente funcional del `if err != nil` de Go: si cualquier paso da `None`, todo da `None`.

### Efectos solo en los bordes

Los únicos efectos del analyzer están en `http/` (red, reloj, logs) y en `store/` (archivos), dentro de `IO` de cats-effect. Hasta el reloj se queda afuera: `analyze` no lee la hora, y la ruta le pone `analyzedAt` después. `StyleSuite` hace cumplir esa frontera: la prueba falla si `analysis/` usa `var`, colecciones mutables, `null`, `cats.effect` o E/S.

### Pruebas sin dependencias

Como el análisis es puro, las pruebas son "esta entrada da esta salida". No hay mocks, ni base de datos, ni servidor, ni reloj. `DeterminismSuite` verifica que analizar dos veces la misma partida da exactamente el mismo resultado.

## La misma métrica en los dos estilos: K/D

En GameStats el K/D lo calcula Scala. La versión de Go es ilustrativa: muestra cómo se vería en estilo imperativo.

Go, imperativo (no está en el repositorio):

```go
func killDeath(events []model.Event) map[string]float64 {
	kills := map[string]int{}
	deaths := map[string]int{}
	for _, e := range events {
		if e.Type != "PLAYER_ELIMINATED" {
			continue
		}
		kills[*e.PlayerID]++
		deaths[e.Data["victimId"].(string)]++
	}
	kd := map[string]float64{}
	for p, k := range kills {
		d := deaths[p]
		if d == 0 {
			d = 1
		}
		kd[p] = float64(k) / float64(d)
	}
	return kd
}
```

Scala, funcional (`analysis/arena/ArenaStats.scala`):

```scala
final case class Combat(kills: Int, deaths: Int, assists: Int):
  def kd: Double = kills.toDouble / math.max(deaths, 1)

def combat(events: List[ArenaEvent], players: List[String]): Map[String, Combat] =
  val kills = eliminations(events)
  val byKiller = countBy(kills)(_.playerId)
  val byVictim = countBy(kills)(_.victimId)
  val byAssist = countBy(kills.flatMap(_.assistIds))(identity)
  (players.toSet ++ byKiller.keySet ++ byVictim.keySet ++ byAssist.keySet).toList
    .map(p => p -> Combat(byKiller.getOrElse(p, 0), byVictim.getOrElse(p, 0), byAssist.getOrElse(p, 0)))
    .toMap
```

Lo que se nota al compararlas:

- En Go, los mapas `kills` y `deaths` se van llenando dentro del ciclo, y el resultado depende del orden en que pasa todo. En Scala cada agrupación es un valor que se calcula una vez y no cambia.
- La versión de Go tiene un error típico del estilo imperativo: un jugador que murió pero nunca eliminó a nadie no aparece en `kd`, porque el segundo ciclo solo recorre `kills`. En Scala, el conjunto de jugadores se arma explícitamente como unión de todas las fuentes, y una prueba (`ArenaStatsSuite`) verifica que el K/D sin muertes no lanza excepción y que todos los jugadores aparecen.
- `e.Data["victimId"].(string)` en Go entra en pánico si el dato no es un string. En Scala ese caso ya se descartó al convertir a `PlayerEliminated`, así que `combat` trabaja con datos que el compilador garantiza.
- La versión de Go es más fácil de seguir paso a paso con un depurador. La de Scala se lee como una definición: "las muertes son la cantidad de eliminaciones agrupadas por víctima".

## Ventajas y limitaciones que observamos

### Go

#### Ventajas
- La concurrencia queda a la vista. Un `select` con tres casos dice exactamente qué puede pasar, y el detector de carreras (`-race`) atrapa errores que en revisión no se ven.
- Para E/S es directo: leer un archivo desde un offset, guardar con un archivo temporal y renombrar, responder 503. Cada paso es una instrucción.
- El binario pesa 14 MB, arranca al instante y no necesita runtime.

#### Limitaciones
- El cierre de un worker exigió razonar sobre todos los órdenes posibles. El diseño obvio tiene un deadlock: el worker espera que el dispatcher le reciba el aviso de cierre mientras el dispatcher espera poder enviarle un evento, y los dos quedan bloqueados. Lo evitamos haciendo que el worker siga leyendo su canal mientras avisa, y una prueba de estrés (`TestClosingMatchesUnderLoad`) cierra 50 partidas mientras siguen llegando eventos. En Scala este tipo de problema no existe, porque no hay estado compartido.
- El manejo de errores es repetitivo (`if err != nil` en cada paso), y el validador con sus nueve códigos lo muestra.
- El estado mutable exige disciplina. La regla de "un solo dueño" no la impone el lenguaje: la sostienen las pruebas con `-race` y la revisión.

### Scala

#### Ventajas
- Las pruebas son simples y confiables. Cada estadística se probó con una partida de 3 pilotos o 4 jugadores escrita a mano, y el valor esperado se calculó en un comentario. Al calcularlos encontramos dos errores de diseño del simulador: las penalizaciones contadas dos veces y un empate de consistencia.
- La composición permitió agregar juegos sin tocar lo existente. La prueba de `CardDuelAnalyzer` agrega un juego en 6 líneas.
- `Option` y los `enum` eliminan toda una clase de errores: ninguna estadística hace `.get` ni compara con `null`.

#### Limitaciones
- Algunas reglas se leen peor como `foldLeft`. P3 (racha de eliminaciones) es una máquina de estados, y escrita como `foldLeft` sobre un `StreakState` inmutable es más difícil de seguir que un ciclo con dos variables.
- Hay que cuidar el orden. Un `Map` no garantiza orden, así que en varios lugares hay `sortBy` explícitos para que la salida sea determinista: jugadores por puesto, patrones por tiempo, MVP con desempate por id.
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
