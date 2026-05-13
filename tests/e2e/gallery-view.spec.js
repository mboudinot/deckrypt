import { test, expect } from "@playwright/test";
import { mockScryfall } from "./_helpers.js";

/* The Galerie view is a full-width visual layout — sidebar
 * disappears, cards rendered as type-grouped tiles. Pre-rendered
 * with the other views so the tab switch is instant. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
});

test("Galerie tab activates the view and hides the others", async ({ page }) => {
  await page.click("#tab-gallery");
  await expect(page.locator("#view-gallery")).toBeVisible();
  await expect(page.locator("#view-play")).toBeHidden();
  await expect(page.locator("#view-manage")).toBeHidden();
  await expect(page.locator("#view-analyze")).toBeHidden();
  await expect(page.locator("#tab-gallery")).toHaveClass(/active/);
});

test("Galerie body class flips to gallery-active for legacy hooks", async ({ page }) => {
  /* The global outer sidebar was removed when each view started
   * owning its own (play has .play-sidebar inside #view-play, manage
   * has .manage-side, etc.). The body.gallery-active class is still
   * toggled by switchView in case any future styling needs to
   * special-case the gallery's full-width layout. */
  await page.click("#tab-gallery");
  await expect(page.locator("body")).toHaveClass(/gallery-active/);
  await page.click("#tab-play");
  await expect(page.locator("body")).not.toHaveClass(/gallery-active/);
});

test("Galerie groups cards by type with section titles + counts", async ({ page }) => {
  await page.click("#tab-gallery");
  const groups = page.locator("#gallery-content .gallery-group");
  expect(await groups.count()).toBeGreaterThan(0);
  /* The seeded Sultai deck has commanders + main-deck Lands and
   * Creatures at minimum. Each group title carries a running count. */
  const labels = await groups.locator(".gallery-group-title span:first-child").allTextContents();
  expect(labels).toContain("Commandants");
  // Per-type counts are numeric and non-zero.
  for (const c of await groups.locator(".gallery-group-count").all()) {
    expect(parseInt((await c.textContent()).trim(), 10)).toBeGreaterThan(0);
  }
});

test("each tile is a clickable button with a card image", async ({ page }) => {
  await page.click("#tab-gallery");
  const tiles = page.locator(".gallery-tile");
  expect(await tiles.count()).toBeGreaterThan(10);
  // Every tile has an <img> (cards are resolved via Scryfall mock).
  await expect(tiles.first().locator("img")).toBeVisible();
});

test("clicking a tile opens the shared preview modal", async ({ page }) => {
  await page.click("#tab-gallery");
  await page.locator(".gallery-tile").first().click();
  await expect(page.locator("#modal")).toHaveClass(/open/);
  /* Read-only preview — no action buttons. */
  await expect(page.locator("#modal-actions button")).toHaveCount(0);
});

test("tiles for qty > 1 entries show a ×N badge", async ({ page }) => {
  /* The seeded Sultai deck has multiple Forests (qty 5) and Islands
   * (qty 6), so a qty badge must be visible somewhere in the
   * gallery. */
  await page.click("#tab-gallery");
  const badges = page.locator(".gallery-tile-qty");
  expect(await badges.count()).toBeGreaterThan(0);
  const text = await badges.first().textContent();
  expect(text.trim()).toMatch(/^×\d+$/);
});

test("Galerie is pre-rendered before its first tab click (instant switch)", async ({ page }) => {
  /* The tab switch should be a pure visibility toggle — content was
   * built during the initial deck-resolution + rerenderDeckViews
   * cycle. */
  await expect(page.locator("#gallery-content .gallery-tile").first()).toBeAttached();
});
