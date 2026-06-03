import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, seedSultaiDeck } from "./_helpers.js";

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
  await page.click("#tab-analyze");
});

test("simulation panel renders 4 stat tiles + a 7-turn timeline + a final-state block", async ({ page }) => {
  await expect(page.locator("#analyze-sim")).toBeVisible();
  await expect(page.locator("#analyze-sim-info")).toHaveText(/1 partie \+ \d+ simulations/);
  await expect(page.locator(".sim-stat-tile")).toHaveCount(4);
  await expect(page.locator(".sim-turn")).toHaveCount(7);
  // T1 through T7 in order
  const turnNums = await page.locator(".sim-turn-num").allTextContents();
  expect(turnNums).toEqual(["T1", "T2", "T3", "T4", "T5", "T6", "T7"]);
  // Each turn has the 3 action lines (Pioché / Posé / Lancé).
  await expect(page.locator(".sim-turn").first().locator(".sim-turn-label"))
    .toHaveCount(3);
  // Final-state block + bibliothèque line.
  await expect(page.locator(".sim-final-head")).toBeVisible();
  await expect(page.locator(".sim-final-tail")).toContainText(/Bibliothèque/);
});

test("Relancer reshuffles and updates the timeline", async ({ page }) => {
  // Snapshot the cast-line text on T7, click Relancer, expect the panel
  // to re-render (the new T7 text may or may not differ — what matters
  // is the panel survives the click without crashing and stays valid).
  const before = await page.locator(".sim-turn").last().textContent();
  await page.click("#analyze-sim-reshuffle");
  await expect(page.locator(".sim-turn")).toHaveCount(7);
  await expect(page.locator(".sim-stat-tile")).toHaveCount(4);
  // Try a few clicks — at least one should produce a different turn
  // (deterministic seeds = the same shuffle, but seed is fresh each click).
  let changed = before !== (await page.locator(".sim-turn").last().textContent());
  for (let i = 0; i < 5 && !changed; i++) {
    await page.click("#analyze-sim-reshuffle");
    changed = before !== (await page.locator(".sim-turn").last().textContent());
  }
  expect(changed).toBe(true);
});

test("simulation panel sits between mana-base and types panels", async ({ page }) => {
  const manaBase = await page.locator("#analyze-mana-base").boundingBox();
  const sim = await page.locator("#analyze-sim").boundingBox();
  const types = await page.locator("#analyze-types").boundingBox();
  expect(sim.y).toBeGreaterThan(manaBase.y);
  expect(sim.y).toBeLessThan(types.y);
});

test("placeholder when the deck has fewer than 7 cards", async ({ page }) => {
  // Switch to a tiny deck on the fly.
  await page.evaluate(() => {
    localStorage.setItem("mtg-hand-sim:user-decks-v1", JSON.stringify([{
      id: "tiny-deck", name: "Tiny",
      commanders: [{ name: "Atraxa, Praetors' Voice" }],
      cards: [{ name: "Forest", qty: 3 }],
    }]));
    localStorage.setItem("mtg-hand-sim:defaults-seeded-v1", "1");
  });
  await page.reload();
  await page.locator("#commander-zone .card").first().waitFor();
  await page.click("#tab-analyze");
  await expect(page.locator("#analyze-sim")).toContainText(/au moins 7 cartes/);
  await expect(page.locator("#analyze-sim-reshuffle")).toBeHidden();
});
