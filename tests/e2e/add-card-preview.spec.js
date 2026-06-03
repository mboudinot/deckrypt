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

test("dropdown shows a loading row while the autocomplete request is in flight", async ({ page }) => {
  /* Override the autocomplete route with a 500 ms delay so the
   * loading row stays observable — the in-memory mock used by
   * mockScryfall otherwise resolves in a tick and the loader flashes
   * in/out below Playwright's polling resolution. */
  await page.route("**/api.scryfall.com/cards/autocomplete**", async (route) => {
    await new Promise((r) => setTimeout(r, 500));
    await route.fulfill({ json: { data: ["Sol Ring", "Sol", "Solar Tide"] } });
  });
  await page.locator("#add-card-input").fill("sol");
  await expect(page.locator("#add-card-suggestions .suggestion-loading")).toBeVisible();
  /* Once the response lands the loading row is replaced by the real
   * suggestions — same dropdown, same listbox aria role. */
  await expect(page.locator("#add-card-suggestions li", { hasText: "Sol Ring" }).first()).toBeVisible();
  await expect(page.locator("#add-card-suggestions .suggestion-loading")).toHaveCount(0);
});

test("preview skeleton fills the slot while printings are being fetched", async ({ page }) => {
  /* Delay the printings fetch so the card-shaped skeleton stays
   * visible long enough for Playwright to assert on it. */
  await page.route("**/api.scryfall.com/cards/search**", async (route) => {
    await new Promise((r) => setTimeout(r, 500));
    await route.fulfill({
      json: {
        data: [
          {
            name: "Sol Ring", set: "cmd", collector_number: "1",
            set_name: "Commander",
            image_uris: { normal: "https://cards.scryfall.io/normal/front/c/1/cmd-1.jpg" },
          },
        ],
      },
    });
  });
  await page.locator("#add-card-input").fill("sol");
  await page.locator("#add-card-suggestions li", { hasText: "Sol Ring" }).first().click();
  /* During the wait: skeleton visible, real img still hidden. */
  await expect(page.locator("#add-card-draft-preview-loader")).toBeVisible();
  await expect(page.locator("#add-card-draft-preview")).toBeHidden();
  /* After the printings respond + the img paints: swap completes. */
  await expect(page.locator("#add-card-draft-preview")).toBeVisible();
  await expect(page.locator("#add-card-draft-preview-loader")).toBeHidden();
});
