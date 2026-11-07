import { expect, test } from "@playwright/test";
import { matchIds, waitFinished } from "./helpers.js";

/** A number of the instances table of the panel ("En curso" is column 1, "Terminadas" 2). */
async function instances(panel: import("@playwright/test").Page, game: string, column: number) {
  const cell = panel.locator(`tr[data-key="instances-${game}"] td`).nth(column);
  return Number((await cell.textContent())?.replace(/\D/g, "") || "0");
}

test("the panel shows a running match, its partial stats and then the finished one", async ({
  context,
  page,
}) => {
  const panel = await context.newPage();
  await panel.goto("/panel?game=snake");
  await expect(panel.locator(".panel-status")).toContainText("Última actualización");
  await expect(panel.locator('tr[data-key="instances-snake"]')).toBeVisible();
  const finishedBefore = await instances(panel, "snake", 2);

  await page.goto("/play/snake?autoplay=1&seed=3");
  const matchId = (await matchIds(page))[0] ?? "";
  expect(matchId).toMatch(/^sn-/);

  // Running: the count goes up, and the match appears with partial stats (LIVE batches).
  await expect.poll(() => instances(panel, "snake", 1), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(panel.locator(`tr[data-key="match-${matchId}"]`)).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator(".warning")).toHaveCount(0);
  await expect(panel.locator(".chart canvas")).toBeVisible();

  // Its detail opens with a click.
  await panel.locator(`tr[data-key="match-${matchId}"] button`).first().click();
  await expect(panel.locator(".detail")).toContainText(matchId);

  // Finished: the finished count goes up.
  await waitFinished(page, 1);
  await expect
    .poll(() => instances(panel, "snake", 2), { timeout: 30_000 })
    .toBeGreaterThan(finishedBefore);
});
