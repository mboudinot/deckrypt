import { test, expect } from "@playwright/test";
import { mockScryfall, presetStorage } from "./_helpers.js";

/* Regression coverage for the "Sultai disappeared" bug: the seeding
 * gate was tied to whether the user-decks key existed at all, so any
 * pre-existing user got skipped. Now the gate is a separate flag and
 * the seed is a non-destructive merge. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
});

test("first load: default decks (Sultai) are seeded into the selector", async ({ page }) => {
  await page.goto("/index.html");
  const options = await page.locator("#deck-select option").allTextContents();
  expect(options).toContain("Sultai — Ukkima & Cazur");
});

test("existing user (pre-migration) gets defaults appended without losing their decks", async ({ page }) => {
  await presetStorage(page, {
    "mtg-hand-sim:user-decks-v1": [
      { id: "user-meren", name: "Meren", commanders: [], cards: [{ name: "Forest", qty: 1 }] },
    ],
  });
  await page.goto("/index.html");
  const options = await page.locator("#deck-select option").allTextContents();
  expect(options).toContain("Meren");
  expect(options).toContain("Sultai — Ukkima & Cazur");
});

test("warm-cache F5 skips the loading flash and renders synchronously", async ({ page }) => {
  // First visit: cold cache, fetch via Scryfall (mocked), populate
  // localStorage with the resolved cards.
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();

  // Second visit: cache is warm. switchDeck takes the synchronous
  // path — the "Chargement…" placeholder text never appears in the
  // commander zone.
  let sawLoadingFlash = false;
  page.on("console", () => {});  // noop, just to ensure listener wiring works
  await page.goto("/index.html");
  // If the sync path is taken, the commander card is in the DOM by
  // the time the load event fires. The "Chargement" placeholder
  // never gets a chance to render. We assert by reading the DOM
  // immediately and checking the placeholder is absent.
  const text = await page.locator("#commander-zone").innerText();
  expect(text).not.toMatch(/Chargement/);
  // And the actual deck content is there.
  await expect(page.locator("#commander-zone .card").first()).toBeVisible();
});

test("once seeded, deleted defaults stay deleted on reload", async ({ page }) => {
  await presetStorage(page, {
    "mtg-hand-sim:user-decks-v1": [],
    "mtg-hand-sim:defaults-seeded-v1": "1",
  });
  await page.goto("/index.html");
  await expect(page.locator("#deck-select option")).toHaveCount(0);
});
