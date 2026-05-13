import { test, expect } from "@playwright/test";
import { mockAuth, seedSultaiDeck } from "./_helpers.js";

/* Regression: changing a card's printing in the Manage view must
 * refresh the Analyze view's Game Changer accordion image without a
 * page reload. The bug was that state.resolved.deck held the old
 * Scryfall card objects (with the old image_uris) — the manage view
 * dodged it via cacheReader.getByPrinting, but the analyze view read
 * state.resolved directly and showed the previous printing. */

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const GC_NAME = "Sol Ring";
const OLD_SET = "cmd";
const NEW_SET = "dom";

function imageUris(set, cn) {
  return {
    small: `https://test.scryfall.io/sm/${set}/${cn}.png`,
    normal: `https://test.scryfall.io/nm/${set}/${cn}.png`,
  };
}

test.beforeEach(async ({ page }) => {
  await page.route("https://*.scryfall.io/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "image/png", body: TINY_PNG });
  });
  await page.route("**/api.scryfall.com/**", async (route) => {
    const url = route.request().url();

    // Bulk resolution: stamp Sol Ring with the OLD printing (set "cmd")
    // and game_changer:true. Every other card gets a generic shape.
    if (url.includes("/cards/collection")) {
      const body = JSON.parse(route.request().postData() || "{}");
      /* Use a hash of the name as the collector_number so each card
       * gets a stable, unique key even when Scryfall splits the deck
       * across multiple batched POSTs. A per-batch counter would
       * collide on tst:1..tst:N between batches and overwrite cache
       * entries for the first batch's cards. */
      const cnFor = (name) => {
        let h = 0;
        for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
        return String(Math.abs(h) % 100000);
      };
      const data = (body.identifiers || []).map((id) => {
        const name = id.name || `Card ${cnFor(JSON.stringify(id))}`;
        const isGC = name === GC_NAME;
        const set = isGC ? OLD_SET : (id.set || "tst");
        const cn = isGC ? "1" : (id.collector_number || cnFor(name));
        return {
          name, set, collector_number: cn,
          type_line: "Artifact", cmc: 1, colors: [], produced_mana: [],
          image_uris: imageUris(set, cn),
          game_changer: isGC,
        };
      });
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ object: "list", data, not_found: [] }),
      });
      return;
    }

    // Printings list: two Sol Ring printings, both game_changer:true,
    // different sets so the image URL changes after the switch.
    if (url.includes("/cards/search")) {
      const decoded = decodeURIComponent(url);
      if (decoded.includes("lang:fr")) {
        await route.fulfill({ json: { data: [] } });
        return;
      }
      await route.fulfill({
        json: {
          data: [
            {
              name: GC_NAME, set: OLD_SET, collector_number: "1",
              set_name: "Commander", type_line: "Artifact", cmc: 1,
              image_uris: imageUris(OLD_SET, "1"),
              game_changer: true,
            },
            {
              name: GC_NAME, set: NEW_SET, collector_number: "999",
              set_name: "Dominaria", type_line: "Artifact", cmc: 1,
              image_uris: imageUris(NEW_SET, "999"),
              game_changer: true,
            },
          ],
        },
      });
      return;
    }

    await route.fulfill({ status: 404 });
  });
});

test("changing a printing refreshes the Game Changer accordion image without reload", async ({ page }) => {
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();

  // 1. Open analyze, expand accordion, capture the initial image src.
  await page.click("#tab-analyze");
  await page.click("#analyze-bracket .gc-summary");
  const firstCardImg = page.locator("#analyze-bracket .gc-cards .card img").first();
  const oldSrc = await firstCardImg.getAttribute("src");
  expect(oldSrc).toContain(`/${OLD_SET}/`);

  // 2. Switch to manage, locate the Sol Ring row, open the printing
  // picker, then click the second tile (the NEW printing).
  await page.click("#tab-manage");
  const solRingPrintingBtn = page
    .locator("#manage-cards .card-row", { hasText: GC_NAME })
    .locator(".card-row-printing");
  await solRingPrintingBtn.first().click();
  await page.locator(".printing-tile").nth(1).click();

  // 3. Without reloading, switch back to analyze and re-expand the
  // accordion. The image should now point to the NEW set.
  await page.click("#tab-analyze");
  await page.click("#analyze-bracket .gc-summary");
  await expect(firstCardImg).toHaveAttribute("src", new RegExp(`/${NEW_SET}/`));
});
