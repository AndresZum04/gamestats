import { expect, test } from "@playwright/test";
import {
  analyzed,
  expectOwnEvents,
  gameOf,
  matchIds,
  rejectedSoFar,
  waitFinished,
} from "./helpers.js";

const GAMES = ["trivia", "snake", "blackjack"] as const;

test("6 automatic matches at once, 3 in one console and 3 in new tabs, reach GameStats unmixed", async ({
  context,
  page,
  request,
}) => {
  const rejectedBefore = await rejectedSoFar(request);

  // Three instances in the same console, with the lobby's "Jugar aquí" buttons.
  await page.goto("/?autoplay=1&seed=7");
  for (const game of GAMES) {
    await page
      .locator(`.card[data-game="${game}"]`)
      .getByRole("button", { name: "Jugar aquí" })
      .click();
  }
  await expect(page.locator(".instance")).toHaveCount(3);

  // Three more, each in a new tab with its own seed.
  const tabs = await Promise.all(
    GAMES.map(async (game, i) => {
      const tab = await context.newPage();
      await tab.goto(`/play/${game}?autoplay=1&seed=${11 + i}`);
      await expect(tab.locator(".instance")).toHaveCount(1);
      return tab;
    }),
  );

  const ids = [...(await matchIds(page)), ...(await Promise.all(tabs.map(matchIds))).flat()];
  expect(ids).toHaveLength(6);
  expect(new Set(ids).size).toBe(6);
  expect(ids.map(gameOf).sort()).toEqual([...GAMES, ...GAMES].sort());

  await Promise.all([waitFinished(page, 3), ...tabs.map((t) => waitFinished(t, 1))]);

  // GameStats has the 6 matches complete, each with only its own game's events.
  for (const id of ids) {
    const detail = await analyzed(request, id);
    expect(detail.gameId).toBe(gameOf(id));
    expect(detail.eventsByType.MATCH_STARTED).toBe(1);
    expect(detail.eventsByType.MATCH_FINISHED).toBe(1);
    expectOwnEvents(detail);
    expect(detail.players.some((p) => p.playerId.startsWith("p-"))).toBe(true);
  }
  expect(await rejectedSoFar(request)).toBe(rejectedBefore);
});
