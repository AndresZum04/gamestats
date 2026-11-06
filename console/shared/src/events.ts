// Event model of the console. It follows the GameStats contract (schemaVersion
// 1.0): schemas/event.schema.json for the envelope and configs/games/*.json for
// the keys of each type. The contract test in shared/tests checks this file
// against those files, so a change in GameStats breaks the console's CI.

export const SCHEMA_VERSION = "1.0";
export const GAME_VERSION = "1.0";

export const GAME_IDS = ["trivia", "snake", "blackjack"] as const;
export type GameId = (typeof GAME_IDS)[number];

/** Prefix of each game's matchId, as GameStats documents it. */
export const MATCH_PREFIX: Readonly<Record<GameId, string>> = {
  trivia: "tv",
  snake: "sn",
  blackjack: "bj",
};

/** `mode` of each game's MATCH_STARTED. */
export const MATCH_MODE = { trivia: "CLASSIC", snake: "CLASSIC", blackjack: "TABLE" } as const;

/** Who produced the event: the console and the browser tab. */
export interface EventSource {
  consoleId: string;
  sessionId: string;
}

/** An empty `data` object. */
export type NoData = Record<string, never>;

// ---- General events (configs/games/_common.json) --------------------------

export interface Placement {
  playerId: string;
  placement: number;
  teamId?: string;
}

/** NO_CHIPS is the value GameStats uses for a blackjack player out of chips. */
export type LeaveReason = "CLOSED_TAB" | "QUIT" | "IDLE" | "NO_CHIPS";

interface CommonData {
  MATCH_FINISHED: { durationMs: number; results: Placement[]; finalScore?: number };
  PLAYER_JOINED: { teamId?: string };
  PLAYER_LEFT: { reason: LeaveReason };
  PLAYER_DISCONNECTED: NoData;
  PLAYER_RECONNECTED: { awayMs: number };
  SCORE_CHANGED: { delta: number; total: number; reason?: string };
}

// ---- Trivia ----------------------------------------------------------------

export type TriviaCategory = "CIENCIA" | "HISTORIA" | "DEPORTES" | "GEOGRAFIA" | "ENTRETENIMIENTO";
export type Difficulty = "EASY" | "MEDIUM" | "HARD";
export type AnswerOption = "A" | "B" | "C" | "D";

interface TriviaData extends CommonData {
  MATCH_STARTED: { players: string[]; mode: "CLASSIC"; questions: number };
  QUESTION_SHOWN: {
    questionId: string;
    number: number;
    category: TriviaCategory;
    difficulty: Difficulty;
    timeLimitMs: number;
  };
  ANSWER_SUBMITTED: {
    questionId: string;
    option: AnswerOption;
    correct: boolean;
    responseMs: number;
  };
  ANSWER_TIMEOUT: { questionId: string };
  QUESTION_CLOSED: { questionId: string; correctOption: AnswerOption; correctCount: number };
}

// ---- Snake -----------------------------------------------------------------

export type FoodType = "APPLE" | "GOLDEN" | "BONUS";
export type PowerUpKind = "SPEED" | "SLOW" | "SHIELD" | "DOUBLE_POINTS";
export type DeathCause = "WALL" | "SELF" | "OBSTACLE";

interface SnakeData extends CommonData {
  MATCH_STARTED: { players: string[]; mode: "CLASSIC"; lives: number; grid?: string };
  FOOD_EATEN: { foodType: FoodType; length: number; points: number };
  POWERUP_PICKED: { powerup: PowerUpKind; durationMs: number };
  LEVEL_UP: { level: number; speed: number };
  SNAKE_DIED: { cause: DeathCause; length: number; livesLeft: number };
  PLAYER_RESPAWNED: { livesLeft: number };
}

// ---- Blackjack -------------------------------------------------------------

/** The `action` of a DECISION event and the `decision` of an AI_DECISION. */
export type BlackjackAction = "HIT" | "STAND" | "DOUBLE";
export type HandOutcome = "WIN" | "LOSE" | "PUSH";

interface BlackjackData extends CommonData {
  MATCH_STARTED: {
    players: string[];
    mode: "TABLE";
    startingChips: number;
    rounds: number;
    bots?: string[];
  };
  ROUND_STARTED: { round: number };
  BET_PLACED: { round: number; amount: number; chipsBefore: number };
  CARD_DEALT: { round: number; card: string; handValue: number };
  DEALER_CARD: { round: number; card: string; hidden: boolean; dealerValue: number };
  DECISION: { round: number; handValue: number };
  AI_DECISION: {
    round: number;
    decision: BlackjackAction;
    handValue: number;
    dealerUpcard?: string;
    evHit?: number;
    evStand?: number;
    evDouble?: number;
    elapsedMs?: number;
    fallback?: boolean;
  };
  BUST: { round: number; handValue: number };
  BLACKJACK: { round: number };
  HAND_RESULT: { round: number; result: HandOutcome; payout: number; chips: number };
}

// ---- Envelope ----------------------------------------------------------------

/** The `data` of every event type, per game. */
export interface EventDataMap {
  trivia: TriviaData;
  snake: SnakeData;
  blackjack: BlackjackData;
}

export type EventType<G extends GameId> = keyof EventDataMap[G] & string;
export type EventData<G extends GameId, T extends EventType<G>> = EventDataMap[G][T];

/** One event with the GameStats envelope. Keys are in the order GameStats writes them. */
export interface GameEvent<G extends GameId = GameId, T extends EventType<G> = EventType<G>> {
  schemaVersion: typeof SCHEMA_VERSION;
  eventId: string;
  timestamp: string;
  gameId: G;
  gameVersion: typeof GAME_VERSION;
  matchId: string;
  seq: number;
  playerId: string | null;
  type: T;
  action?: string;
  source: EventSource;
  data: EventData<G, T>;
}

/** Any event of any game, as a union the compiler can narrow by gameId and type. */
export type AnyGameEvent = {
  [G in GameId]: { [T in EventType<G>]: GameEvent<G, T> }[EventType<G>];
}[GameId];

// ---- Runtime description of the contract ------------------------------------

/** Keys of T that are not optional. */
export type RequiredKeys<T> = {
  [K in keyof T]-?: Record<never, never> extends Pick<T, K> ? never : K;
}[keyof T];

export interface EventSpec<D> {
  /** The event must carry a playerId (playerRequired in the GameStats config). */
  playerRequired: boolean;
  /** The data keys GameStats needs: the config's keys plus the game's own (questions, lives...). */
  required: readonly RequiredKeys<D>[];
}

export type GameSpecs<G extends GameId> = {
  readonly [T in EventType<G>]: EventSpec<EventData<G, T>>;
};

const common = {
  MATCH_FINISHED: { playerRequired: false, required: ["durationMs", "results"] },
  PLAYER_JOINED: { playerRequired: true, required: [] },
  PLAYER_LEFT: { playerRequired: true, required: ["reason"] },
  PLAYER_DISCONNECTED: { playerRequired: true, required: [] },
  PLAYER_RECONNECTED: { playerRequired: true, required: ["awayMs"] },
  SCORE_CHANGED: { playerRequired: true, required: ["delta", "total"] },
} as const satisfies { readonly [T in keyof CommonData]: EventSpec<CommonData[T]> };

/** Every event type the console produces, with what GameStats requires of it. */
export const EVENT_SPECS: { readonly [G in GameId]: GameSpecs<G> } = {
  trivia: {
    ...common,
    MATCH_STARTED: { playerRequired: false, required: ["players", "mode", "questions"] },
    QUESTION_SHOWN: {
      playerRequired: false,
      required: ["questionId", "number", "category", "difficulty", "timeLimitMs"],
    },
    ANSWER_SUBMITTED: {
      playerRequired: true,
      required: ["questionId", "option", "correct", "responseMs"],
    },
    ANSWER_TIMEOUT: { playerRequired: true, required: ["questionId"] },
    QUESTION_CLOSED: {
      playerRequired: false,
      required: ["questionId", "correctOption", "correctCount"],
    },
  },
  snake: {
    ...common,
    MATCH_STARTED: { playerRequired: false, required: ["players", "mode", "lives"] },
    FOOD_EATEN: { playerRequired: true, required: ["foodType", "length", "points"] },
    POWERUP_PICKED: { playerRequired: true, required: ["powerup", "durationMs"] },
    LEVEL_UP: { playerRequired: true, required: ["level", "speed"] },
    SNAKE_DIED: { playerRequired: true, required: ["cause", "length", "livesLeft"] },
    PLAYER_RESPAWNED: { playerRequired: true, required: ["livesLeft"] },
  },
  blackjack: {
    ...common,
    MATCH_STARTED: {
      playerRequired: false,
      required: ["players", "mode", "startingChips", "rounds"],
    },
    ROUND_STARTED: { playerRequired: false, required: ["round"] },
    BET_PLACED: { playerRequired: true, required: ["round", "amount", "chipsBefore"] },
    CARD_DEALT: { playerRequired: true, required: ["round", "card", "handValue"] },
    DEALER_CARD: {
      playerRequired: false,
      required: ["round", "card", "hidden", "dealerValue"],
    },
    DECISION: { playerRequired: true, required: ["round", "handValue"] },
    AI_DECISION: { playerRequired: true, required: ["round", "decision", "handValue"] },
    BUST: { playerRequired: true, required: ["round", "handValue"] },
    BLACKJACK: { playerRequired: true, required: ["round"] },
    HAND_RESULT: { playerRequired: true, required: ["round", "result", "payout", "chips"] },
  },
};
