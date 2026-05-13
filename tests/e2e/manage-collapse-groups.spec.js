import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, seedSultaiDeck } from "./_helpers.js";

/* Each card-group in the Manage view is a <details> so the user can
 * fold types they don't currently care about (terrains, créatures,
 * etc.). The collapsed state is stored on `state.collapsedManageGroups`
 * and survives re-renders triggered by edits — closing "Terrains"
 * and then bumping a Creature's qty doesn't reopen "Terrains". */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await page.click("#tab-manage");
});

test("all card-groups render open by default", async ({ page }) => {
  await expect(page.locator(".card-group").first()).toBeVisible();
  const groups = page.locator(".card-group");
  const total = await groups.count();
  expect(total).toBeGreaterThan(0);
  // Every group starts with the `open` attribute set.
  for (let i = 0; i < total; i++) {
    await expect(groups.nth(i)).toHaveAttribute("open", "");
  }
});

test("clicking a group's title collapses it; the card rows hide", async ({ page }) => {
  const terrainsGroup = page.locator(".card-group", {
    has: page.locator(".card-group-title", { hasText: "Terrains" }),
  });
  const cardsBefore = await terrainsGroup.locator(".card-row").count();
  expect(cardsBefore).toBeGreaterThan(0);

  await terrainsGroup.locator("summary").click();
  await expect(terrainsGroup).not.toHaveAttribute("open", "");
  // Card rows still in DOM but their containing <details> is closed,
  // so Playwright treats them as hidden.
  await expect(terrainsGroup.locator(".card-row").first()).toBeHidden();
});

test("re-clicking re-opens the group", async ({ page }) => {
  const terrainsGroup = page.locator(".card-group", {
    has: page.locator(".card-group-title", { hasText: "Terrains" }),
  });
  await terrainsGroup.locator("summary").click();
  await expect(terrainsGroup).not.toHaveAttribute("open", "");
  await terrainsGroup.locator("summary").click();
  await expect(terrainsGroup).toHaveAttribute("open", "");
  await expect(terrainsGroup.locator(".card-row").first()).toBeVisible();
});

test("collapsed state survives an edit-triggered re-render", async ({ page }) => {
  /* The user folds "Terrains" away, then bumps the qty of a creature.
   * The manage view re-renders (commitDeckChange → rerenderDeckViews
   * → renderManageView rebuilds every group). Without state, the new
   * Terrains group would render with the default open state — losing
   * the user's choice. */
  const terrainsGroup = page.locator(".card-group", {
    has: page.locator(".card-group-title", { hasText: "Terrains" }),
  });
  await terrainsGroup.locator("summary").click();
  await expect(terrainsGroup).not.toHaveAttribute("open", "");

  // Trigger a re-render via a qty change on the first creature.
  const creatureRow = page.locator(".card-group", {
    has: page.locator(".card-group-title", { hasText: "Créatures" }),
  }).locator(".card-row").first();
  await creatureRow.locator(".card-row-qty button", { hasText: "+" }).click();

  // Terrains should still be collapsed after the re-render.
  await expect(page.locator(".card-group", {
    has: page.locator(".card-group-title", { hasText: "Terrains" }),
  })).not.toHaveAttribute("open", "");
});

test("chevron rotates with the open/closed state", async ({ page }) => {
  const terrainsGroup = page.locator(".card-group", {
    has: page.locator(".card-group-title", { hasText: "Terrains" }),
  });
  const chevron = terrainsGroup.locator(".card-group-chevron");
  // Open by default → 180deg rotation (matrix(-1, 0, 0, -1, 0, 0)).
  const initial = await chevron.evaluate((el) => getComputedStyle(el).transform);
  expect(initial).toMatch(/matrix\(-1/);

  await terrainsGroup.locator("summary").click();
  await page.waitForTimeout(260);  // outwait the 200ms transition
  const after = await chevron.evaluate((el) => getComputedStyle(el).transform);
  // Closed → 0deg rotation (identity matrix or "none").
  expect(after).not.toMatch(/matrix\(-1/);
});
