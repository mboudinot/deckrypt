import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, openDeckMenu, seedSultaiDeck } from "./_helpers.js";

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
});

test("Import button opens the modal in import mode", async ({ page }) => {
  /* Single-panel modal (no tabs): the entry point picks the mode,
   * the title reflects it, and only the matching panel is shown. */
  await expect(page.locator("#ie-modal")).toBeHidden();
  await openDeckMenu(page);
  await page.click("#btn-import-toggle");
  await expect(page.locator("#ie-modal")).toBeVisible();
  await expect(page.locator("#ie-modal-title")).toHaveText(/Importer/);
  await expect(page.locator("#ie-panel-import")).toBeVisible();
  await expect(page.locator("#ie-panel-export")).toBeHidden();
});

test("Import lives in the header deck-menu (reachable from any view), Export is in the Manage view kebab", async ({ page }) => {
  /* Import moved into the deck-pill dropdown — open the menu to see
   * it, but it's reachable from every view. */
  await openDeckMenu(page);
  await expect(page.locator("#btn-import-toggle")).toBeVisible();
  await page.keyboard.press("Escape");
  /* Export lives inside the Manage view's deck-summary kebab menu.
   * Hidden until the user is on Manage AND opens the kebab. */
  await expect(page.locator("#btn-export")).toBeHidden();
  await page.click("#tab-manage");
  /* Still hidden — kebab closed by default. */
  await expect(page.locator("#btn-export")).toBeHidden();
  await page.click("#btn-deck-kebab");
  await expect(page.locator("#btn-export")).toBeVisible();
});

test("Export kebab item opens the modal in export mode (no import panel visible)", async ({ page }) => {
  await page.click("#tab-manage");
  await page.click("#btn-deck-kebab");
  await page.click("#btn-export");
  await expect(page.locator("#ie-modal")).toBeVisible();
  await expect(page.locator("#ie-modal-title")).toHaveText(/Exporter/);
  await expect(page.locator("#ie-panel-export")).toBeVisible();
  await expect(page.locator("#ie-panel-import")).toBeHidden();
});

test("export select renders its chevron (data: URI allowed by CSP) and has cursor:pointer (regression)", async ({ page }) => {
  /* Two bugs fixed together (May 2026):
   *  (a) the data: URI for the custom chevron was blocked by the CSP
   *      img-src directive, making the chevron invisible — added
   *      `data:` to img-src.
   *  (b) the select had cursor:default (browser native) instead of
   *      cursor:pointer like every other clickable. */
  const cspViolations = [];
  page.on("console", (m) => {
    if (/data:|img-src|Content Security/i.test(m.text())) cspViolations.push(m.text());
  });
  await page.click("#tab-manage");
  await page.click("#btn-deck-kebab");
  await page.click("#btn-export");
  await page.waitForTimeout(200);
  expect(cspViolations).toEqual([]);
  const cursor = await page.locator("#export-format").evaluate((el) => getComputedStyle(el).cursor);
  expect(cursor).toBe("pointer");
});

test("form fields follow the theme radius token (editorial = 2px, studio = 10px)", async ({ page }) => {
  /* Regression: the export modal's <select>, <textarea> and the
   * import modal's <input> + <textarea> hardcoded `border-radius: 8px`
   * — invisible in studio (token is 10px) but jarring in editorial
   * (token is 2px). Switched to `var(--radius)` so they scale with
   * the theme. Asserted against computed style. */
  await page.click("#tab-manage");
  await page.click("#btn-deck-kebab");
  await page.click("#btn-export");
  /* Studio default — radius should be 10px. */
  const studioRadius = await page.locator("#export-output").evaluate(
    (el) => getComputedStyle(el).borderRadius
  );
  expect(studioRadius).toBe("10px");
  /* Flip to editorial via the html attribute (boot-theme.js handles
   * persistence; we just need the current paint here). */
  await page.evaluate(() => document.documentElement.setAttribute("data-direction", "editorial"));
  const editorialRadius = await page.locator("#export-output").evaluate(
    (el) => getComputedStyle(el).borderRadius
  );
  expect(editorialRadius).toBe("2px");
});

test("import + export modal buttons use the .btn class system (consistent styling)", async ({ page }) => {
  /* The action buttons were raw <button class="primary"> originally,
   * which made them rely on the global `button { ... }` reset and
   * look out of place next to the confirm-dialog buttons. They now
   * use the `.btn` class chain — same system as the confirm modal. */
  /* Import side. */
  await openDeckMenu(page);
  await page.click("#btn-import-toggle");
  await expect(page.locator("#import-confirm")).toHaveClass(/\bbtn\b/);
  await expect(page.locator("#import-confirm")).toHaveClass(/\bprimary\b/);
  await expect(page.locator("#import-cancel")).toHaveClass(/\bbtn\b/);
  await page.keyboard.press("Escape");
  /* Export side. */
  await page.click("#tab-manage");
  await page.click("#btn-deck-kebab");
  await page.click("#btn-export");
  await expect(page.locator("#export-copy")).toHaveClass(/\bbtn\b/);
  await expect(page.locator("#export-copy")).toHaveClass(/\bprimary\b/);
  await expect(page.locator("#export-download")).toHaveClass(/\bbtn\b/);
});

test("modal fits within the viewport without scrolling the chrome (regression)", async ({ page }) => {
  /* The old dual-tab modal made the export panel + tabs exceed
   * 90vh on shorter viewports, forcing the user to scroll the
   * modal itself. Dropping the tab strip plus a height-clamped
   * export-output keeps the chrome within bounds — the textarea
   * scrolls instead. */
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.click("#tab-manage");
  await page.click("#btn-deck-kebab");
  await page.click("#btn-export");
  const modalContent = await page.locator(".ie-modal-content").boundingBox();
  /* 90vh = 540px on a 600px viewport. The content must not exceed it. */
  expect(modalContent.height).toBeLessThanOrEqual(540);
});

test("Escape and the X button close the modal", async ({ page }) => {
  await page.click("#tab-manage");
  /* Exporter lives in the deck-summary kebab menu — open it first. */
  await page.click("#btn-deck-kebab");
  await page.click("#btn-export");
  await page.keyboard.press("Escape");
  await expect(page.locator("#ie-modal")).toBeHidden();

  /* Modal+kebab both closed by Escape — re-open both for round 2. */
  await page.click("#btn-deck-kebab");
  await page.click("#btn-export");
  await page.click("#ie-modal-close");
  await expect(page.locator("#ie-modal")).toBeHidden();
});

test("Backdrop click does NOT close the modal (protects pasted content)", async ({ page }) => {
  await openDeckMenu(page);
  await page.click("#btn-import-toggle");
  await page.locator("#import-text").fill("1 Sol Ring");
  // Click well outside the content panel — the backdrop area.
  await page.locator("#ie-modal").click({ position: { x: 5, y: 5 } });
  await expect(page.locator("#ie-modal")).toBeVisible();
  await expect(page.locator("#import-text")).toHaveValue("1 Sol Ring");
});

test("Export populates the 4 formats in the select, MTGA chosen by default", async ({ page }) => {
  await page.click("#tab-manage");
  /* Exporter lives in the deck-summary kebab menu — open it first. */
  await page.click("#btn-deck-kebab");
  await page.click("#btn-export");
  await expect(page.locator("#export-format option")).toHaveCount(4);
  // Default selection.
  const selected = await page.locator("#export-format").inputValue();
  expect(selected).toBe("moxfield");
});

test("Export generates output that matches the selected format", async ({ page }) => {
  await page.click("#tab-manage");
  /* Exporter lives in the deck-summary kebab menu — open it first. */
  await page.click("#btn-deck-kebab");
  await page.click("#btn-export");

  // MTGA / Moxfield format: section headers + "qty Name (SET) cn" rows.
  let out = await page.locator("#export-output").inputValue();
  expect(out).toContain("// Commanders");
  expect(out).toContain("// Mainboard");

  // Switch to plain — one line per copy, no section headers.
  await page.locator("#export-format").selectOption("plain");
  out = await page.locator("#export-output").inputValue();
  expect(out).not.toContain("// Commanders");
  expect(out.split("\n").length).toBeGreaterThan(50); // Sultai has ~100 copies

  // Switch to JSON — parseable.
  await page.locator("#export-format").selectOption("json");
  out = await page.locator("#export-output").inputValue();
  const parsed = JSON.parse(out);
  expect(parsed.name).toBeTruthy();
  expect(parsed.format).toBe("commander");
  expect(Array.isArray(parsed.cards)).toBe(true);
});

test("Format description updates when the user changes format", async ({ page }) => {
  await page.click("#tab-manage");
  /* Exporter lives in the deck-summary kebab menu — open it first. */
  await page.click("#btn-deck-kebab");
  await page.click("#btn-export");
  const before = await page.locator("#export-description").textContent();
  await page.locator("#export-format").selectOption("plain");
  const after = await page.locator("#export-description").textContent();
  expect(after).not.toBe(before);
  expect(after).toMatch(/Discord|e-mail/i);
});

test("Import flow still works end-to-end via the modal", async ({ page }) => {
  await openDeckMenu(page);
  await page.click("#btn-import-toggle");
  await page.locator("#import-name").fill("Tiny test deck");
  await page.locator("#import-text").fill("1 Sol Ring\n1 Forest");
  // Wait for the preview to enable the confirm button.
  await expect(page.locator("#import-confirm")).toBeEnabled();
  await page.click("#import-confirm");
  // After confirm, the new deck is selected and the modal closes.
  await expect(page.locator("#ie-modal")).toBeHidden();
  await expect(page.locator("#deck-select option", { hasText: "Tiny test deck" }))
    .toHaveCount(1);
});
