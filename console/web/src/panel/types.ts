import type { GameId } from "@gameconsole/shared";

// The JSON of GameStats as the console server forwards it (server/src/stats).
// Every field is optional: the panel shows what arrives and never fills gaps
// by computing.

/** One game in the ingestor's GET /api/v1/games. */
export interface IngestorGame {
  gameId: string;
  open?: number;
  finished?: number;
  partial?: number;
  started?: number;
  events?: number;
  lastEventAt?: string | null;
}

/** The ingestor's GET /api/v1/stats. */
export interface IngestStats {
  received?: number;
  accepted?: number;
  rejected?: number;
  rejectedByCode?: Record<string, number>;
  activeMatches?: number;
}

/** The analyzer's GET /api/v1/summary. */
export interface OverallSummary {
  matches?: number;
  matchesByGame?: Record<string, number>;
  players?: number;
  avgDurationMsByGame?: Record<string, number>;
  patternsByType?: Record<string, number>;
  eventsByType?: Record<string, number>;
}

/** The analyzer's GET /api/v1/games/{id}/summary. */
export interface GameSummary {
  gameId?: string;
  matches?: number;
  partialMatches?: number;
  avgDurationMs?: number;
  playerEntries?: number;
  playersLeft?: number;
  abandonmentRate?: number;
  gameMetrics?: Record<string, unknown>;
  patterns?: Record<string, number>;
}

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  matches?: number;
  wins?: number;
  winPct?: number;
  avgMetric?: number | null;
}

export interface Leaderboard {
  gameId?: string;
  metric?: string | null;
  singlePlayer?: boolean;
  entries?: LeaderboardEntry[];
}

export interface PatternMatch {
  patternId: string;
  name?: string;
  matchId?: string;
  playerId?: string | null;
  atMs?: number;
  description?: string;
}

/** One match of GET /api/v1/matches (finished or live). */
export interface MatchSummary {
  matchId: string;
  gameId?: string;
  partial?: boolean;
  live?: boolean;
  analyzedAt?: string;
  durationMs?: number;
  players?: number;
  events?: number;
  patterns?: number;
}

/** GET /api/v1/matches/{matchId}. */
export interface MatchDetail {
  matchId: string;
  gameId?: string;
  partial?: boolean;
  live?: boolean;
  durationMs?: number;
  matchMetrics?: Record<string, unknown>;
  players?: { playerId: string; placement?: number | null; metrics?: Record<string, unknown> }[];
  patterns?: PatternMatch[];
}

export interface GameStatsView {
  summary: GameSummary | null;
  leaderboard: Leaderboard | null;
  patterns: PatternMatch[] | null;
  recent: MatchSummary[] | null;
  live: MatchSummary[] | null;
}

/** What GET /api/stats/stream sends every 2 s. */
export interface StatsSnapshot {
  generatedAt: string;
  gamestatsUp: boolean;
  lastOkAt: string | null;
  general: {
    games: IngestorGame[] | null;
    ingest: IngestStats | null;
    summary: OverallSummary | null;
  };
  byGame: Record<GameId, GameStatsView>;
}
