import { test, expect } from "@playwright/test";
import { mockScryfall } from "./_helpers.js";

/* This is the regression test for the bug shipped in May 2026: an
 * author CSS rule won by origin precedence over `[hidden]` from the UA
 * stylesheet, leaving both views visible at once. Pure-module unit
 * tests didn't catch it; only a real browser sees the cascade. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
});

test("default state: play view visible, manage view hidden", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#view-play")).toBeVisible();
  await expect(page.locator("#view-manage")).toBeHidden();
});

test("clicking Gérer hides the play view and shows the manage view", async ({ page }) => {
  await page.goto("/index.html");
  await page.click("#tab-manage");
  await expect(page.locator("#view-play")).toBeHidden();
  await expect(page.locator("#view-manage")).toBeVisible();
});

test("clicking Jouer brings the play view back", async ({ page }) => {
  await page.goto("/index.html");
  await page.click("#tab-manage");
  await page.click("#tab-play");
  await expect(page.locator("#view-play")).toBeVisible();
  await expect(page.locator("#view-manage")).toBeHidden();
});

test("manage view is pre-rendered before its first tab click (instant switch)", async ({ page }) => {
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
  // Even though the manage view is hidden, its content is already in
  // the DOM thanks to switchDeck pre-rendering. Toggling the tab is
  // a pure visibility flip — no extra render delay.
  const rowsCount = await page.locator("#manage-cards .card-row").count();
  expect(rowsCount).toBeGreaterThan(10);
});

test("analyze view is pre-rendered before its first tab click (instant switch)", async ({ page }) => {
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
  // Same idea for the analyze view — bracket and suggestions are
  // already populated even though the panel is hidden.
  await expect(page.locator("#analyze-bracket .bracket-badge")).toBeAttached();
  await expect(page.locator("#analyze-suggestions .suggestion-row").first()).toBeAttached();
});

test("active tab carries .active class and aria-selected=true", async ({ page }) => {
  await page.goto("/index.html");
  await page.click("#tab-manage");
  await expect(page.locator("#tab-manage")).toHaveClass(/active/);
  await expect(page.locator("#tab-manage")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#tab-play")).not.toHaveClass(/active/);
  await expect(page.locator("#tab-play")).toHaveAttribute("aria-selected", "false");
});
