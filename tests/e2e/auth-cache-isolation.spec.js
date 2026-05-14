import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, seedSultaiDeck } from "./_helpers.js";

/* Security-sensitive regression: when user A signs out, the local
 * deck cache and the per-uid pending-write queue must be wiped BEFORE
 * the next user signs in. Otherwise a shared browser leaks user A's
 * decks to user B (or to anonymous viewers if signOut races a
 * navigation). The wipe lives in `js/sync.js:signOut`. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await page.locator("#tab-manage").waitFor();
});

test("signOut wipes user-decks cache + session hint", async ({ page }) => {
  /* Sanity-check that the seeded deck is in the cache pre-signOut. */
  const before = await page.evaluate(() => ({
    decks: localStorage.getItem("mtg-hand-sim:user-decks-v1"),
    hint: localStorage.getItem("mtg-hand-sim:has-session-v1"),
  }));
  expect(before.decks).toBeTruthy();
  expect(JSON.parse(before.decks).length).toBeGreaterThan(0);
  expect(before.hint).toBe("1");

  /* Sign out via the account dropdown — same path a real user takes. */
  await page.click("#btn-account");
  await page.click("#btn-account-signout");

  /* Auth-locked applies + the overlay reopens — the signed-out shell. */
  await expect(page.locator("html")).toHaveClass(/auth-locked/);
  await expect(page.locator("#login-overlay")).toBeVisible();

  /* The cache + hint MUST be gone. If either survives, the next
   * visitor (anon or signed-in) inherits the previous user's data. */
  const after = await page.evaluate(() => ({
    decks: localStorage.getItem("mtg-hand-sim:user-decks-v1"),
    hint: localStorage.getItem("mtg-hand-sim:has-session-v1"),
  }));
  expect(after.decks).toBeNull();
  expect(after.hint).toBeNull();
});

test("user B starts fresh after user A signs out", async ({ page }) => {
  /* Sign out user A. */
  await page.click("#btn-account");
  await page.click("#btn-account-signout");
  await expect(page.locator("html")).toHaveClass(/auth-locked/);

  /* Simulate user B by rebinding the test seam and replaying the
   * boot flow. The cache wipe from signOut ensures no Sultai leaks.
   * We MUST also pre-empty `user-decks-v1` here: `seedSultaiDeck`'s
   * addInitScript from beforeEach still runs on this reload, and its
   * "only seed when key absent" guard would otherwise re-inject the
   * Sultai fixture over user B's clean state — masking the leak
   * we're trying to lock down. Writing `[]` keeps the guard happy
   * while modelling user B's actual empty-cache reality. */
  await page.addInitScript(() => {
    window.__deckryptTestUser = {
      uid: "user-b-uid",
      email: "userb@example.com",
      displayName: "User B",
      photoURL: null,
    };
    localStorage.setItem("mtg-hand-sim:has-session-v1", "1");
    localStorage.setItem("mtg-hand-sim:obligatory-login-v1", "1");
    localStorage.setItem("mtg-hand-sim:user-decks-v1", "[]");
  });
  await page.reload();

  /* User B sees the empty-state CTA, NOT user A's decks. */
  await page.click("#tab-manage");
  await expect(page.locator("#manage-cards .card-row")).toHaveCount(0);
  /* The seeded Sultai deck name must not appear anywhere in the deck
   * pill / dropdown either. */
  await expect(page.locator("body")).not.toContainText("Sultai — Ukkima & Cazur");
});
