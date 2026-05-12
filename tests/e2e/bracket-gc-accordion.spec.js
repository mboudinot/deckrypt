import { test, expect } from "@playwright/test";
import { mockScryfall } from "./_helpers.js";

/* Game Changer accordion in the Bracket panel. When the deck has at
 * least one card with `game_changer: true`, the bracket section shows
 * a collapsed <details> whose summary is the count and whose body is
 * a full thumbnail grid of the matching cards (same .card visuals as
 * the play view). Collapsed by default; clicking opens it. */

const GC_NAMES = new Set(["Sol Ring", "Birds of Paradise"]);

test.beforeEach(async ({ page }) => {
  /* Run the standard mock first, then layer a small override that
   * stamps `game_changer: true` on a couple of cards in the seeded
   * Sultai deck. */
  await mockScryfall(page);
  await page.route("**/api.scryfall.com/cards/collection*", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    let counter = 1;
    const data = (body.identifiers || []).map((id) => {
      const set = id.set || "tst";
      const cn = id.collector_number || String(counter++);
      const name = id.name || `Test Card ${counter}`;
      return {
        name, set, collector_number: cn,
        type_line: "Artifact",
        cmc: 1,
        colors: [], produced_mana: [],
        image_uris: {
          small: `https://test.scryfall.io/sm/${set}/${cn}.png`,
          normal: `https://test.scryfall.io/nm/${set}/${cn}.png`,
        },
        game_changer: GC_NAMES.has(name),
      };
    });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ object: "list", data, not_found: [] }),
    });
  });
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
  await page.click("#tab-analyze");
});

test("bracket panel shows a <details> accordion when game changers are present", async ({ page }) => {
  const details = page.locator("#analyze-bracket .gc-details");
  await expect(details).toBeVisible();
  // Collapsed by default — open attribute absent.
  await expect(details).not.toHaveAttribute("open", "");
  // Summary count includes "2 Game Changers" (Sol Ring + Birds of Paradise).
  await expect(page.locator("#analyze-bracket .gc-summary .gc-count")).toContainText(/2\s+Game Changers/);
});

test("the card grid is lazy-rendered on first expand", async ({ page }) => {
  /* Lazy: cards aren't built into the DOM until the first toggle.
   * Before clicking, the grid wrapper exists (empty) but has no
   * .card children. After clicking, the cards appear. */
  const cards = page.locator("#analyze-bracket .gc-cards .card");
  await expect(cards).toHaveCount(0);

  await page.click("#analyze-bracket .gc-summary");
  await expect(page.locator("#analyze-bracket .gc-details")).toHaveAttribute("open", "");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toBeVisible();
});

test("expanded cards render at the full thumbnail size (146px wide)", async ({ page }) => {
  await page.click("#analyze-bracket .gc-summary");
  /* The first .card image is wrapped in the .card box that the play
   * view uses — same width. Anything smaller would mean a CSS
   * specificity bug overriding the global .card rule. */
  const cardBox = await page.locator("#analyze-bracket .gc-cards .card").first().boundingBox();
  expect(cardBox.width).toBeGreaterThanOrEqual(140);
  expect(cardBox.width).toBeLessThanOrEqual(160);
});

test("clicking an expanded Game Changer card opens the shared preview modal", async ({ page }) => {
  await page.click("#analyze-bracket .gc-summary");
  await page.click("#analyze-bracket .gc-cards .card:first-child");
  await expect(page.locator("#modal")).toHaveClass(/open/);
  /* Same modal as commanders / manage thumbnails — read-only, so the
   * action footer stays empty. */
  await expect(page.locator("#modal-actions button")).toHaveCount(0);
  /* The modal uses Scryfall's "normal" image variant, not the 146px
   * thumbnail one. The src should reflect that. */
  const src = await page.locator("#modal-img").getAttribute("src");
  expect(src).toMatch(/\/nm\//);
});

test("chevron rotates when the accordion opens (visual affordance)", async ({ page }) => {
  const chev = page.locator("#analyze-bracket .gc-chevron");
  const before = await chev.evaluate((el) => getComputedStyle(el).transform);
  await page.click("#analyze-bracket .gc-summary");
  // Wait out the 200ms transition.
  await page.waitForTimeout(260);
  const after = await chev.evaluate((el) => getComputedStyle(el).transform);
  expect(after).not.toBe(before);
  /* Rotate(180deg) → matrix(-1, …) in computed style. */
  expect(after).toMatch(/matrix\(-1/);
});
