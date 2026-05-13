import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, seedSultaiDeck } from "./_helpers.js";

/* Manage view refonte: 2-column layout, deck-summary header,
 * side panel with composition + bracket + activity stub. The
 * pre-existing manage.spec.js tests still target the inner panels
 * (#manage-cards, #manage-commanders) and pass without changes
 * because we kept those IDs; this spec covers the new shell. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
  await page.click("#tab-manage");
});

test("2-column layout: main panel on the left, side panel on the right", async ({ page }) => {
  const main = await page.locator(".manage-main").boundingBox();
  const side = await page.locator(".manage-side").boundingBox();
  expect(main).not.toBeNull();
  expect(side).not.toBeNull();
  expect(main.x).toBeLessThan(side.x);
});

test("deck-summary header shows the deck name + cards count + commander art", async ({ page }) => {
  /* Deck name comes straight from the def — never empty. */
  const name = await page.locator("#manage-deck-name").textContent();
  expect(name.length).toBeGreaterThan(0);
  expect(name).not.toBe("—");

  /* Card count + format label populated from the resolved deck. */
  const size = await page.locator("#manage-deck-size").textContent();
  expect(parseInt(size, 10)).toBeGreaterThan(0);

  await expect(page.locator("#manage-deck-format-label")).toContainText(/Commander|Format libre/);

  /* Commander art panel has at least one <img> (one per commander —
   * 2 for Sultai's partner pair Ukkima + Cazur, see the dedicated
   * test below). mockScryfall returns a fake image URL so each img
   * has a non-empty src. */
  const imgs = page.locator("#manage-deck-art img");
  expect(await imgs.count()).toBeGreaterThan(0);
  expect(await imgs.first().getAttribute("src")).toBeTruthy();
});

test("partner commanders (2): deck-art stacks one <img> per commander vertically", async ({ page }) => {
  /* Sultai test fixture has 2 commanders (Ukkima + Cazur partner
   * pair). The deck-art panel renders 2 stacked images, each filling
   * 1/N of the panel height. */
  const imgs = page.locator("#manage-deck-art img");
  await expect(imgs).toHaveCount(2);
  /* Each img has a non-empty src (mockScryfall provides fake URLs). */
  for (let i = 0; i < 2; i++) {
    expect(await imgs.nth(i).getAttribute("src")).toBeTruthy();
  }
  /* Layout sanity: the second image sits BELOW the first, not next
   * to it. Vertical stacking only — partner decks shouldn't render
   * side-by-side narrow portraits. */
  const first = await imgs.nth(0).boundingBox();
  const second = await imgs.nth(1).boundingBox();
  expect(second.y).toBeGreaterThan(first.y);
  expect(Math.abs(first.x - second.x)).toBeLessThan(2);
});

test("color pips reflect the deck's commander color identity", async ({ page }) => {
  /* The seeded Sultai deck uses B/U/G commanders, so at least one
   * pip dot should render. */
  const pipCount = await page.locator("#manage-deck-pips .pip-dot").count();
  expect(pipCount).toBeGreaterThanOrEqual(1);
});

test("meta-row separators are CSS-only dots, NO duplicated '·' text (regression)", async ({ page }) => {
  /* Previous bug: the markup contained `·` as text content INSIDE
   * the `.deck-meta-sep` span, AND the CSS also drew a 4px dot
   * background. Result was two dots stacked (text + circle). The
   * fix is to keep the spans empty so only the CSS dot renders. */
  const seps = page.locator(".deck-meta-row .deck-meta-sep");
  const count = await seps.count();
  expect(count).toBeGreaterThanOrEqual(3);
  for (let i = 0; i < count; i++) {
    const text = await seps.nth(i).textContent();
    expect(text.trim()).toBe("");
  }
});

test("deck-summary tags row renders bracket pill + count, sync indicator stays silent by default", async ({ page }) => {
  /* Bracket pill is the small inline variant (NOT the .bracket-circle
   * used in the analyze view). Its inner badge holds the bracket
   * digit, the wrapper has the human-readable label. */
  const bracket = page.locator("#manage-deck-bracket");
  await expect(bracket).toBeVisible();
  await expect(bracket.locator(".bracket-badge-num")).toHaveText(/^[1-5]$/);

  /* Count tag mirrors the meta-row but in pill form: "X + Y commandants". */
  await expect(page.locator("#manage-deck-count-tag")).toBeVisible();
  await expect(page.locator("#manage-deck-count-tag")).toContainText(/commandant/);

  /* Sync indicator — negative-space design: hidden when the queue is
   * empty AND the user is online (the happy path, ~99% of sessions).
   * Only surfaces on Hors-ligne or stuck-pending. */
  await expect(page.locator("#manage-deck-sync-tag")).toBeHidden();
});

test("format edit dropdown swaps Commander ↔ Format libre and persists", async ({ page }) => {
  /* The format label in the meta-row is a button — click it to open
   * the dropdown, then pick the other format. Verify the label
   * updates synchronously and that a reload restores the choice
   * (persistence is the real contract, the UI is just a vector). */
  await expect(page.locator("#manage-deck-format-label")).toHaveText("Commander");
  await page.click("#manage-deck-format-trigger");
  await expect(page.locator("#manage-deck-format-menu")).toBeVisible();
  await page.click('#manage-deck-format-menu [data-format="limited"]');
  await expect(page.locator("#manage-deck-format-label")).toHaveText("Format libre");
  /* Reload — switchView lands on manage view via the default-view
   * preference (we set it earlier in beforeEach), and the format
   * should still be "Format libre". */
  await page.reload();
  await page.click("#tab-manage");
  await expect(page.locator("#manage-deck-format-label")).toHaveText("Format libre");
});

test("Dupliquer creates a clone with '(copie)' suffix and switches to it", async ({ page }) => {
  const originalName = await page.locator("#manage-deck-name").textContent();
  const originalDeckCount = await page.locator("#deck-select option").count();

  /* Dupliquer lives in the kebab menu since we moved it out of the
   * actions row to dedramatize the visible action set. */
  await page.click("#btn-deck-kebab");
  await page.click("#btn-duplicate-deck");

  /* New deck appears in the selector + becomes active. */
  await expect(page.locator("#deck-select option")).toHaveCount(originalDeckCount + 1);
  await expect(page.locator("#manage-deck-name")).toContainText(`${originalName} (copie)`);
});

test("switching deck via the dropdown moves aria-current to the picked deck (regression)", async ({ page }) => {
  /* Bug fixed: aria-current was painted by renderDeckDropdown only
   * when populateDeckSelect ran, NOT on a normal deck switch via the
   * pill dropdown — so the highlight stayed stuck on whichever deck
   * was active the last time the menu was built. Fix: switchDeck
   * now calls refreshDeckDropdownActive which walks the existing
   * items and rewrites aria-current. */
  /* Seed a second deck so we have something to switch to. */
  await page.evaluate(() => {
    const decks = JSON.parse(localStorage.getItem("mtg-hand-sim:user-decks-v1") || "[]");
    decks.push({
      id: "other-deck", name: "Other", format: "commander",
      commanders: [], cards: [{ name: "Forest", qty: 1 }],
    });
    localStorage.setItem("mtg-hand-sim:user-decks-v1", JSON.stringify(decks));
    /* Trigger a populateDeckSelect — the test seam's onAuthChange
     * doesn't fire on our localStorage mutation. */
    document.getElementById("deck-select").dispatchEvent(new Event("change"));
  });
  /* Reload to pick up the seeded deck through the boot flow. */
  await page.reload();
  await page.click("#tab-manage");

  await page.click("#btn-deck-pill");
  /* Click whichever deck is NOT currently active. */
  const inactiveRow = page.locator('#deck-dropdown-list .dropdown-item:not([aria-current="true"])').first();
  const inactiveId = await inactiveRow.getAttribute("data-deck-id");
  await inactiveRow.click();

  /* Re-open the dropdown — the highlight should now sit on the row
   * the user just picked. */
  await page.click("#btn-deck-pill");
  const currentRow = page.locator('#deck-dropdown-list .dropdown-item[aria-current="true"]');
  await expect(currentRow).toHaveCount(1);
  expect(await currentRow.getAttribute("data-deck-id")).toBe(inactiveId);
});

test("description: empty state shows italic placeholder under the title", async ({ page }) => {
  /* Test fixture (Sultai) has no description → placeholder visible
   * with the .is-empty class (italic + muted). */
  const desc = page.locator("#manage-deck-description");
  await expect(desc).toBeVisible();
  await expect(desc).toHaveClass(/\bis-empty\b/);
  await expect(desc).toContainText(/Ajoute une description/);
  /* Editor hidden by default. */
  await expect(page.locator("#manage-deck-description-editor")).toBeHidden();
});

test("description: click swaps to textarea, Sauvegarder persists across reload", async ({ page }) => {
  await page.click("#manage-deck-description");
  /* Editor visible, textarea focused, display hidden. */
  await expect(page.locator("#manage-deck-description-editor")).toBeVisible();
  await expect(page.locator("#manage-deck-description-input")).toBeFocused();
  await expect(page.locator("#manage-deck-description")).toBeHidden();
  /* Type + Sauvegarder. */
  await page.locator("#manage-deck-description-input").fill("Win con: Thoracle/Consult.\nMulligan: 2 lands min.");
  await page.click("#btn-description-save");
  /* Display visible with the new text, no longer italic. */
  await expect(page.locator("#manage-deck-description-editor")).toBeHidden();
  await expect(page.locator("#manage-deck-description")).toBeVisible();
  await expect(page.locator("#manage-deck-description")).not.toHaveClass(/\bis-empty\b/);
  await expect(page.locator("#manage-deck-description")).toContainText(/Win con: Thoracle/);
  /* Persistence — survive reload. */
  await page.reload();
  await page.click("#tab-manage");
  await expect(page.locator("#manage-deck-description")).toContainText(/Win con: Thoracle/);
  await expect(page.locator("#manage-deck-description")).not.toHaveClass(/\bis-empty\b/);
});

test("description: Annuler discards changes, original text/empty state restored", async ({ page }) => {
  await page.click("#manage-deck-description");
  await page.locator("#manage-deck-description-input").fill("Nope");
  await page.click("#btn-description-cancel");
  /* Back to empty + italic. */
  await expect(page.locator("#manage-deck-description")).toHaveClass(/\bis-empty\b/);
  await expect(page.locator("#manage-deck-description")).toContainText(/Ajoute une description/);
});

test("description: Escape inside the textarea cancels (same as Annuler)", async ({ page }) => {
  await page.click("#manage-deck-description");
  await page.locator("#manage-deck-description-input").fill("Should not persist");
  await page.locator("#manage-deck-description-input").press("Escape");
  await expect(page.locator("#manage-deck-description-editor")).toBeHidden();
  await expect(page.locator("#manage-deck-description")).toHaveClass(/\bis-empty\b/);
});

test("Renommer opens an inline input, Enter commits, the new name persists everywhere", async ({ page }) => {
  /* Inline rename — kebab item swaps the h1 for an input. */
  await page.click("#btn-deck-kebab");
  await page.click("#btn-rename-deck");
  /* Input visible + focused with text pre-selected. */
  const input = page.locator("#manage-deck-name-input");
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await expect(page.locator("#manage-deck-name")).toBeHidden();
  /* Type a new name + Enter. */
  await input.fill("Sultai renommé");
  await input.press("Enter");
  /* h1 back, input hidden, new name everywhere. */
  await expect(input).toBeHidden();
  await expect(page.locator("#manage-deck-name")).toBeVisible();
  await expect(page.locator("#manage-deck-name")).toHaveText("Sultai renommé");
  /* Deck-pill in the header reflects the new name. */
  await expect(page.locator("#deck-pill-name")).toHaveText("Sultai renommé");
  /* Persists across reload (commitDeckChange wrote to localStorage). */
  await page.reload();
  await page.click("#tab-manage");
  await expect(page.locator("#manage-deck-name")).toHaveText("Sultai renommé");
});

test("Renommer Escape cancels without persisting", async ({ page }) => {
  const originalName = await page.locator("#manage-deck-name").textContent();
  await page.click("#btn-deck-kebab");
  await page.click("#btn-rename-deck");
  const input = page.locator("#manage-deck-name-input");
  await input.fill("nope");
  await input.press("Escape");
  await expect(page.locator("#manage-deck-name")).toHaveText(originalName);
});

test("Dupliquer points the dropdown highlight to the clone, not the original (regression)", async ({ page }) => {
  /* Bug fixed: duplicateCurrentDeck used to call populateDeckSelect
   * BEFORE updating state.currentDeckId. The dropdown's
   * `aria-current="true"` stayed on the original deck even though
   * the rest of the UI (pill, summary) showed the clone. */
  const originalId = await page.locator("#deck-select").inputValue();

  await page.click("#btn-deck-kebab");
  await page.click("#btn-duplicate-deck");

  /* Open the header deck-pill dropdown and check which row carries
   * the highlight (aria-current). Should be the clone, not the
   * original. */
  await page.click("#btn-deck-pill");
  const currentRow = page.locator('#deck-dropdown-list .dropdown-item[aria-current="true"]');
  await expect(currentRow).toHaveCount(1);
  const currentDeckId = await currentRow.getAttribute("data-deck-id");
  expect(currentDeckId).not.toBe(originalId);
});

test("sync indicator stays hidden after a normal save (queue drains within the 3s grace)", async ({ page }) => {
  /* commitDeck writes localStorage instantly + enqueues a Firestore
   * push that drains in <1s (microtask in TEST_MODE). With the
   * 3s grace window, the user never sees a "Sync en attente" flash
   * for normal saves — silence == healthy. */
  await page.click("#btn-deck-kebab");
  await page.click("#btn-duplicate-deck");
  /* Wait briefly so any short-lived flash would have time to appear. */
  await page.waitForTimeout(200);
  await expect(page.locator("#manage-deck-sync-tag")).toBeHidden();
});

test("sync indicator shows 'Hors-ligne' when the browser is offline", async ({ page, context }) => {
  /* Negative-space contract: the only states that surface are
   * Hors-ligne (immediate) and Sync en attente >3s. */
  await context.setOffline(true);
  /* The window 'offline' event triggers a re-render via the listener
   * in app.js init. expect.poll absorbs the dispatch timing. */
  await expect.poll(
    async () => (await page.locator("#manage-deck-sync-tag").getAttribute("hidden")) ?? "visible",
    { timeout: 2000 },
  ).toBe("visible");
  await expect(page.locator("#manage-deck-sync-tag")).toContainText(/Hors-ligne/);
  await expect(page.locator("#manage-deck-sync-tag")).toHaveClass(/is-offline/);
  /* Restore for the rest of the suite. */
  await context.setOffline(false);
});

test("Supprimer opens a custom confirm modal (not the native confirm dialog)", async ({ page }) => {
  /* The native confirm() was replaced by a styled confirm modal in
   * May 2026 — same rationale as the auth overlay (no system-styled
   * dialogs in our UI). Verify the modal appears and that Cancel
   * leaves the deck untouched. */
  const initialDeckCount = await page.locator("#deck-select option").count();
  await page.click("#btn-deck-kebab");
  await page.click("#btn-delete-deck-summary");

  await expect(page.locator("#confirm-modal")).toBeVisible();
  await expect(page.locator("#confirm-modal-title")).toContainText(/Supprimer/);
  /* On a danger prompt, Cancel takes initial focus so a stray Enter
   * doesn't commit. */
  await expect(page.locator("#confirm-modal-cancel")).toBeFocused();

  /* Cancel keeps the deck. */
  await page.click("#confirm-modal-cancel");
  await expect(page.locator("#confirm-modal")).toBeHidden();
  await expect(page.locator("#deck-select option")).toHaveCount(initialDeckCount);
});

test("Supprimer + Escape closes the confirm modal without deleting", async ({ page }) => {
  const initialDeckCount = await page.locator("#deck-select option").count();
  await page.click("#btn-deck-kebab");
  await page.click("#btn-delete-deck-summary");
  await expect(page.locator("#confirm-modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#confirm-modal")).toBeHidden();
  await expect(page.locator("#deck-select option")).toHaveCount(initialDeckCount);
});

test("deck-summary kebab menu houses Renommer + Dupliquer + Exporter + Supprimer, opens on click", async ({ page }) => {
  /* All deck-level meta actions live in the kebab menu (⋮). The
   * visible actions row is reduced to the single primary action
   * (Lancer une partie). Verify the menu is hidden by default and
   * opens with the four expected items. */
  await expect(page.locator("#deck-kebab-menu")).toBeHidden();
  await page.click("#btn-deck-kebab");
  await expect(page.locator("#deck-kebab-menu")).toBeVisible();
  await expect(page.locator("#btn-rename-deck")).toBeVisible();
  await expect(page.locator("#btn-duplicate-deck")).toBeVisible();
  await expect(page.locator("#btn-export")).toBeVisible();
  await expect(page.locator("#btn-delete-deck-summary")).toBeVisible();
  /* The old header dropdown trash is gone for good. */
  await expect(page.locator("#btn-delete-deck")).toHaveCount(0);
  /* Actions row holds the single primary action. */
  const visibleButtons = await page.locator(".deck-summary-actions .btn").count();
  expect(visibleButtons).toBe(1);
});

test("EN/FR lang switch moved into the Cartes panel head (not the deck-summary)", async ({ page }) => {
  /* The lang switch was previously in the deck-summary. The mockup
   * puts it as a filter in the panel that owns the card list. */
  const switchInPanel = page.locator(".panel-head .lang-switch #lang-switch-en");
  await expect(switchInPanel).toBeVisible();
  /* And NOT in the deck-summary. */
  const switchInSummary = page.locator(".deck-summary #lang-switch-en");
  await expect(switchInSummary).toHaveCount(0);
});

test("clicking 'Lancer une partie' switches to the play view", async ({ page }) => {
  /* The action button lives inside the deck-summary header. */
  await expect(page.locator("#view-play")).toBeHidden();
  await page.click("#btn-play-deck");
  await expect(page.locator("#view-play")).toBeVisible();
  await expect(page.locator("#view-manage")).toBeHidden();
});

test("side composition panel shows at least 5 categories with their counts", async ({ page }) => {
  const composition = page.locator("#manage-side-composition .composition-row");
  expect(await composition.count()).toBeGreaterThanOrEqual(5);
  /* Each row has a label + a numeric value. */
  await expect(composition.first().locator(".label")).toBeVisible();
  await expect(composition.first().locator(".value")).toBeVisible();
});

test("side bracket panel surfaces a numeric badge + a verdict line", async ({ page }) => {
  const big = page.locator("#manage-side-bracket .bracket-large");
  await expect(big).toBeVisible();
  const num = await big.textContent();
  expect(parseInt(num, 10)).toBeGreaterThanOrEqual(1);
  await expect(page.locator("#manage-side-bracket .manage-side-bracket-verdict")).toBeVisible();
});

test("Game Changer chip renders next to the name on a GC card row (Sol Ring)", async ({ page }) => {
  /* The seeded Sultai deck contains Sol Ring, the mock flags it
   * game_changer:true, and makeManageCardRow appends a .gc-chip
   * next to the name when the resolved card carries the flag. */
  const solRingRow = page.locator("#manage-cards .card-row", { hasText: "Sol Ring" }).first();
  await expect(solRingRow).toBeVisible();
  await expect(solRingRow.locator(".gc-chip")).toBeVisible();
  /* Non-GC rows don't get the chip. Forest is a basic land, never GC. */
  const forestRow = page.locator("#manage-cards .card-row", { hasText: "Forest" }).first();
  await expect(forestRow.locator(".gc-chip")).toHaveCount(0);
});

test("activity panel is a 'À venir' stub for now", async ({ page }) => {
  await expect(page.locator(".manage-side .manage-side-placeholder")).toContainText("à venir");
});
