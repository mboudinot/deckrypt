import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, seedSultaiDeck } from "./_helpers.js";

/* Top-nav sliding indicator + the underlying hover-on-active bug fix.
 *
 * The bug: .nav-tab.active had its background (studio) or
 * border-bottom-color (editorial) zeroed out on hover because the
 * generic .nav-tab:hover rule won on specificity. The fix layers a
 * .nav-tab.active:hover rule with higher specificity. The CSS-only
 * fallback assertions below lock that in even when JS is disabled.
 *
 * The feature: js/nav-indicator.js inserts a <span class="nav-indicator">
 * absolutely-positioned inside .nav. It tracks the active tab and
 * slides on hover. Tests assert position via boundingBox() comparison
 * to the target tab's box. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
});

test("indicator is injected and .nav gets .has-indicator", async ({ page }) => {
  await expect(page.locator(".nav-indicator")).toBeAttached();
  await expect(page.locator(".nav")).toHaveClass(/has-indicator/);
});

test("initial indicator position matches the active tab", async ({ page }) => {
  /* The position is set in a requestAnimationFrame after JS init;
   * poll until it lands on the active tab box. */
  const indicator = page.locator(".nav-indicator");
  const activeTab = page.locator("#tab-play");
  await expect.poll(async () => {
    const i = await indicator.boundingBox();
    const t = await activeTab.boundingBox();
    return Math.abs(i.x - t.x);
  }, { timeout: 1000 }).toBeLessThanOrEqual(2);
});

test("hovering a non-active tab slides the indicator over it", async ({ page }) => {
  await page.locator("#tab-manage").hover();
  const indicator = page.locator(".nav-indicator");
  const targetTab = page.locator("#tab-manage");
  await expect.poll(async () => {
    const i = await indicator.boundingBox();
    const t = await targetTab.boundingBox();
    return Math.abs(i.x - t.x);
  }, { timeout: 1000 }).toBeLessThanOrEqual(2);
});

test("mouseleave returns the indicator to the active tab", async ({ page }) => {
  await page.locator("#tab-analyze").hover();
  /* Move the pointer well away from the nav. The header sits at the
   * top of the page, so y:600 lands in the main content area. */
  await page.mouse.move(10, 600);
  const indicator = page.locator(".nav-indicator");
  const activeTab = page.locator("#tab-play");
  await expect.poll(async () => {
    const i = await indicator.boundingBox();
    const t = await activeTab.boundingBox();
    return Math.abs(i.x - t.x);
  }, { timeout: 1000 }).toBeLessThanOrEqual(2);
});

test("clicking a tab moves the indicator to it once the cursor leaves the nav", async ({ page }) => {
  await page.click("#tab-manage");
  await page.mouse.move(10, 600);
  const indicator = page.locator(".nav-indicator");
  const newActive = page.locator("#tab-manage");
  await expect.poll(async () => {
    const i = await indicator.boundingBox();
    const t = await newActive.boundingBox();
    return Math.abs(i.x - t.x);
  }, { timeout: 1000 }).toBeLessThanOrEqual(2);
});

/* CSS-only fallback: simulate JS-disabled by removing .has-indicator
 * from the nav. The .nav-tab.active rules must keep the active visual
 * even when hovered. Two tests, one per theme. */
/* Freezes the .nav-tab transition (color 0.15s, background 0.15s)
 * so we measure the steady-state background / border-color instead
 * of catching the interpolation mid-flight. Without this, the "before"
 * read after removing .has-indicator catches the transparent → accent
 * fade and returns a half-faded rgba value. We can't use addStyleTag
 * — the app's CSP forbids inline <style>; element-level style="" is
 * allowed though. */
async function freezeTabTransitions(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll(".nav-tab")) {
      el.style.transition = "none";
    }
  });
}

test("CSS fallback (studio): active tab keeps its accent background on hover", async ({ page }) => {
  await freezeTabTransitions(page);
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-direction", "studio");
    document.querySelector(".nav").classList.remove("has-indicator");
  });
  const tab = page.locator("#tab-play");
  const before = await tab.evaluate((el) => getComputedStyle(el).backgroundColor);
  await tab.hover();
  const after = await tab.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(after).toBe(before);
  /* And it must not be transparent — the bug was: hover zeroed it. */
  expect(after).not.toBe("rgba(0, 0, 0, 0)");
});

test("studio: hovering another tab swaps text colors (active loses accent-text, hovered gains it)", async ({ page }) => {
  await freezeTabTransitions(page);
  await page.evaluate(() => document.documentElement.setAttribute("data-direction", "studio"));
  const active = page.locator("#tab-play");
  const other = page.locator("#tab-manage");
  /* Read once, before any hover, the canonical "active-on-pill" color. */
  const accentTextColor = await active.evaluate((el) => getComputedStyle(el).color);
  await other.hover();
  const activeAfter = await active.evaluate((el) => getComputedStyle(el).color);
  const hoveredAfter = await other.evaluate((el) => getComputedStyle(el).color);
  /* Active tab must abandon the accent-text once the pill slides away
   * (would be invisible on the neutral nav surface). */
  expect(activeAfter).not.toBe(accentTextColor);
  /* Hovered tab now sits under the pill and must take the accent-text. */
  expect(hoveredAfter).toBe(accentTextColor);
});

test("theme switch re-positions the indicator on the active tab", async ({ page }) => {
  /* Both themes have different .nav padding/gap and .nav-tab padding,
   * so tab offsets shift on toggle. Verify the indicator follows the
   * active tab's new box instead of staying on the old pixel position. */
  await page.evaluate(() => document.documentElement.setAttribute("data-direction", "editorial"));
  const indicator = page.locator(".nav-indicator");
  const activeTab = page.locator("#tab-play");
  await expect.poll(async () => {
    const i = await indicator.boundingBox();
    const t = await activeTab.boundingBox();
    return Math.abs(i.x - t.x) + Math.abs(i.width - t.width);
  }, { timeout: 1000 }).toBeLessThanOrEqual(2);

  await page.evaluate(() => document.documentElement.setAttribute("data-direction", "studio"));
  await expect.poll(async () => {
    const i = await indicator.boundingBox();
    const t = await activeTab.boundingBox();
    return Math.abs(i.x - t.x) + Math.abs(i.width - t.width);
  }, { timeout: 1000 }).toBeLessThanOrEqual(2);
});

test("CSS fallback (editorial): active tab keeps its accent underline on hover", async ({ page }) => {
  await freezeTabTransitions(page);
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-direction", "editorial");
    document.querySelector(".nav").classList.remove("has-indicator");
  });
  const tab = page.locator("#tab-play");
  const before = await tab.evaluate((el) => getComputedStyle(el).borderBottomColor);
  await tab.hover();
  const after = await tab.evaluate((el) => getComputedStyle(el).borderBottomColor);
  expect(after).toBe(before);
  expect(after).not.toBe("rgba(0, 0, 0, 0)");
});
