import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, seedSultaiDeck } from "./_helpers.js";

/* The Galerie view is a full-width visual layout — sidebar
 * disappears, cards rendered as type-grouped tiles. Pre-rendered
 * with the other views so the tab switch is instant. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await mockAuth(page);
  await seedSultaiDeck(page);
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
  const labels = await groups.locator(".panel-head h3").allTextContents();
  expect(labels).toContain("Commandants");
  // Per-type counts are numeric and non-zero — panel-meta reads "N carte(s)".
  for (const c of await groups.locator(".panel-meta").all()) {
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

/* Toolbar — search + type chips + color chips + counter.
 * Mirrors the claude.design view-gallery toolbar, but kept on top
 * of the existing type-grouped panels (filters hide non-matching
 * panels rather than flattening the grid). */

test("toolbar renders with search, type chips, color chips and counter", async ({ page }) => {
  await page.click("#tab-gallery");
  const toolbar = page.locator("#gallery-toolbar");
  await expect(toolbar).toBeVisible();
  await expect(toolbar.locator(".gallery-toolbar-search input")).toBeVisible();
  /* Two chip groups: type + color. Each has a "Tous types" / "Toutes"
   * default chip in active state, plus one chip per type/color
   * present in the deck. */
  const groups = toolbar.locator(".gallery-toolbar-chips");
  await expect(groups).toHaveCount(2);
  await expect(toolbar.locator(".gallery-chip.active", { hasText: "Tous types" })).toHaveCount(1);
  await expect(toolbar.locator(".gallery-chip.active", { hasText: "Toutes" })).toHaveCount(1);
  /* Counter "X / Y cartes" with X == Y at rest. */
  const count = await toolbar.locator(".gallery-toolbar-count").textContent();
  const match = count.match(/^(\d+)\s*\/\s*(\d+)\s*cartes$/);
  expect(match).not.toBeNull();
  expect(match[1]).toBe(match[2]);
});

test("type chip narrows panels and updates counter", async ({ page }) => {
  await page.click("#tab-gallery");
  /* Click the "Terrains" chip — only the Lands panel should remain. */
  await page.locator("#gallery-toolbar .gallery-chip", { hasText: "Terrains" }).click();
  const titles = await page.locator("#gallery-content .panel-head h3").allTextContents();
  expect(titles).toEqual(["Terrains"]);
  /* Counter X should equal the sum of land qty (Forest 5 + Island 6
   * + Swamp 6 = 17 in the seeded Sultai fixture). The denominator
   * stays the deck total. */
  const count = await page.locator("#gallery-toolbar .gallery-toolbar-count").textContent();
  const [, x, y] = count.match(/^(\d+)\s*\/\s*(\d+)\s*cartes$/);
  expect(parseInt(x, 10)).toBe(17);
  expect(parseInt(y, 10)).toBeGreaterThan(parseInt(x, 10));
});

test("color Multi chip keeps only the commanders panel", async ({ page }) => {
  /* The two seeded commanders are the only cards with `colors.length
   * >= 2` (UB + BG). Everything else has colors=[] in the mock, so
   * Multi narrows the gallery to just Commandants. */
  await page.click("#tab-gallery");
  await page.locator("#gallery-toolbar .gallery-chip", { hasText: /^Multi$/ }).click();
  const titles = await page.locator("#gallery-content .panel-head h3").allTextContents();
  expect(titles).toEqual(["Commandants"]);
  const count = await page.locator("#gallery-toolbar .gallery-toolbar-count").textContent();
  expect(count).toMatch(/^2\s*\//);
});

test("search filters by name and updates counter", async ({ page }) => {
  await page.click("#tab-gallery");
  const input = page.locator("#gallery-toolbar .gallery-toolbar-search input");
  await input.fill("sol");
  /* Only Sol Ring matches "sol" (case-insensitive) in the Sultai
   * deck. Panels collapse to a single Creature (the mock types every
   * non-land as Creature, including Sol Ring). */
  const tiles = page.locator("#gallery-content .gallery-tile");
  await expect(tiles).toHaveCount(1);
  await expect(tiles.first()).toHaveAttribute("title", "Sol Ring");
  const count = await page.locator("#gallery-toolbar .gallery-toolbar-count").textContent();
  expect(count).toMatch(/^1\s*\//);
  /* Erasing the search restores the full gallery. */
  await input.fill("");
  await expect(page.locator("#gallery-content .gallery-tile").first()).toBeVisible();
});

test("clear button wipes the search and re-applies filters", async ({ page }) => {
  await page.click("#tab-gallery");
  const input = page.locator("#gallery-toolbar .gallery-toolbar-search input");
  const clear = page.locator("#gallery-toolbar .gallery-toolbar-search-clear");
  /* Clear button is hidden while the input is empty (CSS via
   * :placeholder-shown). Becomes visible as soon as the user types. */
  await expect(clear).toBeHidden();
  await input.fill("sol");
  await expect(clear).toBeVisible();
  await expect(page.locator("#gallery-content .gallery-tile")).toHaveCount(1);
  await clear.click();
  await expect(input).toHaveValue("");
  await expect(clear).toBeHidden();
  /* Full gallery is back after the wipe. */
  expect(await page.locator("#gallery-content .gallery-tile").count()).toBeGreaterThan(10);
});

test("search matches FR translations from the cache", async ({ page }) => {
  /* The FR cache is the same one Manage's EN/FR toggle fills (see
   * js/translations.js, project_translations_fr memory). Pre-seed
   * it via addInitScript so the search has FR names available
   * without depending on the async fetchFrenchNames round-trip
   * timing. */
  await page.addInitScript(() => {
    localStorage.setItem("mtg-hand-sim:translations-fr-v1", JSON.stringify({
      "Sol Ring": "Anneau solaire",
    }));
  });
  await page.reload();
  await page.locator("#commander-zone .card").first().waitFor();
  await page.click("#tab-gallery");
  await page.locator("#gallery-toolbar .gallery-toolbar-search input").fill("anneau");
  const tiles = page.locator("#gallery-content .gallery-tile");
  await expect(tiles).toHaveCount(1);
  await expect(tiles.first()).toHaveAttribute("title", "Sol Ring");
});

test("search with no match shows the empty-filter placeholder", async ({ page }) => {
  await page.click("#tab-gallery");
  await page.locator("#gallery-toolbar .gallery-toolbar-search input").fill("zzznomatch");
  await expect(page.locator("#gallery-content .panel")).toHaveCount(0);
  await expect(page.locator("#gallery-content .placeholder-empty")).toHaveText(
    "Aucune carte ne correspond aux filtres.",
  );
});
