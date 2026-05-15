import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, presetStorage, seedSultaiDeck } from "./_helpers.js";

/* Login-obligatoire model (May 2026): there is NO automatic deck
 * seeding anymore. A brand-new authenticated account starts with
 * zero decks and sees the empty-state CTA. Decks live in Firestore
 * (and the localStorage cache); the only way to get one is to
 * import or create one through the UI.
 *
 * This file used to assert the seeded "Sultai" default — kept here
 * as the empty-state contract so future seeding regressions get
 * caught the other way around. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
});

test("fresh authenticated boot with no cloud decks: empty-state CTA visible on the active view", async ({ page }) => {
  await mockAuth(page);
  await page.goto("/index.html");
  /* Four `.empty-deck-cta` blocks live in the DOM (one per view).
   * Only the active view's is visible — scope the selector to the
   * default Play view to keep the strict-mode locator happy. */
  await expect(page.locator("#view-play")).toHaveClass(/view-empty/);
  await expect(page.locator("#view-play .empty-deck-cta")).toBeVisible();
  await expect(page.locator("#view-play .empty-deck-cta-btn")).toHaveText("Importer ton premier deck");
  await expect(page.locator("#deck-select option")).toHaveCount(0);
});

test("clicking the empty-state CTA opens the import modal", async ({ page }) => {
  await mockAuth(page);
  await page.goto("/index.html");
  await page.click("#view-play .empty-deck-cta-btn");
  await expect(page.locator("#ie-modal")).toBeVisible();
});

test("empty-state CTA shows on every view (Play / Manage / Analyze / Gallery) for a fresh account", async ({ page }) => {
  /* Coherence guarantee: a signed-in user with zero decks lands on
   * the same friendly CTA wherever they click — no muted "—" /
   * "Aucun deck à analyser." placeholders. The `.view-empty` class
   * on each view container does the heavy lifting via CSS. */
  await mockAuth(page);
  await page.goto("/index.html");
  for (const [tabId, viewId] of [
    ["#tab-play", "#view-play"],
    ["#tab-manage", "#view-manage"],
    ["#tab-analyze", "#view-analyze"],
    ["#tab-gallery", "#view-gallery"],
  ]) {
    await page.click(tabId);
    await expect(page.locator(viewId)).toHaveClass(/view-empty/);
    await expect(page.locator(`${viewId} .empty-deck-cta`)).toBeVisible();
    await expect(page.locator(`${viewId} .empty-deck-cta-btn`)).toHaveText("Importer ton premier deck");
  }
});

test("one-shot legacy wipe: stale anon decks are removed on first authenticated boot", async ({ page }) => {
  /* Existing installs may carry the old anon-mode user-decks key.
   * The login-obligatoire migration runs once at init() and drops
   * those entries so a fresh signup doesn't inherit ghost decks. */
  await mockAuth(page);
  await presetStorage(page, {
    "mtg-hand-sim:user-decks-v1": [
      { id: "ghost", name: "Ghost", commanders: [], cards: [{ name: "Forest", qty: 1 }] },
    ],
    /* The obligatory-login flag is NOT set, so the wipe should fire.
     * (mockAuth sets the flag too; override that here to exercise the
     * pre-migration path.) */
    "mtg-hand-sim:obligatory-login-v1": "",
  });
  await page.goto("/index.html");
  /* Wait long enough for sync.js auth callback + populate to settle. */
  await expect(page.locator("#deck-select option")).toHaveCount(0);
  /* Flag should now be set. */
  const flag = await page.evaluate(() => localStorage.getItem("mtg-hand-sim:obligatory-login-v1"));
  expect(flag).toBe("1");
});

test("warm-cache F5 with a seeded deck: skips the loading flash and renders synchronously", async ({ page }) => {
  /* Same regression as before, framed for the new model: the test
   * preset is what the localStorage cache would hold for an
   * already-authenticated user, so on F5 tryResolveSync hits the
   * card cache and we never paint the "Chargement…" placeholder. */
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();

  await page.goto("/index.html");
  const text = await page.locator("#commander-zone").innerText();
  expect(text).not.toMatch(/Chargement/);
  await expect(page.locator("#commander-zone .card").first()).toBeVisible();
});
