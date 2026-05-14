import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, seedSultaiDeck } from "./_helpers.js";

/* Lock the contract the user asked for: in BOTH themes, the play
 * view exposes exactly two button styles (.btn = secondary,
 * .btn.primary = primary). Both must have identical hover state
 * regardless of where the button lives (game-state bar vs modal
 * actions). Probe by sampling computed `background-color` on hover
 * on a known-secondary pair (#btn-draw vs the modal "Défausser") and
 * a known-primary pair (#btn-next-turn vs the modal "Jouer"). */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await page.locator("#hand .card").first().waitFor();
});

async function hoverAndBg(page, locator) {
  await locator.hover();
  /* .btn declares `transition: background 0.15s` — sample after the
   * transition has settled so the test doesn't read an interpolated
   * mid-tween value. */
  await page.waitForTimeout(250);
  return locator.evaluate((el) => getComputedStyle(el).backgroundColor);
}

for (const theme of ["studio", "editorial"]) {
  test.describe(`theme=${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.evaluate((t) => document.documentElement.setAttribute("data-direction", t), theme);
    });

    test("secondary .btn: Piocher hover === Défausser hover", async ({ page }) => {
      const piocherBg = await hoverAndBg(page, page.locator("#btn-draw"));
      await page.locator("#hand .card").first().click();
      const defausserBg = await hoverAndBg(
        page,
        page.locator("#modal-actions .btn", { hasText: "Défausser" }),
      );
      expect(defausserBg).toBe(piocherBg);
    });

    test("primary .btn.primary: Tour suivant hover === Jouer hover", async ({ page }) => {
      const tourBg = await hoverAndBg(page, page.locator("#btn-next-turn"));
      await page.locator("#hand .card").first().click();
      const jouerBg = await hoverAndBg(
        page,
        page.locator("#modal-actions .btn.primary", { hasText: "Jouer" }),
      );
      expect(jouerBg).toBe(tourBg);
    });
  });
}
