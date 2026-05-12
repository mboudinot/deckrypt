import { test, expect } from "@playwright/test";
import { mockScryfall } from "./_helpers.js";

/* The sidebar's first block must NOT cram everything on one line.
 * Layout contract:
 *   row 1: Deck label + select + (trash button, when present)
 *   row 2: deck-status (transient ops messages only — hidden if empty)
 * The persistent "X commandant + Y cartes" text now lives in the
 * Analyze view, not in the sidebar. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
});

test("deck-bar lays label, select, and trash on one row; status is on its own", async ({ page }) => {
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();

  const labelBox = await page.locator(".deck-bar label[for=deck-select]").boundingBox();
  const selectBox = await page.locator("#deck-select").boundingBox();
  const trashBox = await page.locator("#btn-delete-deck").boundingBox();

  // Same row → vertical centers within 4px of each other.
  const labelCenter = labelBox.y + labelBox.height / 2;
  const selectCenter = selectBox.y + selectBox.height / 2;
  const trashCenter = trashBox.y + trashBox.height / 2;
  expect(Math.abs(labelCenter - selectCenter)).toBeLessThanOrEqual(4);
  expect(Math.abs(selectCenter - trashCenter)).toBeLessThanOrEqual(4);
});

test("deck-status no longer shows the deck composition after load", async ({ page }) => {
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
  // After a clean load the sidebar status is empty — composition went
  // to the Analyze view instead.
  const text = (await page.locator("#deck-status").textContent()).trim();
  expect(text).toBe("");
  // And :empty hides it, so it doesn't reserve vertical space.
  await expect(page.locator("#deck-status")).toBeHidden();
});

test("deck-status surfaces a warning when Scryfall can't find some cards", async ({ page }) => {
  // Patch the bulk endpoint so the first identifier is reported as
  // not_found — that's the codepath that should make the sidebar
  // status visible.
  await page.route("**/api.scryfall.com/cards/collection*", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    const ids = body.identifiers || [];
    const [missed, ...rest] = ids;
    const data = rest.map((id, i) => ({
      name: id.name || `Card ${i}`,
      set: "tst", collector_number: String(i + 1),
      type_line: "Creature", cmc: 1, colors: [], produced_mana: [],
      image_uris: {
        small: `https://test.scryfall.io/sm/tst/${i}.png`,
        normal: `https://test.scryfall.io/nm/tst/${i}.png`,
      },
    }));
    const not_found = missed ? [missed] : [];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ object: "list", data, not_found }),
    });
  });
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
  await expect(page.locator("#deck-status")).toBeVisible();
  await expect(page.locator("#deck-status")).toContainText("introuvable");
});
