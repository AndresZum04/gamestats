// Formatting only: how a number from GameStats is written. Nothing here
// adds, averages or derives a figure; the values come computed by GameStats.

const integer = new Intl.NumberFormat("es-CR", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("es-CR", { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat("es-CR", { style: "percent", maximumFractionDigits: 1 });

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A count: 1 234. A missing value is "—". */
export const count = (v: unknown): string => (isNumber(v) ? integer.format(v) : "—");

export const number = (v: unknown): string => (isNumber(v) ? decimal.format(v) : "—");

/** A value that GameStats already gives as a percentage (0 to 100): "62,5 %". */
export const pct = (v: unknown): string => (isNumber(v) ? `${decimal.format(v)} %` : "—");

/** A value that GameStats gives as a ratio (0 to 1), like abandonmentRate. */
export const ratio = (v: unknown): string => (isNumber(v) ? percent.format(v) : "—");

/** Milliseconds written as "2 min 05 s" or "8,3 s". */
export function duration(ms: unknown): string {
  if (!isNumber(ms)) return "—";
  const seconds = ms / 1000;
  if (seconds < 60) return `${decimal.format(Math.round(seconds * 10) / 10)} s`;
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return `${min} min ${String(sec).padStart(2, "0")} s`;
}

/** How long ago a moment of the clock was: "hace 3 s". */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "nunca";
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return `hace ${seconds} s`;
  return `hace ${Math.floor(seconds / 60)} min`;
}

/** Any value of a metric: numbers, flags, texts and small objects as text. */
export function value(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (isNumber(v)) return number(v);
  if (typeof v === "boolean") return v ? "sí" : "no";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(value).join(", ");
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${label(k)}: ${value(x)}`)
      .join(" · ");
  }
  return String(v);
}

export const PATTERN_NAMES: Readonly<Record<string, string>> = {
  P1: "Racha de aciertos",
  P2: "Remontada",
  P3: "Frenesí",
  P4: "Muerte por codicia",
  P5: "Mano caliente",
  P6: "All-in por frustración",
};

export const GAME_NAMES: Readonly<Record<string, string>> = {
  trivia: "Trivia",
  snake: "Snake",
  blackjack: "Blackjack",
};

/** Spanish names of the metric keys GameStats uses; an unknown key stays as it is. */
const LABELS: Readonly<Record<string, string>> = {
  correct: "aciertos",
  wrong: "errores",
  timeouts: "sin tiempo",
  correctPct: "% de aciertos",
  avgResponseMs: "respuesta promedio (ms)",
  fastestCorrectMs: "acierto más rápido (ms)",
  correctPctByCategory: "% de aciertos por categoría",
  finalScore: "puntaje final",
  longestScoreStreak: "racha más larga",
  maxLength: "largo máximo",
  fruits: "frutas",
  fruitsPerMinute: "frutas por minuto",
  avgMsBetweenFruits: "ms entre frutas",
  deaths: "muertes",
  deathsByCause: "muertes por causa",
  fruitsPerLife: "frutas por vida",
  avgFruitsPerLife: "frutas por vida (promedio)",
  hands: "manos",
  wins: "ganadas",
  winPct: "% ganadas",
  netGain: "ganancia neta",
  bestHand: "mejor mano",
  worstHand: "peor mano",
  busts: "pasadas",
  blackjacks: "blackjacks",
  doubles: "dobladas",
  doubleWinPct: "% ganadas al doblar",
  doubleNet: "neto al doblar",
  left: "abandonó",
  disconnections: "desconexiones",
  awayMs: "tiempo ausente (ms)",
  players: "jugadores",
  playersLeft: "abandonos",
  hardestQuestion: "pregunta más difícil",
  fastestPlayer: "jugador más rápido",
  matchCorrectPct: "% de aciertos de la partida",
  houseGain: "ganancia de la casa",
  dealerBusts: "veces que la casa se pasó",
  highestBet: "apuesta más alta",
  tableWinner: "ganador de la mesa",
  bots: "CPU",
  aiDecisions: "decisiones de la IA",
  aiFallbacks: "respaldos de la IA",
  hardestCategory: "categoría más difícil",
  lengthRecord: "récord de largo",
  mostCommonDeathCause: "causa de muerte más común",
  humanTableWinPct: "% de mesas ganadas por humanos",
  cpuTableWinPct: "% de mesas ganadas por CPU",
  cpuTables: "mesas con CPU",
  category: "categoría",
  playerId: "jugador",
  matchId: "partida",
  length: "largo",
  questionId: "pregunta",
  number: "número",
  correctCount: "aciertos",
  avgCorrectMs: "ms por acierto",
  round: "ronda",
  amount: "monto",
};

export const label = (key: string): string => LABELS[key] ?? key;
