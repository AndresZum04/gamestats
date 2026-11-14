# diagrama de la arquitectura

## 0. Vista general de paquetes
 
```mermaid
flowchart LR
  console["console<br/>ConsoleApp, InstanceManager,<br/>InstanceArea, GameRegistry, Router"]
  core["core<br/>Game, Player, MatchContext,<br/>Rng, Clock"]
  events["events<br/>EventFactory, EventPublisher,<br/>Outbox, OutboxRecovery, Transport"]
  trivia["games/trivia"]
  blackjack["games/blackjack"]
  snake["games/snake"]
  console --> core
  console --> events
  console -.registra.-> trivia
  console -.registra.-> blackjack
  console -.registra.-> snake
  trivia --> core
  blackjack --> core
  snake --> core
  core --> events
```

## 1. Núcleo (core) y eventos (events)
 
```mermaid
classDiagram
direction TB
 
class Clock {
  <<interface>>
  +now() number
}
class Rng {
  -state number
  +next() number
  +int(min, max) number
  +chance(p) boolean
  +pick(items) T
  +shuffle(items) T[]
  +fork() Rng
}
class MatchContext~G~ {
  +gameId G
  +matchId string
  +clock Clock
  +startedAt number
  -seq number
  -finished boolean
  +lastSeq number
  +nextSeq() number
  +finish() void
  +elapsedMs() number
}
class Player {
  <<abstract>>
  +id string
  +name string
  +isBot boolean*
}
class HumanPlayer {
  +isBot = false
  +idFor(name)$ string
  +named(name)$ HumanPlayer
}
class BotPlayer {
  <<abstract>>
  +isBot = true
}
class GameStatus {
  <<enumeration>>
  READY
  RUNNING
  FINISHED
}
class EventOutlet {
  <<interface>>
  +publish(event) void
  +close() Promise~void~
  +beacon() boolean
}
class GameDeps {
  <<interface>>
  +outlet(matchId) EventOutlet
  +source EventSource
  +clock Clock
  +rng Rng
}
class Game~G~ {
  <<abstract>>
  -context MatchContext
  -factory EventFactory
  -outlet EventOutlet
  -players Player[]
  -listeners Set
  -status GameStatus
  -lastActivity number
  -away Set
  -left Set
  #clock Clock
  #rng Rng
  +gameId G
  +matchId string
  +status GameStatus
  +players Player[]
  +humans Player[]
  +idleMs number
  +awaitingSetup boolean
  +start() void
  +finish() void
  +abandon(reason) void
  +disconnect() void
  +reconnect(awayMs) void
  +beacon() boolean
  +setFocused(focused) void
  +subscribe(listener) function
  #emit(type, data, options) void
  #scoreChanged(playerId, data) void
  #playerLeft(playerId, reason) void
  #setPlayers(players) void
  #markActivity() void
  #changed() void
  #startData()* MatchStartedData
  #onStart()* void
  #buildResults()* Placement[]
  #finishData() Partial
  #onFinish() void
}
 
class EventOptions {
  <<interface>>
  +playerId string
  +action string
}
class EventFactory~G~ {
  -context MatchContext
  -source EventSource
  -newId() string
  +create(type, data, options) GameEvent
}
 
class Transport {
  <<interface>>
  +send(events) Promise~void~
  +beacon(events) boolean
}
class HttpTransport {
  -url string
  -fetch fetch
  +send(events) Promise~void~
  +beacon(events) boolean
}
class OutboxEntry {
  <<interface>>
  +owner string
  +updatedAt number
  +events AnyGameEvent[]
}
class Outbox {
  +matchId string
  -store KeyValueStore
  +key string
  +load() OutboxEntry
  +save(owner, updatedAt, events) void
  +clear() void
  +matchIds(store)$ string[]
}
class PublisherOptions {
  <<interface>>
  +owner string
  +clock Clock
  +flushIntervalMs number
  +batchSize number
  +maxBatch number
  +backoffMs number[]
  +retryEveryMs number
}
class RecoveryOptions {
  <<interface>>
  +orphanAfterMs number
  +checkEveryMs number
}
class EventPublisher {
  +matchId string
  -transport Transport
  -outbox Outbox
  -owner string
  -queue AnyGameEvent[]
  -inFlight boolean
  -failures number
  -timer Timeout
  -closed boolean
  +pending number
  +closed boolean
  +failures number
  +resume(transport, outbox, options)$ EventPublisher
  +publish(event) void
  +close() Promise~void~
  +beacon() boolean
  +dispose() void
  -persist() void
  -schedule(delayMs) void
  -send() Promise~void~
}
class OutboxRecovery {
  -store KeyValueStore
  -transport Transport
  -taken Map
  +recover() EventPublisher[]
  +start() void
  +stop() void
}
 
Player <|-- HumanPlayer
Player <|-- BotPlayer
Transport <|.. HttpTransport
EventOutlet <|.. EventPublisher : estructural
PublisherOptions <|-- RecoveryOptions
 
Game *-- MatchContext
Game *-- EventFactory
Game o-- Player : players
Game --> EventOutlet
Game --> Clock
Game --> Rng
Game --> GameStatus
Game ..> GameDeps : constructor
GameDeps --> EventOutlet
GameDeps --> Clock
GameDeps --> Rng
MatchContext --> Clock
EventFactory --> MatchContext
EventFactory ..> EventOptions
 
EventPublisher --> Transport
EventPublisher --> Outbox
EventPublisher --> Clock
EventPublisher ..> PublisherOptions
Outbox ..> OutboxEntry
OutboxRecovery --> Outbox
OutboxRecovery --> Transport
OutboxRecovery ..> EventPublisher : crea con resume
OutboxRecovery ..> RecoveryOptions
```
 
## 2. Trivia
 
```mermaid
classDiagram
direction TB
 
class Game~G~ {
  <<externa>>
}
class BotPlayer {
  <<externa>>
}
class HumanPlayer {
  <<externa>>
}
class Rng {
  <<externa>>
}
class GameView {
  <<externa>>
}
class GameDefinition {
  <<externa>>
}
 
class Question {
  <<interface>>
  +id string
  +category TriviaCategory
  +difficulty Difficulty
  +text string
  +options Record
  +answer AnswerOption
}
class QuestionBank {
  -questions Question[]
  +size number
  +all() Question[]
  +draw(count, rng) Question[]
}
class Scoreboard {
  -order string[]
  -totals Map
  +points(correct, responseMs, timeLimitMs)$ number
  +award(playerId, correct, responseMs, timeLimitMs) Award
  +total(playerId) number
  +standings() Standing[]
  +placements() Placement[]
}
class Award {
  <<interface>>
  +delta number
  +total number
  +reason string
}
class Standing {
  <<interface>>
  +playerId string
  +total number
  +placement number
}
class TriviaRound {
  +question Question
  +number number
  -order string[]
  -outcomes Map
  +current string
  +complete boolean
  +correctCount number
  +outcome(playerId) Outcome
  +isCorrect(option) boolean
  +answer(playerId, option, points) Outcome
  +timeout(playerId) Outcome
}
class Outcome {
  <<interface>>
  +option AnswerOption
  +correct boolean
  +points number
}
class TriviaBot {
  +accuracy number
  +numbered(n)$ TriviaBot
}
class TriviaOptions {
  <<interface>>
  +bank QuestionBank
  +questions number
  +timeLimitMs number
  +revealMs number
  +thinkMs number[]
  +autoplay boolean
}
class SeatChoice {
  <<type>>
  person con name
  cpu
}
class TriviaPhase {
  <<enumeration>>
  SETUP
  TURN
  REVEAL
  DONE
}
class TriviaGame {
  -host HumanPlayer
  -questions Question[]
  -auto Map
  -timers Set
  -phase TriviaPhase
  -scoreboard Scoreboard
  -round TriviaRound
  -index number
  +checkSeats(host, seats)$ string
  +startWith(seats) void
  +host HumanPlayer
  +phase TriviaPhase
  +round TriviaRound
  +totalQuestions number
  +timeLeftMs number
  +currentPlayer Player
  +waitingForPerson boolean
  +standings() Standing[]
  +answer(option) boolean
  #startData() MatchStartedData
  #onStart() void
  #buildResults() Placement[]
  #onFinish() void
  -nextQuestion() void
  -beginTurn() void
  -submit(option) void
  -timeout() void
  -afterTurn() void
}
class TriviaView {
  -game TriviaGame
  -seats SeatChoice[]
  +mount(el) void
  +dispose() void
  +handleKey(event) boolean
  +render() void
}
class triviaDefinition {
  <<const>>
  +id = trivia
  +create(setup) TriviaGame
  +createView(game) TriviaView
}
 
Game <|-- TriviaGame
BotPlayer <|-- TriviaBot
GameView <|.. TriviaView
GameDefinition <|.. triviaDefinition
 
TriviaGame *-- TriviaRound
TriviaGame *-- Scoreboard
TriviaGame o-- Question
TriviaGame --> HumanPlayer : host
TriviaGame --> TriviaPhase
TriviaGame ..> QuestionBank : draw
TriviaGame ..> TriviaBot : crea CPU
TriviaGame ..> TriviaOptions
TriviaGame ..> SeatChoice
TriviaRound o-- Question
TriviaRound ..> Outcome
Scoreboard ..> Award
Scoreboard ..> Standing
QuestionBank o-- Question
QuestionBank ..> Rng
TriviaBot ..> Question : botAnswer
TriviaView --> TriviaGame
triviaDefinition ..> TriviaGame
triviaDefinition ..> TriviaView
```
 
## 3. Blackjack
 
```mermaid
classDiagram
direction TB
 
class Game~G~ {
  <<externa>>
}
class BotPlayer {
  <<externa>>
}
class GameView {
  <<externa>>
}
class GameDefinition {
  <<externa>>
}
 
class Card {
  +rank Rank
  +suit Suit
  +code string
  +points number
  +valueKey ValueKey
  +label string
  +red boolean
  +parse(code)$ Card
}
class Hand {
  -cards Card[]
  +cards Card[]
  +size number
  +value number
  +soft boolean
  +blackjack boolean
  +bust boolean
  +add(card) void
}
class Shoe {
  +decks number
  +reshuffleAt number
  -cards Card[]
  -shuffles number
  +size number
  +remaining number
  +needsShuffle boolean
  +shuffle() void
  +draw() Card
  +composition() ShoeComposition
}
class Dealer {
  -hand Hand
  -revealed boolean
  +hand Hand
  +upcard Card
  +revealed boolean
  +mustHit boolean
  +newRound() void
  +take(card) void
  +reveal() void
}
class SeatResult {
  <<interface>>
  +result HandOutcome
  +payout number
}
class Seat {
  +player Player
  +strategy DecisionStrategy
  -chips number
  -bet number
  -hand Hand
  -doubled boolean
  -state SeatState
  -out boolean
  +chips number
  +bet number
  +hand Hand
  +state SeatState
  +out boolean
  +lastResult SeatResult
  +canDouble boolean
  +newRound() void
  +placeBet(amount) void
  +setState(state) void
  +double() void
  +settle(result) void
  +leave() void
}
class BlackjackTable {
  +shoe Shoe
  +dealer Dealer
  +seats Seat[]
  +active Seat[]
  +newRound() void
  +adjustBet(amount, chips)$ number
  +canPlay(chips)$ boolean
  +dealTo(hand) Card
  +settle(hand, bet, house)$ SeatResult
}
 
class BetContext {
  <<interface>>
  +round number
  +chips number
  +minBet number
  +maxBet number
  +shoe ShoeComposition
}
class DecisionContext {
  <<interface>>
  +round number
  +hand Hand
  +dealerUpcard Card
  +canDouble boolean
  +shoe ShoeComposition
}
class Decision {
  <<interface>>
  +action BlackjackAction
  +ai AiDecisionInfo
}
class DecisionStrategy {
  <<interface>>
  +human boolean
  +bet(context) Promise~number~
  +decide(context) Promise~Decision~
}
class HumanDecision {
  +human = true
  -pendingBet function
  -pendingAction function
  +waitingFor string
  +bet() Promise~number~
  +decide() Promise~Decision~
  +submitBet(amount) boolean
  +submit(action) boolean
}
class BasicStrategy {
  +human = false
  +bet(ctx) Promise~number~
  +decide(ctx) Promise~Decision~
  +choose(ctx)$ BlackjackAction
}
class AiDecisionInfo {
  <<interface>>
  +round number
  +action BlackjackAction
  +handValue number
  +dealerUpcard string
  +evHit number
  +evStand number
  +evDouble number
  +reason string
  +elapsedMs number
  +fallback boolean
}
class AiBetInfo {
  <<interface>>
  +round number
  +amount number
  +trueCount number
  +reason string
  +fallback boolean
}
class PrologDecision {
  +human = false
  -ai AiClient
  -clock Clock
  -lastDecision AiDecisionInfo
  -lastBet AiBetInfo
  +lastDecision AiDecisionInfo
  +lastBet AiBetInfo
  +bet(ctx) Promise~number~
  +decide(ctx) Promise~Decision~
}
class PrologBlackjackPlayer {
  +strategy PrologDecision
}
class BlackjackBot {
  +numbered(n)$ BlackjackBot
}
 
class AiClient {
  <<interface>>
  +decision(query) Promise~AiDecisionAnswer~
  +bet(query) Promise~AiBetAnswer~
}
class HttpAiClient {
  -base string
  -fetch fetch
  -timeoutMs number
  +decision(query) Promise~AiDecisionAnswer~
  +bet(query) Promise~AiBetAnswer~
  -post(path, query) Promise
}
class AiDecisionQuery {
  <<interface>>
  +hand string[]
  +dealerUpcard string
  +shoe ShoeComposition
  +canDouble boolean
}
class AiDecisionAnswer {
  <<interface>>
  +decision BlackjackAction
  +evHit number
  +evStand number
  +evDouble number
  +reason string
}
class AiBetQuery {
  <<interface>>
  +shoe ShoeComposition
  +chips number
  +minBet number
  +maxBet number
}
class AiBetAnswer {
  <<interface>>
  +amount number
  +trueCount number
  +reason string
}
 
class BlackjackOptions {
  <<interface>>
  +autoplay boolean
  +ai AiClient
  +cpuStrategy function
  +thinkMs number[]
  +dealerPauseMs number
  +resultsPauseMs number
}
class BlackjackPhase {
  <<enumeration>>
  SETUP
  BETTING
  PLAYING
  DEALER
  RESULTS
  DONE
}
class BlackjackGame {
  -host HumanPlayer
  -autoplay boolean
  -cpuStrategy function
  -cpu function
  -timers Set
  -table BlackjackTable
  -phase BlackjackPhase
  -round number
  -turn Seat
  +startWith(cpus) void
  +host HumanPlayer
  +phase BlackjackPhase
  +round number
  +rounds number
  +table BlackjackTable
  +turn Seat
  +waitingFor string
  +limits object
  +standings() Standing[]
  +placeBet(amount) boolean
  +act(action) boolean
  #startData() MatchStartedData
  #onStart() void
  #buildResults() Placement[]
  #onFinish() void
  -strategyFor(player) DecisionStrategy
  -run() Promise
  -playRound(table, round) Promise
  -playSeat(table, seat, round) Promise
  -deal(table, seat, round) void
  -dealHouse(table, round, hidden) void
}
class BlackjackView {
  -game BlackjackGame
  -cpus number
  -betDraft number
  -whyOpen boolean
  +mount(el) void
  +dispose() void
  +handleKey(event) boolean
  +render() void
}
class blackjackDefinition {
  <<function>>
  +blackjackDefinition(ai) GameDefinition
}
 
Game <|-- BlackjackGame
BotPlayer <|-- BlackjackBot
BotPlayer <|-- PrologBlackjackPlayer
DecisionStrategy <|.. HumanDecision
DecisionStrategy <|.. BasicStrategy
DecisionStrategy <|.. PrologDecision
AiClient <|.. HttpAiClient
GameView <|.. BlackjackView
GameDefinition <|.. blackjackDefinition
 
BlackjackGame *-- BlackjackTable
BlackjackGame o-- Seat : turn
BlackjackGame --> BlackjackPhase
BlackjackGame ..> BlackjackOptions
BlackjackGame ..> BlackjackBot
BlackjackGame ..> PrologBlackjackPlayer : si hay IA
BlackjackGame ..> BasicStrategy
BlackjackGame ..> HumanDecision
BlackjackTable *-- Shoe
BlackjackTable *-- Dealer
BlackjackTable o-- Seat
Seat o-- DecisionStrategy
Seat *-- Hand
Seat ..> SeatResult
Dealer *-- Hand
Hand o-- Card
Shoe o-- Card
BlackjackTable ..> SeatResult
 
DecisionStrategy ..> BetContext
DecisionStrategy ..> DecisionContext
DecisionStrategy ..> Decision
Decision --> AiDecisionInfo
PrologDecision --> AiClient
PrologDecision --> AiDecisionInfo
PrologDecision --> AiBetInfo
PrologBlackjackPlayer *-- PrologDecision
AiClient ..> AiDecisionQuery
AiClient ..> AiDecisionAnswer
AiClient ..> AiBetQuery
AiClient ..> AiBetAnswer
 
BlackjackView --> BlackjackGame
blackjackDefinition ..> BlackjackGame
blackjackDefinition ..> BlackjackView
blackjackDefinition ..> AiClient
```
 
## 4. Snake
 
```mermaid
classDiagram
direction TB
 
class Game~G~ {
  <<externa>>
}
class GameView {
  <<externa>>
}
class GameDefinition {
  <<externa>>
}
 
class Point {
  <<interface>>
  +x number
  +y number
}
class Direction {
  <<enumeration>>
  UP
  DOWN
  LEFT
  RIGHT
}
class PointUtils {
  <<module Point.ts>>
  +point(x, y) Point
  +step(p, direction) Point
  +opposite(direction) Direction
  +same(a, b) boolean
  +keyOf(p) string
  +manhattan(a, b) number
}
class Grid {
  +width number
  +height number
  +label string
  +contains(p) boolean
  +center() Point
  +wrap(p) Point
  +randomFree(rng, taken) Point
}
class Snake {
  -body Point[]
  -direction Direction
  -queued Direction[]
  +head Point
  +body Point[]
  +length number
  +direction Direction
  +nextDirection Direction
  +turn(direction) boolean
  +nextHead() Point
  +advance(to) void
  +grow(cells) void
  +occupies(p) boolean
  +blocking() Point[]
}
class CollisionDetector {
  -grid Grid
  +check(snake, next, obstacles) DeathCause
}
class FoodKind {
  <<interface>>
  +points number
  +grow number
  +weight number
  +lifetimeMs number
}
class Food {
  <<interface>>
  +type FoodType
  +at Point
  +expiresAt number
}
class FoodModule {
  <<module Food.ts>>
  +FOODS Record
  +pickFood(rng) FoodType
}
class PowerUp {
  <<interface>>
  +kind PowerUpKind
  +at Point
  +expiresAt number
}
class PowerUpModule {
  <<module PowerUp.ts>>
  +POWERUP_DURATION_MS Record
  +POWERUP_KINDS PowerUpKind[]
  +POWERUP_CHANCE number
  +POWERUP_LIFETIME_MS number
  +SPEED_FACTOR object
}
class LevelPolicy {
  +fruitsPerLevel = 5
  +baseTickMs = 150
  +tickStepMs = 10
  +minTickMs = 60
  +obstaclesFromLevel = 3
  +obstaclesPerLevel = 4
  +maxObstacles = 24
  +levelFor(fruits) number
  +tickMs(level) number
  +speed(level) number
  +obstacles(level) number
}
class BotView {
  <<interface>>
  +snake Snake
  +target Point
  +obstacles Set
  +detector CollisionDetector
}
class SnakeBot {
  -rng Rng
  -budget number
  -eaten number
  -hungry number
  +MAX_MOVES_WITHOUT_FOOD$ number
  +careless boolean
  +newLife() void
  +ate() void
  +choose(view) Direction
}
class SnakeOptions {
  <<interface>>
  +grid Grid
  +lives number
  +respawnMs number
  +autoplay boolean
}
class SnakeGame {
  +grid Grid
  -host HumanPlayer
  -policy LevelPolicy
  -detector CollisionDetector
  -bot SnakeBot
  -obstacles Set
  -effects Map
  -snake Snake
  -food Food
  -powerUp PowerUp
  -livesLeft number
  -fruits number
  -level number
  -score number
  -focused boolean
  -dead boolean
  +snake Snake
  +food Food
  +powerUp PowerUp
  +obstacles Point[]
  +score number
  +livesLeft number
  +level number
  +effects object[]
  +dead boolean
  +paused boolean
  +autoplay boolean
  +tickMs number
  +turn(direction) boolean
  +setFocused(focused) void
  #startData() MatchStartedData
  #onStart() void
  #buildResults() Placement[]
  #finishData() object
  #onFinish() void
  -tick() void
  -expire() void
  -eat(food) void
  -pick(powerUp) void
  -die(cause) void
  -respawn() void
  -placeFood(type) void
  -placePowerUp() void
  -addObstacles(count) void
}
class SnakeCanvasView {
  -game SnakeGame
  -canvas HTMLCanvasElement
  -hud HTMLElement
  -message HTMLElement
  +mount(el) void
  +dispose() void
  +handleKey(event) boolean
  +render() void
  -draw() void
}
class snakeDefinition {
  <<const>>
  +id = snake
  +create(setup) SnakeGame
  +createView(game) SnakeCanvasView
}
 
Game <|-- SnakeGame
GameView <|.. SnakeCanvasView
GameDefinition <|.. snakeDefinition
 
SnakeGame *-- Grid
SnakeGame *-- Snake
SnakeGame *-- LevelPolicy
SnakeGame *-- CollisionDetector
SnakeGame o-- SnakeBot
SnakeGame o-- Food
SnakeGame o-- PowerUp
SnakeGame ..> SnakeOptions
SnakeGame ..> FoodModule
SnakeGame ..> PowerUpModule
CollisionDetector --> Grid
CollisionDetector ..> Snake
SnakeBot ..> BotView
BotView --> Snake
BotView --> CollisionDetector
Snake o-- Point
Snake --> Direction
Food --> Point
Food ..> FoodKind
PowerUp --> Point
Grid ..> Point
PointUtils ..> Point
PointUtils ..> Direction
SnakeCanvasView --> SnakeGame
snakeDefinition ..> SnakeGame
snakeDefinition ..> SnakeCanvasView
```
 
## 5. Consola (UI y orquestación)
 
```mermaid
classDiagram
direction TB
 
class Game~G~ {
  <<externa>>
}
class GameDeps {
  <<externa>>
}
class EventPublisher {
  <<externa>>
}
class OutboxRecovery {
  <<externa>>
}
class HttpTransport {
  <<externa>>
}
class PanelPage {
  <<externa, no incluida>>
  +mount() void
  +dispose() void
}
 
class GameView {
  <<interface>>
  +mount(el) void
  +render() void
  +dispose() void
  +handleKey(event) boolean
}
class GameSetup {
  <<interface>>
  +human HumanPlayer
  +autoplay boolean
}
class GameDefinition~G~ {
  <<interface>>
  +id G
  +title string
  +description string
  +create(setup) Game
  +createView(game) GameView
}
class GameRegistry {
  -games Map
  +register(definition) GameRegistry
  +get(id) GameDefinition
  +has(id) boolean
  +list() GameDefinition[]
}
class GAME_CATALOG {
  <<const catalog.ts>>
  id, title, description
}
class Instance {
  <<interface>>
  +id number
  +definition GameDefinition
  +game Game
}
class InstanceManagerOptions {
  <<interface>>
  +registry GameRegistry
  +outlet(matchId) EventOutlet
  +source EventSource
  +human() HumanPlayer
  +clock Clock
  +autoplay object
  +idleTimeoutMs number
  +awayAfterMs number
}
class InstanceManager {
  -opt InstanceManagerOptions
  -clock Clock
  -rng Rng
  -instances Instance[]
  -listeners Set
  -nextId number
  -focused number
  -hiddenAt number
  -awayTimer Timeout
  -away boolean
  +instances Instance[]
  +focused Instance
  +open(gameId) Instance
  +close(id) void
  +focus(id) void
  +checkIdle() void
  +setVisible(visible) void
  +closeTab() void
  +subscribe(listener) function
}
class GameWindow {
  <<interface>>
  +el HTMLElement
  +status HTMLElement
  +view GameView
  +unsubscribe function
}
class InstanceArea {
  -manager InstanceManager
  -windows Map
  -grid HTMLElement
  +mount(parent) void
  +dispose() void
  +focusedKeyHandler() function
  +render() void
  -add(instance) GameWindow
  -remove(id) void
}
class Route {
  <<type>>
  lobby
  play con gameId
  panel
  notFound con path
}
class Router {
  -onChange function
  +start() void
  +navigate(path) void
  +parseRoute(pathname)$ Route
}
class dom {
  <<module dom.ts>>
  +h(tag, attrs, children) HTMLElement
  +safeStorage object
}
class ConsoleApp {
  -root HTMLElement
  -registry GameRegistry
  -manager InstanceManager
  -router Router
  -page object
  -focusedView function
  +start() void
  -playerName() string
  -onKey(e) void
  -show(route) void
  -lobby(main) void
  -play(main, gameId) void
  -openFromUrl() void
  -open(gameId) void
  -mountInstances(main) void
}
 
GameRegistry o-- GameDefinition
GameDefinition ..> GameSetup
GameDefinition ..> GameView
GameDefinition ..> Game
GameSetup --|> GameDeps
 
InstanceManager --> GameRegistry
InstanceManager *-- Instance
InstanceManager ..> InstanceManagerOptions
Instance --> GameDefinition
Instance --> Game
 
InstanceArea --> InstanceManager
InstanceArea *-- GameWindow
GameWindow --> GameView
InstanceArea ..> dom
 
Router ..> Route
 
ConsoleApp *-- InstanceManager
ConsoleApp *-- Router
ConsoleApp --> GameRegistry
ConsoleApp ..> InstanceArea : crea por pagina
ConsoleApp ..> PanelPage : ruta panel
ConsoleApp ..> GAME_CATALOG
ConsoleApp ..> dom
ConsoleApp ..> OutboxRecovery : start
ConsoleApp ..> HttpTransport : crea
ConsoleApp ..> EventPublisher : uno por partida
```

## Reglas de diseño

1. Las clases de lógica no tocan el DOM ni `fetch`. Las vistas no cambian el estado del juego directamente; llaman métodos del juego.
2. Atributos privados (`#campo` o `private`) y estado expuesto solo por métodos de lectura.
3. Herencia solo donde hay un "es un" real (`Game`, `Player`); lo demás por composición (`BlackjackTable` tiene un `Shoe`, un `Dealer` y asientos).
4. `Rng` con semilla inyectable en cada juego para que las pruebas y el modo automático sean reproducibles.