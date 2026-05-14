import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, seedSultaiDeck } from "./_helpers.js";

/* The play-view context menu mirrors the click-modal's actions but
 * appears at the cursor and skips the big-image surface — a faster
 * loop for repetitive moves. These specs lock the wiring (right-click
 * opens, Escape / outside-click close, item executes the action). */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await page.locator("#hand .card").first().waitFor();
});

test("right-click on a hand card opens a context menu with Jouer + Défausser", async ({ page }) => {
  await page.locator("#hand .card").first().click({ button: "right" });
  const menu = page.locator(".ctx-menu");
  await expect(menu).toBeVisible();
  await expect(menu.locator(".dropdown-item")).toHaveCount(2);
  await expect(menu.locator(".dropdown-item.ctx-primary")).toHaveText("Jouer");
  await expect(menu.locator(".dropdown-item").nth(1)).toHaveText("Défausser");
});

test("clicking a menu item runs the action and closes the menu", async ({ page }) => {
  const hand = page.locator("#hand .card");
  const before = await hand.count();
  await hand.first().click({ button: "right" });
  await page.locator(".ctx-menu .dropdown-item", { hasText: "Défausser" }).click();
  await expect(page.locator(".ctx-menu")).toHaveCount(0);
  /* Defaussée → cimetière. Hand shrinks by one. */
  await expect(hand).toHaveCount(before - 1);
});

test("Escape closes the context menu", async ({ page }) => {
  await page.locator("#hand .card").first().click({ button: "right" });
  await expect(page.locator(".ctx-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".ctx-menu")).toHaveCount(0);
});

test("clicking outside closes the context menu", async ({ page }) => {
  await page.locator("#hand .card").first().click({ button: "right" });
  await expect(page.locator(".ctx-menu")).toBeVisible();
  /* Click far away from the menu — the play-section title is a safe
   * non-card target. */
  await page.locator("#view-play .play-section .title").first().click();
  await expect(page.locator(".ctx-menu")).toHaveCount(0);
});

test("right-click on the same card while the menu is open re-anchors it", async ({ page }) => {
  const card = page.locator("#hand .card").first();
  await card.click({ button: "right", position: { x: 10, y: 10 } });
  await expect(page.locator(".ctx-menu")).toHaveCount(1);
  await card.click({ button: "right", position: { x: 80, y: 80 } });
  /* Still exactly one menu — the previous one was torn down. */
  await expect(page.locator(".ctx-menu")).toHaveCount(1);
});
