import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, openDeckMenu, seedSultaiDeck, switchDeckById } from "./_helpers.js";

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await page.click("#tab-manage");
});

test("Manage view groups card rows by primary type with headers", async ({ page }) => {
  await expect(page.locator(".card-group").first()).toBeVisible();
  // Section titles for at least one of the well-populated buckets in
  // the seeded Sultai deck (Lands, Creatures).
  const labels = await page.locator(".card-group-title span:first-child").allTextContents();
  expect(labels).toEqual(expect.arrayContaining(["Terrains"]));
  expect(labels).toEqual(expect.arrayContaining(["Créatures"]));
  // Each title carries a running count.
  for (const c of await page.locator(".card-group-count").all()) {
    const txt = await c.textContent();
    expect(parseInt(txt, 10)).toBeGreaterThan(0);
  }
});

test("the manage view lists card rows for the active deck", async ({ page }) => {
  // Sultai ships with dozens of entries; just confirm rendering is
  // reaching the DOM rather than asserting on any specific row.
  await expect(page.locator("#manage-cards .card-row").first()).toBeVisible();
  const count = await page.locator("#manage-cards .card-row").count();
  expect(count).toBeGreaterThan(10);
});

test("paste-add merges qty into an existing entry", async ({ page }) => {
  // Find the Forest row and read its qty before the paste.
  const forestRow = page.locator("#manage-cards .card-row", { hasText: "Forest" }).first();
  await expect(forestRow).toBeVisible();
  const before = await forestRow.locator(".card-row-qty span").textContent();
  const beforeQty = parseInt(before, 10);

  const beforeRowCount = await page.locator("#manage-cards .card-row").count();

  await page.locator("#add-card-paste-text").fill("3 Forest");
  await page.click("#add-card-paste-btn");

  // Same row count (merge, not insert) and qty bumped by 3.
  await expect(page.locator("#manage-cards .card-row")).toHaveCount(beforeRowCount);
  const after = await forestRow.locator(".card-row-qty span").textContent();
  expect(parseInt(after, 10)).toBe(beforeQty + 3);
});

test("− and + buttons update qty live and persist via localStorage", async ({ page }) => {
  const forestRow = page.locator("#manage-cards .card-row", { hasText: "Forest" }).first();
  const qtyEl = forestRow.locator(".card-row-qty span");
  const before = parseInt(await qtyEl.textContent(), 10);

  await forestRow.locator(".card-row-qty button", { hasText: "+" }).click();
  await expect(qtyEl).toHaveText(String(before + 1));

  // Reload the page — localStorage is the persistence layer; the
  // bumped qty must survive.
  await page.reload();
  await page.click("#tab-manage");
  const persistedRow = page.locator("#manage-cards .card-row", { hasText: "Forest" }).first();
  await expect(persistedRow.locator(".card-row-qty span")).toHaveText(String(before + 1));
});

test("removing the last deck shows the empty selector", async ({ page }) => {
  /* Trash lives in the deck-summary's kebab menu (⋮) — open it
   * first, then click the Supprimer item, then confirm in the
   * dedicated confirm modal (replaced the native confirm() in
   * May 2026). */
  await page.click("#btn-deck-kebab");
  await page.click("#btn-delete-deck-summary");
  await expect(page.locator("#confirm-modal")).toBeVisible();
  await page.click("#confirm-modal-ok");
  await expect(page.locator("#deck-select option")).toHaveCount(0);
});

test("FR switch translates card names; EN switch restores them", async ({ page }) => {
  // Initial state: EN is active, names are English.
  await expect(page.locator("#lang-switch-en")).toHaveClass(/active/);
  const firstNameEn = await page.locator("#manage-cards .card-row-name").first().textContent();
  expect(firstNameEn).not.toMatch(/^\[FR\]/);

  // Toggle FR — the mock returns `[FR] <name>` for any lang:fr search.
  await page.click("#lang-switch-fr");
  await expect(page.locator("#lang-switch-fr")).toHaveClass(/active/);
  // Wait for the async fetch + re-render to settle.
  await expect(page.locator("#manage-cards .card-row-name").first())
    .toHaveText(/^\[FR\] /, { timeout: 5000 });

  // Toggle back to EN — instantly reverts (no fetch needed).
  await page.click("#lang-switch-en");
  await expect(page.locator("#lang-switch-en")).toHaveClass(/active/);
  await expect(page.locator("#manage-cards .card-row-name").first())
    .not.toHaveText(/^\[FR\] /);
});

test("FR switch surfaces a visible loading banner during the fetch", async ({ page }) => {
  // Use a tiny deck so the whole fetch fits in one batch — keeps the
  // banner-visible window predictable for the assertions below.
  await page.evaluate(() => {
    localStorage.setItem("mtg-hand-sim:user-decks-v1", JSON.stringify([{
      id: "tiny", name: "Tiny",
      commanders: [{ name: "Tiny Cmdr" }],
      cards: [{ name: "Forest", qty: 1 }, { name: "Mountain", qty: 1 }],
    }]));
    localStorage.setItem("mtg-hand-sim:defaults-seeded-v1", "1");
  });
  await page.reload();
  await page.locator("#commander-zone .card").first().waitFor();
  await page.click("#tab-manage");

  // Slow down lang:fr searches so the 200 ms debounce has time to
  // flip the banner visible. The base mockScryfall handles every
  // other endpoint — we delegate via route.fallback().
  await page.route("**/api.scryfall.com/cards/search**", async (route) => {
    const decoded = decodeURIComponent(route.request().url());
    if (!decoded.includes("lang:fr")) {
      await route.fallback();
      return;
    }
    await new Promise((r) => setTimeout(r, 800));
    const matches = [...decoded.matchAll(/!"([^"]+)"/g)].map((m) => m[1]);
    await route.fulfill({
      json: { data: matches.map((n) => ({ name: n, lang: "fr", printed_name: `[FR] ${n}` })) },
    });
  });

  await page.click("#lang-switch-fr");

  // Banner appears once the 200 ms debounce elapses (fetch is delayed 800 ms).
  await expect(page.locator("#translation-banner")).toBeVisible({ timeout: 2000 });
  await expect(page.locator(".translation-banner-spinner")).toBeVisible();
  await expect(page.locator("#translation-banner"))
    .toContainText(/Récupération des noms français/);

  // After the fetch lands (one batch = ~800 ms), the banner hides.
  await expect(page.locator("#translation-banner")).toBeHidden({ timeout: 3000 });
});

test("per-card spinners appear during the FR fetch and clear once translated", async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem("mtg-hand-sim:user-decks-v1", JSON.stringify([{
      id: "tiny", name: "Tiny",
      commanders: [{ name: "Tiny Cmdr" }],
      cards: [{ name: "Forest", qty: 1 }, { name: "Mountain", qty: 1 }],
    }]));
    localStorage.setItem("mtg-hand-sim:defaults-seeded-v1", "1");
  });
  await page.reload();
  await page.locator("#commander-zone .card").first().waitFor();
  await page.click("#tab-manage");

  // Slow the FR search so we can observe the pending-state UI.
  await page.route("**/api.scryfall.com/cards/search**", async (route) => {
    const decoded = decodeURIComponent(route.request().url());
    if (!decoded.includes("lang:fr")) { await route.fallback(); return; }
    await new Promise((r) => setTimeout(r, 800));
    const matches = [...decoded.matchAll(/!"([^"]+)"/g)].map((m) => m[1]);
    await route.fulfill({
      json: { data: matches.map((n) => ({ name: n, lang: "fr", printed_name: `[FR] ${n}` })) },
    });
  });

  await page.click("#lang-switch-fr");

  // Spinners visible while the batch is in flight.
  await expect(page.locator("#manage-cards .card-row.is-translating").first())
    .toBeVisible({ timeout: 2000 });
  await expect(page.locator(".card-row-spinner").first()).toBeVisible();

  // Once the batch lands, spinners disappear and names are translated.
  await expect(page.locator("#manage-cards .card-row.is-translating"))
    .toHaveCount(0, { timeout: 3000 });
  await expect(page.locator("#manage-cards .card-row-name").first())
    .toHaveText(/^\[FR\] /);
});

test("switching deck while FR is active translates the new deck (regression)", async ({ page }) => {
  // Two decks in storage so the sidebar select has somewhere to go.
  await page.evaluate(() => {
    localStorage.setItem("mtg-hand-sim:user-decks-v1", JSON.stringify([
      { id: "deck-a", name: "Deck A",
        commanders: [{ name: "Commander Alpha" }],
        cards: [{ name: "Forest", qty: 1 }, { name: "Mountain", qty: 1 }] },
      { id: "deck-b", name: "Deck B",
        commanders: [{ name: "Commander Beta" }],
        cards: [{ name: "Island", qty: 1 }, { name: "Swamp", qty: 1 }] },
    ]));
    localStorage.setItem("mtg-hand-sim:defaults-seeded-v1", "1");
    localStorage.setItem("mtg-hand-sim:manage-lang", "fr");
  });
  await page.reload();
  await page.locator("#commander-zone .card").first().waitFor();
  await page.click("#tab-manage");

  // Already in FR → first deck's names get translated on load.
  await expect(page.locator("#manage-cards .card-row-name").first())
    .toHaveText(/^\[FR\] /, { timeout: 5000 });

  // Switch to deck-b — names start out untranslated until the
  // background fetch lands. The regression is that they used to
  // STAY in English forever; now they must flip to FR.
  await switchDeckById(page, "deck-b");
  await expect(page.locator("#manage-cards .card-row-name").first())
    .toHaveText(/^\[FR\] /, { timeout: 5000 });
});

test("language preference persists across reloads", async ({ page }) => {
  await page.click("#lang-switch-fr");
  await expect(page.locator("#manage-cards .card-row-name").first())
    .toHaveText(/^\[FR\] /, { timeout: 5000 });

  await page.reload();
  await page.click("#tab-manage");
  // Without a re-click, FR should already be the active mode.
  await expect(page.locator("#lang-switch-fr")).toHaveClass(/active/);
  await expect(page.locator("#manage-cards .card-row-name").first())
    .toHaveText(/^\[FR\] /);
});

test("clicking a card thumbnail opens the modal preview", async ({ page }) => {
  // Wait for the resolution to populate the thumb (mocked Scryfall
  // returns synchronously but JS still has to flush).
  await page.locator("#manage-cards .card-row-thumb:not([disabled])").first().waitFor();

  await expect(page.locator("#modal")).not.toHaveClass(/open/);
  await page.locator("#manage-cards .card-row-thumb").first().click();
  await expect(page.locator("#modal")).toHaveClass(/open/);

  // Escape closes it (existing modal contract).
  await page.keyboard.press("Escape");
  await expect(page.locator("#modal")).not.toHaveClass(/open/);
});

test("changing a printing keeps every manage thumbnail visible (regression)", async ({ page }) => {
  // Regression for the bug where commitDeckChange did
  // `state.resolved = null`, which left renderManageView with no
  // resolvedByName entries → every thumbnail went blank until reload.

  // Wait for the deck resolution to complete. We can't watch
  // #commander-zone anymore (it moved into the play-sidebar, which
  // is hidden while we're on the manage view), so we use the manage
  // view's own commander panel as the readiness signal — it gets
  // populated from the same state.resolved as #commander-zone.
  await page.locator("#manage-commanders .card-row").first().waitFor();

  // Now wait for the manage view to settle: at least 10 thumbnails
  // (Sultai is much bigger than that — 1 means rendering is mid-flight).
  await expect(page.locator("#manage-cards .card-row-thumb img")).not.toHaveCount(0);
  await expect.poll(
    async () => page.locator("#manage-cards .card-row-thumb img").count(),
    { timeout: 5000 },
  ).toBeGreaterThan(10);

  const before = await page.locator("#manage-cards .card-row-thumb img").count();

  await page.locator("#manage-cards .card-row-printing").first().click();
  await page.locator(".printing-tile").first().waitFor();
  await page.locator(".printing-tile").nth(1).click();

  await expect(page.locator("#modal")).not.toHaveClass(/open/);

  // Same number of <img> children — none of the rows lost its thumb.
  const after = await page.locator("#manage-cards .card-row-thumb img").count();
  expect(after).toBe(before);
});

test("printing picker renders multiple columns at default viewport", async ({ page }) => {
  // Mock _helpers returns 2 printings; the grid container should still
  // be wide enough for multiple columns regardless of how many tiles.
  await page.locator("#manage-cards .card-row-printing").first().click();
  await expect(page.locator(".printing-picker")).toBeVisible();
  await expect(page.locator(".printing-grid")).toBeVisible();
  // The picker takes the lion's share of the modal width — well over
  // a single tile (~170 px). Without the .printing-picker wrapper the
  // grid would have collapsed to one column inside modal-actions.
  const pickerBox = await page.locator(".printing-picker").boundingBox();
  expect(pickerBox.width).toBeGreaterThan(800);
  // Each tile carries an explicit set/cn caption.
  await expect(page.locator(".printing-tile-cap").first()).toBeVisible();
});
