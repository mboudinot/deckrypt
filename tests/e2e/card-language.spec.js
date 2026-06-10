import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, openSettings, presetStorage } from "./_helpers.js";

/* The card-name language is a GLOBAL preference: the EN/FR switch in
 * Gérer and the segmented control in Réglages drive the same state, and
 * every deck view (Gérer, Analyser, Galerie) follows it. The mock
 * Scryfall returns `[FR] <name>` for any lang:fr search, so a translated
 * name is recognisable by its prefix. */

const KRENKO_DECK = [{
  id: "krenko-deck", name: "Krenko",
  commanders: [{ name: "Krenko, Mob Boss" }],
  cards: [{ name: "Forest", qty: 1 }],
}];

async function seedKrenko(page) {
  // addInitScript-based so it runs before the app scripts, on every
  // navigation — safe to call before page.goto.
  await presetStorage(page, {
    "mtg-hand-sim:user-decks-v1": KRENKO_DECK,
    "mtg-hand-sim:defaults-seeded-v1": "1",
  });
}

test("the card language defaults to FR for a fresh account", async ({ page }) => {
  await mockScryfall(page);
  // cardLang:null opts out of the EN test-baseline so we exercise the
  // real product default.
  await mockAuth(page, undefined, { cardLang: null });
  await seedKrenko(page);
  await page.goto("/index.html");
  await page.click("#tab-manage");

  await expect(page.locator("#lang-switch-fr")).toHaveClass(/active/);
  await expect(page.locator("#manage-cards .card-row-name").first())
    .toHaveText(/^\[FR\] /, { timeout: 5000 });
});

test("switching language in Gérer also translates names in Analyser", async ({ page }) => {
  await mockScryfall(page);
  await mockAuth(page); // EN baseline
  await seedKrenko(page);
  await page.goto("/index.html");

  // Analyser, EN baseline: the token-source line credits the English name.
  await page.click("#tab-analyze");
  const source = page.locator("#analyze-token-sources .sim-card-link").first();
  await expect(source).toHaveText("Krenko, Mob Boss", { timeout: 5000 });

  // Flip to FR from the Gérer switch, then come back to Analyser.
  await page.click("#tab-manage");
  await page.click("#lang-switch-fr");
  await page.click("#tab-analyze");
  await expect(page.locator("#analyze-token-sources .sim-card-link").first())
    .toHaveText(/^\[FR\] /, { timeout: 5000 });
});

test("the Réglages control drives the global language and the Gérer switch", async ({ page }) => {
  await mockScryfall(page);
  await mockAuth(page); // EN baseline
  await seedKrenko(page);
  await page.goto("/index.html");
  await page.click("#tab-manage");
  await expect(page.locator("#lang-switch-en")).toHaveClass(/active/);

  // Settings → Préférences → Français.
  await openSettings(page);
  await page.click('.settings-nav-item[data-settings-tab="preferences"]');
  await page.click('.segmented[data-segmented="card-lang"] button[data-value="fr"]');
  await page.click("#btn-settings-close");

  // The Gérer switch reflects the change and the rows are translated.
  await expect(page.locator("#lang-switch-fr")).toHaveClass(/active/);
  await expect(page.locator("#manage-cards .card-row-name").first())
    .toHaveText(/^\[FR\] /, { timeout: 5000 });

  // Reopening settings shows FR as the active segment.
  await openSettings(page);
  await page.click('.settings-nav-item[data-settings-tab="preferences"]');
  await expect(page.locator('.segmented[data-segmented="card-lang"] button[data-value="fr"]'))
    .toHaveClass(/active/);
});
