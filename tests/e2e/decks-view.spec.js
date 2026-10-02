import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, seedSultaiDeck } from "./_helpers.js";

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
});

async function openDecksView(page) {
  await page.click("#btn-deck-pill");
  await page.click("#btn-open-decks");
  await expect(page.locator("#view-decks")).toBeVisible();
}

test("'Voir tous mes decks' heads the dropdown and opens the decks page, with no nav tab active", async ({ page }) => {
  await page.click("#btn-deck-pill");
  const first = page.locator("#deck-dropdown-menu > :first-child");
  await expect(first).toHaveAttribute("id", "btn-open-decks");
  await expect(first).toContainText("Voir tous mes decks");
  await expect(page.locator("#deck-dropdown-count")).toHaveText("1");
  await page.click("#btn-open-decks");
  await expect(page.locator("#view-decks")).toBeVisible();
  await expect(page.locator("#deck-dropdown-menu")).toBeHidden();
  await expect(page.locator("#view-play")).toBeHidden();
  await expect(page.locator(".nav-tab.active")).toHaveCount(0);
});

test("the page counts the decks", async ({ page }) => {
  await openDecksView(page);
  await expect(page.locator("#decks-count")).toHaveText("1 deck");
});

test("a tile shows name, colours and bracket, and no warning on a conformant deck", async ({ page }) => {
  await openDecksView(page);
  const tile = page.locator(".deck-tile").first();
  await expect(tile.locator(".deck-tile-name")).toHaveText("Sultai — Ukkima & Cazur");
  await expect(tile.locator(".color-pips .pip-dot")).toHaveCount(3);
  await expect(tile.locator(".deck-tile-bracket")).toContainText(/Bracket \d/);
  await expect(tile.locator(".deck-tile-alert")).toHaveCount(0);
});

test("a non-conformant deck gets the warning line", async ({ page }) => {
  await page.click("#tab-manage");
  await page.locator("#manage-cards .card-row", { hasText: "Forest" }).first()
    .locator(".card-row-qty button", { hasText: "+" }).click();
  await openDecksView(page);
  const alert = page.locator(".deck-tile .deck-tile-alert");
  await expect(alert).toContainText("Non conforme : Compte de cartes");
  await expect(alert).toHaveClass(/is-error/);
});

test("clicking a tile opens the deck in Gérer", async ({ page }) => {
  await openDecksView(page);
  await page.locator(".deck-tile").first().click();
  await expect(page.locator("#view-manage")).toBeVisible();
  await expect(page.locator("#view-decks")).toBeHidden();
  await expect(page.locator("#tab-manage")).toHaveClass(/active/);
});

test("picking a deck in the header dropdown from « Mes decks » opens it in Gérer", async ({ page }) => {
  await openDecksView(page);
  await page.click("#btn-deck-pill");
  await page.locator("#deck-dropdown-list .dropdown-item").first().click();
  await expect(page.locator("#view-manage")).toBeVisible();
  await expect(page.locator("#view-decks")).toBeHidden();
});

test("a partner deck shows both commanders' art side by side", async ({ page }) => {
  await page.route("**/api.scryfall.com/cards/collection*", async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    for (const c of json.data) c.image_uris = { ...c.image_uris, art_crop: `https://test.scryfall.io/art/${c.collector_number}.jpg` };
    await route.fulfill({ response: res, json });
  });
  await page.evaluate(() => localStorage.removeItem("mtg-hand-sim:scryfall-cache-v1"));
  await page.reload();
  await page.locator("#commander-zone .card").first().waitFor();
  await openDecksView(page);
  await expect(page.locator(".deck-tile").first().locator(".deck-tile-art img")).toHaveCount(2);
});

test("a deck with a card Scryfall doesn't know still renders its tile", async ({ page }) => {
  await page.route("**/api.scryfall.com/cards/collection*", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    if (!(body.identifiers || []).some((id) => id.name === "Cardus Inexistus")) return route.fallback();
    await route.fulfill({ json: { object: "list", data: [], not_found: [{ name: "Cardus Inexistus" }] } });
  });
  await page.evaluate(() => {
    const key = "mtg-hand-sim:user-decks-v1";
    const decks = JSON.parse(localStorage.getItem(key));
    decks.push({ id: "typo-deck", name: "Deck avec coquille", format: "commander",
      commanders: decks[0].commanders, cards: [{ name: "Cardus Inexistus", qty: 1 }] });
    localStorage.setItem(key, JSON.stringify(decks));
  });
  await page.reload();
  await page.locator("#commander-zone .card").first().waitFor();
  await openDecksView(page);
  const tile = page.locator('.deck-tile[data-deck-id="typo-deck"]');
  await expect(tile.locator(".deck-tile-bracket")).toBeVisible();
  await expect(tile.locator(".deck-tile-skeleton")).toHaveCount(0);
});

test("a deck whose card has an explicit printing not yet cached still renders (regression)", async ({ page }) => {
  await page.evaluate(() => {
    const key = "mtg-hand-sim:user-decks-v1";
    const decks = JSON.parse(localStorage.getItem(key));
    decks.push({ id: "printing-deck", name: "Deck avec impression", format: "commander",
      commanders: decks[0].commanders,
      cards: [{ name: "Lightning Bolt", qty: 1, set: "m10", collector_number: "146" }] });
    localStorage.setItem(key, JSON.stringify(decks));
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.reload();
  await page.locator("#commander-zone .card").first().waitFor({ state: "attached" });
  await openDecksView(page);
  await expect(page.locator('.deck-tile[data-deck-id="printing-deck"] .deck-tile-name')).toHaveText("Deck avec impression");
  await expect(page.locator(".deck-tile")).toHaveCount(2);
  expect(errors).toEqual([]);
});
