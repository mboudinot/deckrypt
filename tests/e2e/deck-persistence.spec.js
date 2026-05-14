import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, seedSultaiDeck } from "./_helpers.js";

/* Persistence regression: edits made in the manage view must survive
 * an F5. The contract is "auto-save via commitDeckChange → localStorage
 * + queued Firestore push". Without this spec, a regression in the
 * write path (or worse, the boot read path) would silently drop user
 * data — the kind of bug that's invisible until the user complains.
 *
 * We don't touch Firestore here (TEST_MODE in sync.js skips the
 * cloud); the localStorage round-trip alone proves the local layer
 * works. The cloud layer is mocked but the same `commitDeck` is
 * exercised in production. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await page.click("#tab-manage");
  await page.locator("#manage-cards .card-row").first().waitFor();
});

test("paste-add persists across F5", async ({ page }) => {
  const COUNTERSPELL = "Counterspell";
  // Sultai doesn't ship with Counterspell — guarantees a fresh add.
  await expect(
    page.locator("#manage-cards .card-row", { hasText: COUNTERSPELL }),
  ).toHaveCount(0);

  await page.fill("#add-card-paste-text", `1 ${COUNTERSPELL}`);
  await page.click("#add-card-paste-btn");
  await expect(
    page.locator("#manage-cards .card-row", { hasText: COUNTERSPELL }),
  ).toHaveCount(1);

  // Hard reload — boot script re-reads localStorage from scratch.
  await page.reload();
  await page.click("#tab-manage");
  await page.locator("#manage-cards .card-row").first().waitFor();

  await expect(
    page.locator("#manage-cards .card-row", { hasText: COUNTERSPELL }),
  ).toHaveCount(1);
});

test("qty bump persists across F5", async ({ page }) => {
  // Pick a row whose qty isn't tied to a paste-add timer.
  const forestRow = page.locator("#manage-cards .card-row", { hasText: "Forest" }).first();
  const qty = forestRow.locator(".card-row-qty span");
  const initial = parseInt((await qty.textContent()).trim(), 10);

  await forestRow.locator(".card-row-qty button", { hasText: "+" }).click();
  await expect(qty).toHaveText(String(initial + 1));

  await page.reload();
  await page.click("#tab-manage");
  const reloaded = page
    .locator("#manage-cards .card-row", { hasText: "Forest" })
    .first()
    .locator(".card-row-qty span");
  await expect(reloaded).toHaveText(String(initial + 1));
});
