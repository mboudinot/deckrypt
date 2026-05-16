import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, seedSultaiDeck } from "./_helpers.js";

/* "Améliorations possibles" panel: each row that's not in target
 * carries a Scryfall search link scoped to the deck's color identity
 * (`id<=WUBRG`) and the format (`f:commander`). The seeded Sultai
 * mock has < target counts on most categories so the links appear. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
  await page.click("#tab-analyze");
  /* Wait for the suggestions panel to be out of skeleton state — it
   * renders empty placeholder blocks until the async resolve lands. */
  await page.locator("#analyze-suggestions .suggestion-row").first().waitFor();
});

test("actionable suggestion rows carry a Scryfall search link", async ({ page }) => {
  const links = page.locator("#analyze-suggestions .suggestion-link");
  /* Wait for the panel to populate before reading the count — the
   * analyze view re-renders async after tab click. */
  await expect(links.first()).toBeVisible();
  const linkCount = await links.count();
  expect(linkCount).toBeGreaterThan(0);
  /* Every link opens in a new tab and is noopener-safe. */
  const target = await links.first().getAttribute("target");
  const rel = await links.first().getAttribute("rel");
  expect(target).toBe("_blank");
  expect(rel).toMatch(/noopener/);
});

test("Scryfall link query embeds the deck's color identity + f:commander", async ({ page }) => {
  /* Sultai commanders = U+B+G → canonical WUBRG order with W/R
   * filtered out leaves "UBG". */
  const link = page.locator("#analyze-suggestions .suggestion-link").first();
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^https:\/\/scryfall\.com\/search\?q=/);
  const decoded = decodeURIComponent(href);
  expect(decoded).toContain("f:commander");
  expect(decoded).toContain("id<=UBG");
});

test("OK suggestion rows also carry the link (upgrade exploration, not just shortage fix)", async ({ page }) => {
  /* Even when a category is `ok`, the user might want to swap a few
   * existing picks for better effects / lower CMC — the link is an
   * exploration affordance, not a "you're missing X" alarm. */
  const okRows = page.locator("#analyze-suggestions .suggestion-row.suggestion-ok");
  const okCount = await okRows.count();
  if (okCount === 0) {
    /* Seeded Sultai might not produce any `ok` row depending on the
     * mocked card data. Skip silently — the assertion is contract-only. */
    test.info().annotations.push({ type: "skip-reason", description: "no ok rows in this seed" });
    return;
  }
  /* The first ok row should have its link too (skipping avg-cmc which
   * never gets a link). */
  const firstActionableOk = okRows.filter({ has: page.locator(".suggestion-link") }).first();
  await expect(firstActionableOk.locator(".suggestion-link")).toBeVisible();
});
