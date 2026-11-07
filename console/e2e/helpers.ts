import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { EVENT_SPECS, type GameId } from "@gameconsole/shared";

/** The matchIds of the instances open in a console page, in order. */
export async function matchIds(page: Page): Promise<string[]> {
  return page
    .locator(".instance[data-match-id]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-match-id") ?? ""));
}

/** Waits until the console page has `n` instances and all of them are finished. */
export async function waitFinished(page: Page, n: number, timeout = 4 * 60_000): Promise<void> {
  await expect(page.locator(".instance")).toHaveCount(n);
  await expect(page.locator(".instance .badge")).toHaveText(Array<string>(n).fill("Terminada"), {
    timeout,
  });
}

export interface MatchDetail {
  matchId: string;
  gameId: string;
  partial: boolean;
  live?: boolean;
  eventsByType: Record<string, number>;
  matchMetrics: Record<string, unknown>;
  players: { playerId: string; placement: number | null }[];
}

/** The analysis of a finished match, once GameStats has it complete. */
export async function analyzed(request: APIRequestContext, matchId: string): Promise<MatchDetail> {
  let detail: MatchDetail | null = null;
  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/stats/match/${matchId}`);
        if (!res.ok()) return "missing";
        detail = (await res.json()) as MatchDetail;
        return detail.partial || detail.live ? "partial" : "complete";
      },
      { timeout: 60_000, intervals: [1000] },
    )
    .toBe("complete");
  if (detail === null) throw new Error(`no analysis of ${matchId}`);
  return detail;
}

/** Events the ingestor rejected so far (GET /api/stats asks GameStats now). */
export async function rejectedSoFar(request: APIRequestContext): Promise<number> {
  const res = await request.get("/api/stats");
  expect(res.ok()).toBe(true);
  const snapshot = (await res.json()) as {
    gamestatsUp: boolean;
    general: { ingest: { rejected?: number } | null };
  };
  expect(snapshot.gamestatsUp, "GameStats must be up").toBe(true);
  return snapshot.general.ingest?.rejected ?? 0;
}

/** The game of a matchId, from its prefix. */
export function gameOf(matchId: string): GameId {
  const prefix = matchId.slice(0, 2);
  const game = ({ tv: "trivia", sn: "snake", bj: "blackjack" } as const)[prefix];
  if (game === undefined) throw new Error(`unknown prefix in ${matchId}`);
  return game;
}

/** Every type in the analysis belongs to that match's game: nothing mixed. */
export function expectOwnEvents(detail: MatchDetail): void {
  const allowed = Object.keys(EVENT_SPECS[gameOf(detail.matchId)]);
  for (const type of Object.keys(detail.eventsByType)) {
    expect(allowed, `${type} in ${detail.matchId}`).toContain(type);
  }
}
