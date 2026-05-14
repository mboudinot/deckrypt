import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, seedSultaiDeck } from "./_helpers.js";

/* Full printing-picker flow regression: click a row's printing pill
 * → picker modal opens → click a tile → modal closes → SAME row's
 * printing label reflects the new printing. The existing
 * `printing-change-refreshes-analyze.spec.js` covers the analyze
 * view's reaction; this spec locks the manage-view source-of-truth
 * (the row's label) since the user reads that to confirm the swap. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await page.click("#tab-manage");
  // Wait for thumbnails to render — proxies "manage view ready".
  await expect.poll(
    async () => page.locator("#manage-cards .card-row-thumb img").count(),
    { timeout: 5000 },
  ).toBeGreaterThan(10);
});

/* Pin the basic-Forest row by its EXACT card name label, NOT by
 * `hasText: "Forest"` which also matches the creature "Great Forest
 * Druid" (rendered earlier in the DOM, so `.first()` resolves to the
 * wrong row). `getByText` with `{ exact: true }` only matches the
 * `.card-row-name-label` span whose entire text is "Forest". */
const forestRowOf = (page) => page.locator("#manage-cards .card-row").filter({
  has: page.getByText("Forest", { exact: true }),
});

test("picker swap updates the source row's printing label without leaving the modal open", async ({ page }) => {
  /* The seeded Sultai deck doesn't pin printings on its basic Forest
   * entry, so the row starts with the "édition par défaut" label.
   * The Scryfall mock returns 2 printings (CMD #1, LEA #2) for any
   * card; we pick LEA and confirm the row updates. */
  const forestRow = forestRowOf(page);
  const pill = forestRow.locator(".card-row-printing");
  await expect(pill).toContainText(/défaut/i);

  await pill.click();
  await expect(page.locator(".printing-picker")).toBeVisible();
  /* Wait for the tiles to actually render (the picker initially shows
   * the fetch-stage loader; tiles replace it once `searchPrintings`
   * resolves). Without this wait, `.click()` can fire on the loader. */
  await page.locator(".printing-tile").first().waitFor();

  await page.locator(".printing-tile").nth(1).click();
  await expect(page.locator("#modal")).not.toHaveClass(/open/);

  /* The same Forest row's pill should now read the picked printing's
   * set + cn. Mock returns the second tile as "LEA #2". */
  await expect(pill).toContainText(/LEA\s+#2/);
});

test("Escape closes the picker without applying a printing", async ({ page }) => {
  const forestRow = forestRowOf(page);
  const pill = forestRow.locator(".card-row-printing");
  const before = (await pill.textContent()).trim();

  await pill.click();
  await expect(page.locator(".printing-picker")).toBeVisible();
  await page.locator(".printing-tile").first().waitFor();

  await page.keyboard.press("Escape");
  await expect(page.locator("#modal")).not.toHaveClass(/open/);

  // Pill text unchanged — no accidental selection.
  await expect(pill).toHaveText(before);
});
