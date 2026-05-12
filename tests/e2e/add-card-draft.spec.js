import { test, expect } from "@playwright/test";
import { mockScryfall } from "./_helpers.js";

/* The add-card UI no longer commits on suggestion-click. Picking a
 * suggestion opens a draft slot where the user chooses an edition
 * + a quantity, then clicks "Ajouter au deck". That lets the user
 * register multiple printings of the same card (e.g. Island BFZ ×6
 * AND Island MOM ×4) as distinct entries — the data model already
 * supports it via (name, set, collector_number) identity. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
  await page.click("#tab-manage");
});

test("draft slot is hidden by default", async ({ page }) => {
  await expect(page.locator("#add-card-draft")).toBeHidden();
});

test("clicking a suggestion opens the draft, doesn't commit", async ({ page }) => {
  // The mock returns ["Sol Ring", "Sol", "Solar Tide"] for "sol*".
  const rowsBefore = await page.locator("#manage-cards .card-row").count();

  await page.locator("#add-card-input").fill("sol");
  await page.locator("#add-card-suggestions li", { hasText: "Sol Ring" }).first().click();

  await expect(page.locator("#add-card-draft")).toBeVisible();
  await expect(page.locator("#add-card-draft-name")).toHaveText("Sol Ring");
  // Suggestions list closes, input clears.
  await expect(page.locator("#add-card-suggestions")).toBeHidden();
  await expect(page.locator("#add-card-input")).toHaveValue("");
  // Nothing committed yet — manage rows unchanged.
  expect(await page.locator("#manage-cards .card-row").count()).toBe(rowsBefore);
});

test("within a single set the printings are sorted by collector_number numerically", async ({ page }) => {
  /* Override the helper's /cards/search mock so we get three OTJ
   * printings — the released-desc default would put 280 above 279,
   * but the new sort should put 279 above 280 (and 100 above both). */
  await page.route("**/api.scryfall.com/cards/search*", async (route) => {
    const url = route.request().url();
    if (!decodeURIComponent(url).includes("unique=prints")) {
      return route.fallback();
    }
    await route.fulfill({
      json: {
        data: [
          { name: "Test Card", set: "otj", collector_number: "280", set_name: "Outlaws of Thunder Junction", image_uris: { small: "https://test.scryfall.io/sm/otj/280.png", normal: "https://test.scryfall.io/nm/otj/280.png" } },
          { name: "Test Card", set: "otj", collector_number: "279", set_name: "Outlaws of Thunder Junction", image_uris: { small: "https://test.scryfall.io/sm/otj/279.png", normal: "https://test.scryfall.io/nm/otj/279.png" } },
          { name: "Test Card", set: "otj", collector_number: "100", set_name: "Outlaws of Thunder Junction", image_uris: { small: "https://test.scryfall.io/sm/otj/100.png", normal: "https://test.scryfall.io/nm/otj/100.png" } },
        ],
      },
    });
  });

  await page.locator("#add-card-input").fill("sol");
  await page.locator("#add-card-suggestions li", { hasText: "Sol Ring" }).first().click();
  const select = page.locator("#add-card-draft-printing");
  await expect(select).toBeEnabled();
  const optionTexts = await select.locator("option").allTextContents();
  // Index 0 is default placeholder; 1, 2, 3 should be 100, 279, 280
  // in that ascending order.
  expect(optionTexts[1]).toMatch(/#100/);
  expect(optionTexts[2]).toMatch(/#279/);
  expect(optionTexts[3]).toMatch(/#280/);
});

test("the printings select fetches and lists editions sorted alphabetically", async ({ page }) => {
  await page.locator("#add-card-input").fill("sol");
  await page.locator("#add-card-suggestions li", { hasText: "Sol Ring" }).first().click();

  /* The helper mock returns two printings: (cmd, "Commander") and
   * (lea, "Alpha"). Sorted alphabetically by set name → Alpha first,
   * Commander second. The first <option> is the default placeholder. */
  const select = page.locator("#add-card-draft-printing");
  await expect(select).toBeEnabled();
  const optionTexts = await select.locator("option").allTextContents();
  expect(optionTexts.length).toBe(3);
  // Index 0 is "Édition par défaut", then 1 = LEA (Alpha), 2 = CMD (Commander).
  expect(optionTexts[1]).toMatch(/LEA\s+#2\s+—\s+Alpha/);
  expect(optionTexts[2]).toMatch(/CMD\s+#1\s+—\s+Commander/);
});

test("submitting commits the entry with the chosen printing + qty", async ({ page }) => {
  await page.locator("#add-card-input").fill("sol");
  await page.locator("#add-card-suggestions li", { hasText: "Sol Ring" }).first().click();

  // Wait for printings to load, then pick CMD.
  const select = page.locator("#add-card-draft-printing");
  await expect(select).toBeEnabled();
  await select.selectOption("cmd:1");
  await page.locator("#add-card-draft-qty").fill("2");
  await page.click("#add-card-draft-submit");

  // Draft closes; a row with CMD #1 now exists (the seeded Sultai
  // deck already has a default-printing Sol Ring, so we filter on
  // the specific printing rather than asserting a total).
  await expect(page.locator("#add-card-draft")).toBeHidden();
  const newRow = page.locator("#manage-cards .card-row", { hasText: "Sol Ring" })
    .filter({ has: page.locator(".card-row-printing", { hasText: /CMD\s+#1/ }) });
  await expect(newRow).toHaveCount(1);
});

test("two same-name entries with different editions stay separate", async ({ page }) => {
  /* The defining feature of this UX change: Sol Ring CMD ×1 and
   * Sol Ring LEA ×1 should land as two distinct rows. The Sultai
   * default deck already carries a no-printing Sol Ring, so we
   * filter on the new printings rather than the row count overall. */
  const addOne = async (printingValue) => {
    await page.locator("#add-card-input").fill("sol");
    await page.locator("#add-card-suggestions li", { hasText: "Sol Ring" }).first().click();
    await expect(page.locator("#add-card-draft-printing")).toBeEnabled();
    await page.locator("#add-card-draft-printing").selectOption(printingValue);
    await page.click("#add-card-draft-submit");
    await expect(page.locator("#add-card-draft")).toBeHidden();
  };

  await addOne("cmd:1");
  await addOne("lea:2");

  const solRings = page.locator("#manage-cards .card-row", { hasText: "Sol Ring" });
  // Two new entries + the seeded Sol Ring with no printing = 3 rows.
  await expect(solRings).toHaveCount(3);
  const printings = await solRings.locator(".card-row-printing").allTextContents();
  expect(printings.some((t) => /CMD\s+#1/.test(t))).toBe(true);
  expect(printings.some((t) => /LEA\s+#2/.test(t))).toBe(true);
});

test("Annuler closes the draft without committing", async ({ page }) => {
  const rowsBefore = await page.locator("#manage-cards .card-row").count();
  await page.locator("#add-card-input").fill("sol");
  await page.locator("#add-card-suggestions li", { hasText: "Sol Ring" }).first().click();
  await expect(page.locator("#add-card-draft")).toBeVisible();
  await page.click("#add-card-draft-cancel");
  await expect(page.locator("#add-card-draft")).toBeHidden();
  expect(await page.locator("#manage-cards .card-row").count()).toBe(rowsBefore);
});

test("Enter in the qty field validates the draft", async ({ page }) => {
  await page.locator("#add-card-input").fill("sol");
  await page.locator("#add-card-suggestions li", { hasText: "Sol Ring" }).first().click();
  await expect(page.locator("#add-card-draft-printing")).toBeEnabled();
  // Pick a printing so the new entry has a distinct identity from
  // the seeded default-printing Sol Ring — otherwise addCard would
  // fold qty into the existing entry and the row count stays the
  // same. We're testing keyboard validation here, not merge logic.
  await page.locator("#add-card-draft-printing").selectOption("lea:2");
  await page.locator("#add-card-draft-qty").fill("3");
  await page.locator("#add-card-draft-qty").press("Enter");
  await expect(page.locator("#add-card-draft")).toBeHidden();
  const leaRow = page.locator("#manage-cards .card-row", { hasText: "Sol Ring" })
    .filter({ has: page.locator(".card-row-printing", { hasText: /LEA\s+#2/ }) });
  await expect(leaRow).toHaveCount(1);
});
