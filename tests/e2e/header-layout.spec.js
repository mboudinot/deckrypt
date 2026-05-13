import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, seedSultaiDeck } from "./_helpers.js";

/* Header layout regression for the redesigned shell. The new header
 * is a 3-column grid: brand (left), nav (center), right-side actions
 * (deck pill + account). Tests lock the column positions, the active
 * tab state, and that the dropdown menus are wired correctly. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
});

test("brand is on the left, nav is centered, deck pill + account are on the right", async ({ page }) => {
  const brand = await page.locator(".brand").boundingBox();
  const nav = await page.locator(".nav").boundingBox();
  const deckPill = await page.locator("#btn-deck-pill").boundingBox();
  const account = await page.locator("#btn-account").boundingBox();
  expect(brand.x).toBeLessThan(nav.x);
  expect(nav.x + nav.width).toBeLessThan(deckPill.x);
  expect(deckPill.x).toBeLessThan(account.x);
});

test("all four nav tabs share the same vertical center", async ({ page }) => {
  const tabs = ["#tab-play", "#tab-manage", "#tab-analyze", "#tab-gallery"];
  const ys = [];
  for (const sel of tabs) {
    const box = await page.locator(sel).boundingBox();
    ys.push(box.y + box.height / 2);
  }
  for (let i = 1; i < ys.length; i++) {
    expect(Math.abs(ys[i] - ys[0])).toBeLessThanOrEqual(1);
  }
});

test("clicking a nav tab toggles its .active class + aria-selected", async ({ page }) => {
  await expect(page.locator("#tab-play")).toHaveClass(/active/);
  await expect(page.locator("#tab-play")).toHaveAttribute("aria-selected", "true");
  await page.click("#tab-manage");
  await expect(page.locator("#tab-manage")).toHaveClass(/active/);
  await expect(page.locator("#tab-play")).not.toHaveClass(/active/);
  await expect(page.locator("#tab-manage")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#tab-play")).toHaveAttribute("aria-selected", "false");
});

test("deck pill shows the active deck name + a non-zero cards count", async ({ page }) => {
  const name = await page.locator("#deck-pill-name").textContent();
  expect(name.length).toBeGreaterThan(0);
  expect(name).not.toBe("Aucun deck");
  const count = await page.locator("#deck-pill-count").textContent();
  expect(count).toMatch(/\d+ carte/);
});

test("clicking the deck pill toggles its dropdown menu", async ({ page }) => {
  await expect(page.locator("#deck-dropdown-menu")).toBeHidden();
  await page.click("#btn-deck-pill");
  await expect(page.locator("#deck-dropdown-menu")).toBeVisible();
  await page.click("#btn-deck-pill");
  await expect(page.locator("#deck-dropdown-menu")).toBeHidden();
});

test("deck dropdown lists every deck + has Import action", async ({ page }) => {
  await page.click("#btn-deck-pill");
  /* The dropdown's deck list has one button per deck. */
  const deckButtons = page.locator("#deck-dropdown-list .dropdown-item");
  expect(await deckButtons.count()).toBeGreaterThan(0);
  /* Import lives inside the same menu. Delete used to be here too,
   * but moved to the Manage view's deck-summary panel as part of
   * the refonte (matches the claude.design layout). */
  await expect(page.locator("#btn-import-toggle")).toBeVisible();
});

test("clicking outside the deck dropdown closes it", async ({ page }) => {
  await page.click("#btn-deck-pill");
  await expect(page.locator("#deck-dropdown-menu")).toBeVisible();
  /* Click in an empty area of the page (the brand logo region). */
  await page.click(".brand");
  await expect(page.locator("#deck-dropdown-menu")).toBeHidden();
});

test("Escape closes the deck dropdown", async ({ page }) => {
  await page.click("#btn-deck-pill");
  await expect(page.locator("#deck-dropdown-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#deck-dropdown-menu")).toBeHidden();
});

test("nav tab hover changes text color only, not background (regression)", async ({ page }) => {
  /* Was: the global `button:hover:not(:disabled)` rule (set in
   * styles.css ~line 472) won specificity over `.nav-tab:hover`
   * and flipped tabs to the accent background on hover. The design
   * only changes text color. Locked here so any future regression
   * surfaces fast. */
  const tab = page.locator("#tab-manage");
  const before = await tab.evaluate((el) => getComputedStyle(el).backgroundColor);
  await tab.hover();
  const after = await tab.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(after).toBe(before);
});

test("deck-pill hover keeps the surface background (regression)", async ({ page }) => {
  const pill = page.locator("#btn-deck-pill");
  const before = await pill.evaluate((el) => getComputedStyle(el).backgroundColor);
  await pill.hover();
  const after = await pill.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(after).toBe(before);
});

test("authenticated account button shows the user's display name and toggles the account menu", async ({ page }) => {
  /* Login-obligatoire: anon users never see the header (auth-locked
   * hides .container). The header-visible state always implies an
   * authed user, so this test focuses on the authed display + menu. */
  await expect(page.locator("#btn-account")).toContainText("Test User");
  await expect(page.locator("#btn-account")).toHaveClass(/account-authed/);
  await page.click("#btn-account");
  await expect(page.locator("#account-dropdown-menu")).toBeVisible();
});
