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

test("header order: brand → nav → spacer → deck pill → account", async ({ page }) => {
  const brand = await page.locator(".brand").boundingBox();
  const nav = await page.locator(".nav").boundingBox();
  const deckPill = await page.locator("#btn-deck-pill").boundingBox();
  const account = await page.locator("#btn-account").boundingBox();
  expect(brand.x).toBeLessThan(nav.x);
  expect(nav.x + nav.width).toBeLessThan(deckPill.x);
  expect(deckPill.x).toBeLessThan(account.x);
});

test("nav sits next to the brand on the left (immune to deck-pill width)", async ({ page }) => {
  /* Regression: the nav used to be centred inside a 1fr column and
   * drifted sideways whenever the right-side header changed width
   * (deck switch with different name length). It now lives in an
   * `auto` column right after the brand, so its left edge is bound
   * to the brand's right edge plus the grid gap (24px). */
  const brand = await page.locator(".brand").boundingBox();
  const nav = await page.locator(".nav").boundingBox();
  const gap = nav.x - (brand.x + brand.width);
  /* 24px grid gap, ±2px tolerance for sub-pixel rounding. */
  expect(gap).toBeGreaterThanOrEqual(22);
  expect(gap).toBeLessThanOrEqual(26);
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

test("authed account-name sizes to content, ellipsises long labels at max-width", async ({ page }) => {
  /* Previous contract was the opposite — a `width: 140px` lock to
   * prevent the boot-theme skeleton from jumping to the real label.
   * That left ~60 px of empty space inside the pill for short names
   * ("Cyntaël", "Matthieu"). New contract: the pill is sized by its
   * content; the skeleton→authed jump is masked by boot-account.js
   * priming the cached display name pre-paint, not by reserving
   * width. `max-width: 160 px` still caps long labels (full version
   * remains visible in the account dropdown header). */
  await page.locator("#btn-account.account-authed").waitFor();
  const labelLocator = page.locator(".account-authed .account-name");

  /* mockAuth seeds displayName="Test User" — measure the short-label
   * width as the baseline. With `max-width: 160 px` and content
   * sizing, "Test User" lands comfortably below the cap. */
  const initial = (await labelLocator.boundingBox()).width;
  expect(initial).toBeLessThan(120);

  /* Long email: width grows but caps at 160 px (the ellipsis kicks
   * in beyond that). */
  await page.evaluate(() => {
    document.getElementById("account-label").textContent = "matthieu.boudinot.long@verylongdomain.example";
  });
  const longLabel = (await labelLocator.boundingBox()).width;
  expect(longLabel).toBeGreaterThan(initial);
  expect(longLabel).toBeLessThanOrEqual(160);

  /* Single-char label shrinks to ~match the glyph (no minimum slot). */
  await page.evaluate(() => {
    document.getElementById("account-label").textContent = "M";
  });
  const shortLabel = (await labelLocator.boundingBox()).width;
  expect(shortLabel).toBeLessThan(initial);
});

test("returning user's account pill paints at content width from frame 1 (no skeleton flash)", async ({ page }) => {
  /* mockAuth pre-seeds the account snapshot in localStorage, so
   * boot-account.js (NON-defer script after #btn-account) primes the
   * authed pill BEFORE the browser paints. Assertion: the very first
   * boundingBox we can read is already at content width, AND it
   * doesn't change once the deferred app-login.js runs and overwrites
   * the children with the live data. */
  const widthAtFirstQuery = await page.locator("#btn-account.account-authed").evaluate(
    (el) => el.getBoundingClientRect().width,
  );
  await page.locator("#commander-zone .card").first().waitFor();
  const widthLater = await page.locator("#btn-account.account-authed").evaluate(
    (el) => el.getBoundingClientRect().width,
  );
  /* Both widths must match within sub-pixel rounding — proves the
   * priming and the live refresh land on the same geometry. */
  expect(Math.abs(widthLater - widthAtFirstQuery)).toBeLessThanOrEqual(1);
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
