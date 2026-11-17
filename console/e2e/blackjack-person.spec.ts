import { expect, test } from "@playwright/test";

// Issue #10: played by a person (no autoplay), the table must always say what
// it is waiting for and show the bet form again in round 2.
test("a person plays two rounds of blackjack with the buttons", async ({ page }) => {
  await page.goto("/play/blackjack?seed=3");
  const table = page.locator(".instance").first();
  await expect(table.locator(".bj-howto")).toContainText("Pedir (H)");
  await table.getByRole("button", { name: "Sentarse a la mesa" }).click();

  const hint = table.locator(".bj-hint");
  for (const round of [1, 2]) {
    await expect(table).toContainText(`Ronda ${round} de 10`, { timeout: 30_000 });
    await expect(hint).toContainText("Tu turno: escribí cuánto apostar");
    await table.getByRole("button", { name: "Apostar" }).click();

    // Stands as soon as it may decide; a blackjack or 21 skips the decision.
    const stand = table.getByRole("button", { name: "Plantarse (S)" });
    await expect(stand.or(hint.filter({ hasText: /Fin de la ronda/ }))).toBeVisible({
      timeout: 30_000,
    });
    if (await stand.isVisible()) {
      await expect(hint).toContainText("Tu turno: Pedir (H)");
      await stand.click();
    }
    await expect(hint).toContainText(`Fin de la ronda ${round}. La ronda ${round + 1} empieza`, {
      timeout: 30_000,
    });
  }
  await expect(table).toContainText("Ronda 3 de 10", { timeout: 30_000 });
  await expect(hint).toContainText("Tu turno: escribí cuánto apostar");
  await table.getByRole("button", { name: "Cerrar" }).click();
});
