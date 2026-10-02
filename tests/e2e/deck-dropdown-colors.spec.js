import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, openDeckMenu } from "./_helpers.js";

/* Header deck-pill dropdown: each deck shows its commanders' colour
 * pips, and the list is sorted by colour count then name, format
 * libre last. The Scryfall mock gives the Sultai pair U/B + B/G, a
 * basic land its own colour, and any other card no colour. */

const DECKS = [
  { id: "libre", name: "Aaa libre", format: "limited", commanders: [], cards: [{ name: "Island", qty: 1 }] },
  { id: "sultai", name: "Sultai", format: "commander",
    commanders: [{ name: "Ukkima, Stalking Shadow" }, { name: "Cazur, Ruthless Stalker" }],
    cards: [{ name: "Island", qty: 1 }] },
  { id: "mono", name: "Mono vert", format: "commander", commanders: [{ name: "Forest" }], cards: [{ name: "Island", qty: 1 }] },
  { id: "colorless", name: "Zzz incolore", format: "commander", commanders: [{ name: "Kozilek Test" }], cards: [{ name: "Island", qty: 1 }] },
];

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await mockAuth(page);
  await page.addInitScript((decks) => {
    if (!localStorage.getItem("mtg-hand-sim:user-decks-v1")) {
      localStorage.setItem("mtg-hand-sim:user-decks-v1", JSON.stringify(decks));
    }
  }, DECKS);
  await page.goto("/index.html");
});

test("decks are sorted by colour count, then name, format libre last", async ({ page }) => {
  await openDeckMenu(page);
  const items = page.locator("#deck-dropdown-list .dropdown-item");
  await expect(items.locator(".deck-name-text"))
    .toHaveText(["Zzz incolore", "Mono vert", "Sultai", "Aaa libre"]);
});

test("each deck shows its commanders' colour pips", async ({ page }) => {
  await openDeckMenu(page);
  const pipsOf = (id) => page.locator(`#deck-dropdown-list [data-deck-id="${id}"] .pip-dot`);
  await expect(pipsOf("sultai")).toHaveCount(3);
  await expect(pipsOf("sultai").nth(0)).toHaveClass(/dot-u/);
  await expect(pipsOf("sultai").nth(2)).toHaveClass(/dot-g/);
  await expect(pipsOf("mono")).toHaveCount(1);
  await expect(pipsOf("mono")).toHaveClass(/dot-g/);
  await expect(pipsOf("colorless")).toHaveCount(0);
  await expect(pipsOf("libre")).toHaveCount(0);
});
