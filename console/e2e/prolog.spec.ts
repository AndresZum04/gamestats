import { expect, test } from "@playwright/test";
import { analyzed, matchIds, waitFinished } from "./helpers.js";

test("a blackjack table with 3 CPU finishes, and its CPU decided with Prolog", async ({
  page,
  request,
}) => {
  await page.goto("/play/blackjack?autoplay=1&seed=5");
  const matchId = (await matchIds(page))[0] ?? "";
  expect(matchId).toMatch(/^bj-/);

  // The table has the person's seat and 3 CPU; the panel "Por qué jugó así" fills in.
  await expect(page.locator(".bj-seat")).toHaveCount(4);
  const why = page.locator("details.bj-why");
  await why.locator("summary").click();
  await expect(why).toContainText("EV pedir");
  await expect(why.locator("tbody tr").first()).toContainText(/HIT|STAND|DOUBLE/, {
    timeout: 30_000,
  });

  await waitFinished(page, 1);
  await expect(page.locator(".warning")).toHaveCount(0); // no fallback notice

  const detail = await analyzed(request, matchId);
  expect(detail.matchMetrics.bots).toEqual(["cpu-1", "cpu-2", "cpu-3"]);
  expect(detail.matchMetrics.aiDecisions).toBeGreaterThan(0);
  expect(detail.matchMetrics.aiFallbacks).toBe(0);
  expect(detail.eventsByType.AI_DECISION).toBe(detail.matchMetrics.aiDecisions);
});
