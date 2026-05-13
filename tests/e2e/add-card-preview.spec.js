import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, seedSultaiDeck } from "./_helpers.js";

/* When the user selects an edition in the add-card draft, the
 * preview <img> swaps to that printing's art. Lets them visually
 * validate the printing before committing. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await page.click("#tab-manage");
});

test("preview is hidden until printings load", async ({ page }) => {
  await expect(page.locator("#add-card-draft-preview")).toBeHidden();
});

test("preview appears with the first (most recent) printing after suggestion click", async ({ page }) => {
  await page.locator("#add-card-input").fill("sol");
  await page.locator("#add-card-suggestions li", { hasText: "Sol Ring" }).first().click();
  /* searchPrintings is mocked to return CMD #1 then LEA #2, so the
   * default ("most recent") preview should be CMD #1. */
  const preview = page.locator("#add-card-draft-preview");
  await expect(preview).toBeVisible();
  const src = await preview.getAttribute("src");
  expect(src).toMatch(/\/nm\/cmd\/1\./);
});

test("changing the edition swaps the preview image", async ({ page }) => {
  await page.locator("#add-card-input").fill("sol");
  await page.locator("#add-card-suggestions li", { hasText: "Sol Ring" }).first().click();
  const preview = page.locator("#add-card-draft-preview");
  await expect(preview).toBeVisible();

  await page.locator("#add-card-draft-printing").selectOption("lea:2");
  // The select fires `change` synchronously, so the src should update
  // immediately.
  await expect(preview).toHaveAttribute("src", /\/nm\/lea\/2\./);

  await page.locator("#add-card-draft-printing").selectOption("cmd:1");
  await expect(preview).toHaveAttribute("src", /\/nm\/cmd\/1\./);
});

test("preview falls back to the first printing when the user picks 'Édition par défaut'", async ({ page }) => {
  await page.locator("#add-card-input").fill("sol");
  await page.locator("#add-card-suggestions li", { hasText: "Sol Ring" }).first().click();
  await page.locator("#add-card-draft-printing").selectOption("lea:2");
  await page.locator("#add-card-draft-printing").selectOption("");
  /* Defaulting back: preview reverts to the first (CMD) printing. */
  await expect(page.locator("#add-card-draft-preview"))
    .toHaveAttribute("src", /\/nm\/cmd\/1\./);
});

test("cancelling the draft hides the preview again", async ({ page }) => {
  await page.locator("#add-card-input").fill("sol");
  await page.locator("#add-card-suggestions li", { hasText: "Sol Ring" }).first().click();
  await expect(page.locator("#add-card-draft-preview")).toBeVisible();
  await page.click("#add-card-draft-cancel");
  await expect(page.locator("#add-card-draft-preview")).toBeHidden();
});
