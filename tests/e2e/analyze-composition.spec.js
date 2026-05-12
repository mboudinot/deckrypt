import { test, expect } from "@playwright/test";
import { mockScryfall } from "./_helpers.js";

/* "Conformité au format" shows:
 *   - composition counts (commander count, non-commander count, total)
 *   - three legality rules below, each with an explicit pass/fail
 *     status: card count, colour identity, singleton. Replaces the
 *     earlier badge + bundled "Identité et singleton OK" line. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
  await page.click("#tab-analyze");
});

test("composition slot exists in the Conformité section and is populated", async ({ page }) => {
  const composition = page.locator("#analyze-composition");
  await expect(composition).toBeVisible();
  await expect(composition).toContainText("commandant");
  await expect(composition).toContainText(/total\s*:\s*\d+/);
});

test("commander deck renders five legality rules with explicit status", async ({ page }) => {
  /* All five criteria show up as individual rows — no more bundled
   * "Identité et singleton OK". Labels are checked in French. */
  const rows = page.locator("#analyze-legality .legality-row");
  await expect(rows).toHaveCount(5);
  const labels = await rows.locator("strong").allTextContents();
  expect(labels).toContain("Compte de cartes");
  expect(labels).toContain("Commander valide");
  expect(labels).toContain("Légalité en Commander");
  expect(labels).toContain("Identité de couleur");
  expect(labels).toContain("Singleton");
});

test("commander deck shows green ✓ icon when every rule passes", async ({ page }) => {
  /* The seeded Sultai deck is a clean 1+99 with no off-colour cards,
   * no non-basic duplicates, commanders typed as Legendary in the
   * mock, no banned cards → all five rules pass. */
  const okRows = page.locator("#analyze-legality .legality-row.legality-ok");
  await expect(okRows).toHaveCount(5);
});

test("count rule reads '100 cartes' on a conformant deck", async ({ page }) => {
  const countRow = page.locator("#analyze-legality .legality-row", { hasText: "Compte de cartes" });
  await expect(countRow.locator(".legality-detail")).toContainText(/100 cartes/);
});

test("switching to format libre falls back to the free-format placeholder", async ({ page }) => {
  await page.click("#tab-manage");
  await page.locator('#manage-format-select').selectOption("limited");
  await page.click("#tab-analyze");
  await expect(page.locator("#analyze-legality")).toContainText(/Format libre/);
  // No per-rule rows in libre mode.
  await expect(page.locator("#analyze-legality .legality-row")).toHaveCount(0);
});
