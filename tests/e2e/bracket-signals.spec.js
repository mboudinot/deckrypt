import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, seedSultaiDeck } from "./_helpers.js";

const ORACLE_BY_NAME = {
  "Arcane Signet": "Destroy all lands.",
  "Tower Winder": "Take an extra turn after this one.",
};

async function openAnalyze(page, oracleByName) {
  await mockScryfall(page);
  await page.route("**/api.scryfall.com/cards/collection*", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    const data = (body.identifiers || []).map((id, i) => {
      const cn = id.collector_number || String(i + 1);
      return {
        name: id.name, set: id.set || "tst", collector_number: cn,
        type_line: "Artifact", cmc: 1, colors: [], produced_mana: [],
        oracle_text: oracleByName[id.name] || "",
        image_uris: { small: `https://test.scryfall.io/sm/${cn}.png`, normal: `https://test.scryfall.io/nm/${cn}.png` },
      };
    });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ object: "list", data, not_found: [] }) });
  });
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
  await page.click("#tab-analyze");
}

test("mass land denial + extra turns raise the bracket and list the cards", async ({ page }) => {
  await openAnalyze(page, ORACLE_BY_NAME);
  await expect(page.locator("#analyze-bracket .bracket-circle")).toHaveText("4");
  const signals = page.locator("#analyze-bracket .bracket-signals li");
  await expect(signals).toHaveCount(2);
  await expect(signals.nth(0)).toContainText("Destruction massive de terrains");
  await expect(signals.nth(0)).toContainText("Arcane Signet");
  await expect(signals.nth(1)).toContainText("Tower Winder");
});

test("no signal list on a deck without mass land denial or extra turns", async ({ page }) => {
  await openAnalyze(page, {});
  await expect(page.locator("#analyze-bracket .bracket-circle")).toHaveText("1");
  await expect(page.locator("#analyze-bracket .bracket-signals")).toHaveCount(0);
});
