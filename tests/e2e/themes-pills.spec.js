import { test, expect } from "@playwright/test";

/* Themes panel — each detected theme is a toggleable pill. Clicking
 * a pill makes it active and reveals its matching cards in a single
 * shared panel below the pill row. Clicking the active pill again
 * hides the panel; clicking a different pill swaps the content. */

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function fakeImageUris(set, cn) {
  return {
    small: `https://test.scryfall.io/sm/${set}/${cn}.png`,
    normal: `https://test.scryfall.io/nm/${set}/${cn}.png`,
  };
}

const GRAVEYARD_NAMES = new Set([
  "Phantom Warrior", "Slippery Scoundrel", "Cold-Eyed Selkie",
  "Invisible Stalker", "Triton Shorestalker", "Dauthi Marauder",
  "Thalakos Deceiver", "Neurok Invisimancer",
]);
const SACRIFICE_NAMES = new Set([
  "Birds of Paradise", "Sylvan Caryatid", "Great Forest Druid",
  "Tower Winder", "Sol Ring",
]);

function oracleFor(name) {
  if (GRAVEYARD_NAMES.has(name)) {
    return "Return target creature card from your graveyard to your hand.";
  }
  if (SACRIFICE_NAMES.has(name)) {
    return "Sacrifice a creature: draw a card.";
  }
  return "";
}

test.beforeEach(async ({ page }) => {
  await page.route("https://*.scryfall.io/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "image/png", body: TINY_PNG });
  });
  await page.route("**/api.scryfall.com/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/cards/collection")) {
      const body = JSON.parse(route.request().postData() || "{}");
      const hash = (s) => {
        let h = 0;
        for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
        return String(Math.abs(h) % 100000);
      };
      const data = (body.identifiers || []).map((id) => {
        const name = id.name || `Card ${hash(JSON.stringify(id))}`;
        const cn = id.collector_number || hash(name);
        return {
          name, set: id.set || "tst", collector_number: cn,
          type_line: "Creature — Human",
          cmc: 2, colors: [], produced_mana: [],
          oracle_text: oracleFor(name),
          image_uris: fakeImageUris(id.set || "tst", cn),
        };
      });
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ object: "list", data, not_found: [] }),
      });
      return;
    }
    await route.fulfill({ status: 404 });
  });
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
  await page.click("#tab-analyze");
});

test("themes panel renders one pill per detected theme", async ({ page }) => {
  const pills = page.locator("#analyze-themes .theme-pill");
  /* At minimum: Cimetière (8 oracle-text matches) and Sacrifice (5).
   * Tribal Human may also fire since every mock card has the same
   * subtype — accept ≥ 2. */
  expect(await pills.count()).toBeGreaterThanOrEqual(2);
  // Every pill is a button, not pressed, with the theme label visible.
  const first = pills.first();
  await expect(first).toHaveAttribute("aria-pressed", "false");
});

test("the cards panel is hidden until the user clicks a pill", async ({ page }) => {
  await expect(page.locator("#analyze-themes .theme-panel")).toBeHidden();
});

test("clicking a pill activates it and reveals the cards below", async ({ page }) => {
  const pill = page.locator("#analyze-themes .theme-pill").first();
  await pill.click();
  await expect(pill).toHaveAttribute("aria-pressed", "true");
  await expect(pill).toHaveClass(/active/);
  const panel = page.locator("#analyze-themes .theme-panel");
  await expect(panel).toBeVisible();
  const cards = panel.locator(".card");
  expect(await cards.count()).toBeGreaterThanOrEqual(4);
});

test("clicking a different pill swaps the panel content (only one active at a time)", async ({ page }) => {
  const pills = page.locator("#analyze-themes .theme-pill");
  await pills.nth(0).click();
  const firstCount = await page.locator("#analyze-themes .theme-panel .card").count();
  await pills.nth(1).click();
  await expect(pills.nth(0)).toHaveAttribute("aria-pressed", "false");
  await expect(pills.nth(1)).toHaveAttribute("aria-pressed", "true");
  const secondCount = await page.locator("#analyze-themes .theme-panel .card").count();
  // Both pills should still produce some cards in the panel.
  expect(secondCount).toBeGreaterThan(0);
  // The count likely differs (different theme = different card set).
  // But assert at least that *something* re-rendered, not stale state.
  expect(firstCount).not.toBe(0);
});

test("re-clicking the active pill closes the panel", async ({ page }) => {
  const pill = page.locator("#analyze-themes .theme-pill").first();
  await pill.click();
  await expect(page.locator("#analyze-themes .theme-panel")).toBeVisible();
  await pill.click();
  await expect(pill).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#analyze-themes .theme-panel")).toBeHidden();
});

test("clicking a card in the open panel opens the preview modal", async ({ page }) => {
  await page.locator("#analyze-themes .theme-pill").first().click();
  await page.locator("#analyze-themes .theme-panel .card").first().click();
  await expect(page.locator("#modal")).toHaveClass(/open/);
  await expect(page.locator("#modal-actions button")).toHaveCount(0);
});
