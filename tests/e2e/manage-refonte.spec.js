import { test, expect } from "@playwright/test";
import { mockScryfall } from "./_helpers.js";

/* Manage view refonte: 2-column layout, deck-summary header,
 * side panel with composition + bracket + activity stub. The
 * pre-existing manage.spec.js tests still target the inner panels
 * (#manage-cards, #manage-commanders) and pass without changes
 * because we kept those IDs; this spec covers the new shell. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
  await page.click("#tab-manage");
});

test("2-column layout: main panel on the left, side panel on the right", async ({ page }) => {
  const main = await page.locator(".manage-main").boundingBox();
  const side = await page.locator(".manage-side").boundingBox();
  expect(main).not.toBeNull();
  expect(side).not.toBeNull();
  expect(main.x).toBeLessThan(side.x);
});

test("deck-summary header shows the deck name + cards count + commander art", async ({ page }) => {
  /* Deck name comes straight from the def — never empty. */
  const name = await page.locator("#manage-deck-name").textContent();
  expect(name.length).toBeGreaterThan(0);
  expect(name).not.toBe("—");

  /* Card count + format label populated from the resolved deck. */
  const size = await page.locator("#manage-deck-size").textContent();
  expect(parseInt(size, 10)).toBeGreaterThan(0);

  await expect(page.locator("#manage-deck-format-label")).toContainText(/Commander|Format libre/);

  /* Commander image is loaded (mockScryfall returns a fake image URL). */
  const artSrc = await page.locator("#manage-deck-art").getAttribute("src");
  expect(artSrc).toBeTruthy();
});

test("color pips reflect the deck's commander color identity", async ({ page }) => {
  /* The seeded Sultai deck uses B/U/G commanders, so at least one
   * pip dot should render. */
  const pipCount = await page.locator("#manage-deck-pips .pip-dot").count();
  expect(pipCount).toBeGreaterThanOrEqual(1);
});

test("clicking 'Lancer une partie' switches to the play view", async ({ page }) => {
  /* The action button lives inside the deck-summary header. */
  await expect(page.locator("#view-play")).toBeHidden();
  await page.click("#btn-play-deck");
  await expect(page.locator("#view-play")).toBeVisible();
  await expect(page.locator("#view-manage")).toBeHidden();
});

test("side composition panel shows at least 5 categories with their counts", async ({ page }) => {
  const composition = page.locator("#manage-side-composition .composition-row");
  expect(await composition.count()).toBeGreaterThanOrEqual(5);
  /* Each row has a label + a numeric value. */
  await expect(composition.first().locator(".label")).toBeVisible();
  await expect(composition.first().locator(".value")).toBeVisible();
});

test("side bracket panel surfaces a numeric badge + a verdict line", async ({ page }) => {
  const big = page.locator("#manage-side-bracket .bracket-large");
  await expect(big).toBeVisible();
  const num = await big.textContent();
  expect(parseInt(num, 10)).toBeGreaterThanOrEqual(1);
  await expect(page.locator("#manage-side-bracket .manage-side-bracket-verdict")).toBeVisible();
});

test("Game Changer chip renders next to the name on a GC card row (Sol Ring)", async ({ page }) => {
  /* The seeded Sultai deck contains Sol Ring, the mock flags it
   * game_changer:true, and makeManageCardRow appends a .gc-chip
   * next to the name when the resolved card carries the flag. */
  const solRingRow = page.locator("#manage-cards .card-row", { hasText: "Sol Ring" }).first();
  await expect(solRingRow).toBeVisible();
  await expect(solRingRow.locator(".gc-chip")).toBeVisible();
  /* Non-GC rows don't get the chip. Forest is a basic land, never GC. */
  const forestRow = page.locator("#manage-cards .card-row", { hasText: "Forest" }).first();
  await expect(forestRow.locator(".gc-chip")).toHaveCount(0);
});

test("activity panel is a 'À venir' stub for now", async ({ page }) => {
  await expect(page.locator(".manage-side .manage-side-placeholder")).toContainText("à venir");
});
