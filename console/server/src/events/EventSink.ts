/**
 * Where the server puts the events of one match. Events arrive already in
 * seq order and as JSON objects; the sink does not validate them (GameStats
 * does). A rejected promise means nothing can be assumed written, so the
 * browser sends the batch again; GameStats drops repeated eventIds.
 */
export interface EventSink {
  readonly kind: string;
  write(gameId: string, matchId: string, events: readonly unknown[]): Promise<void>;
}
