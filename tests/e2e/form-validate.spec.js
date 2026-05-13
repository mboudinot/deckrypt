import { test, expect } from "@playwright/test";
import { mockScryfall, openDeckMenu } from "./_helpers.js";

/* Form validation flows outside the login overlay (which has its
 * own spec). Verifies that the shared form-validate helper plays
 * nicely with each form's existing message channel: import uses
 * setStatus, paste-add uses flash. The behavior we lock here is
 * "empty submit -> red border on the missing field(s) + a sane
 * message + focus on the first invalid". */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
});

test("import: submit with both fields empty flags both inputs", async ({ page }) => {
  await openDeckMenu(page);
  await page.click("#btn-import-toggle");
  await page.click("#import-confirm");
  await expect(page.locator("#import-name")).toHaveClass(/is-invalid/);
  await expect(page.locator("#import-text")).toHaveClass(/is-invalid/);
  await expect(page.locator("#import-name")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#import-text")).toHaveAttribute("aria-invalid", "true");
});

test("import: only name missing -> flag only the name field", async ({ page }) => {
  await openDeckMenu(page);
  await page.click("#btn-import-toggle");
  await page.locator("#import-text").fill("1 Sol Ring");
  await page.click("#import-confirm");
  await expect(page.locator("#import-name")).toHaveClass(/is-invalid/);
  await expect(page.locator("#import-text")).not.toHaveClass(/is-invalid/);
});

test("import: only text missing -> flag only the textarea", async ({ page }) => {
  await openDeckMenu(page);
  await page.click("#btn-import-toggle");
  await page.locator("#import-name").fill("My deck");
  await page.click("#import-confirm");
  await expect(page.locator("#import-text")).toHaveClass(/is-invalid/);
  await expect(page.locator("#import-name")).not.toHaveClass(/is-invalid/);
});

test("import: text non-empty but yields zero cards -> flag textarea", async ({ page }) => {
  await openDeckMenu(page);
  await page.click("#btn-import-toggle");
  await page.locator("#import-name").fill("Junk");
  await page.locator("#import-text").fill("just some random unparseable text");
  await page.click("#import-confirm");
  await expect(page.locator("#import-text")).toHaveClass(/is-invalid/);
});

test("import: typing in a flagged field clears its red border live", async ({ page }) => {
  await openDeckMenu(page);
  await page.click("#btn-import-toggle");
  await page.click("#import-confirm");
  await expect(page.locator("#import-name")).toHaveClass(/is-invalid/);
  await page.locator("#import-name").type("M");
  await expect(page.locator("#import-name")).not.toHaveClass(/is-invalid/);
  /* The other flagged field stays flagged until that one is engaged. */
  await expect(page.locator("#import-text")).toHaveClass(/is-invalid/);
});

test("import: reopening the panel after a failed attempt resets flags", async ({ page }) => {
  await openDeckMenu(page);
  await page.click("#btn-import-toggle");
  await page.click("#import-confirm");
  await expect(page.locator("#import-name")).toHaveClass(/is-invalid/);
  await page.keyboard.press("Escape");
  await openDeckMenu(page);
  await page.click("#btn-import-toggle");
  await expect(page.locator("#import-name")).not.toHaveClass(/is-invalid/);
  await expect(page.locator("#import-text")).not.toHaveClass(/is-invalid/);
});

test("manage paste-add: empty textarea + click flags the textarea", async ({ page }) => {
  await page.click("#tab-manage");
  await page.click("#add-card-paste-btn");
  await expect(page.locator("#add-card-paste-text")).toHaveClass(/is-invalid/);
});

test("manage paste-add: typing clears the flag", async ({ page }) => {
  await page.click("#tab-manage");
  await page.click("#add-card-paste-btn");
  await expect(page.locator("#add-card-paste-text")).toHaveClass(/is-invalid/);
  await page.locator("#add-card-paste-text").type("1 Sol Ring");
  await expect(page.locator("#add-card-paste-text")).not.toHaveClass(/is-invalid/);
});

test("paste-add of a lowercase card name resolves to the canonical Scryfall name + correct category (regression)", async ({ page }) => {
  /* The user pasted "1 sol ring" verbatim and the row landed in
   * the Inconnu bucket with no thumbnail. Scryfall returned the
   * card correctly with name="Sol Ring", but the manage view's
   * resolvedByName map was keyed by the canonical "Sol Ring"
   * while the lookup used entry.name="sol ring" — case-sensitive
   * miss. Fixed by lower-casing both ends of the lookup. This
   * test layers a Scryfall override that simulates the real
   * server's behavior (canonical capitalization in responses). */
  /* Playwright runs route handlers in LIFO order. The beforeEach
   * already registered the catch-all mockScryfall; we add a more
   * recent, more-specific override here so any /cards/collection
   * call after this point (e.g., the paste-add resolve) goes
   * through our canonical-case responder instead of the echo mock. */
  await page.route("**/api.scryfall.com/cards/collection", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    const data = (body.identifiers || []).map((id) => {
      /* Only "mana crypt" -> canonical "Mana Crypt" is exercised in
       * this test. We pick that card because it's NOT in the seeded
       * Sultai deck, so the paste-add triggers an actual network
       * fetch (not a card-cache hit) and our override fires. */
      const canonical = id.name && id.name.toLowerCase() === "mana crypt"
        ? "Mana Crypt"
        : (id.name || "Test Card");
      const typeLine = canonical === "Mana Crypt" ? "Artifact" : "Creature";
      return {
        name: canonical,
        set: "tst", collector_number: String(Math.abs(canonical.length * 37) % 10000),
        cmc: 1, type_line: typeLine,
        colors: [], produced_mana: [],
        image_uris: {
          small: "https://test.scryfall.io/sm/tst/x.png",
          normal: "https://test.scryfall.io/nm/tst/x.png",
        },
      };
    });
    await route.fulfill({ json: { data, not_found: [] } });
  });

  await page.click("#tab-manage");

  /* Paste a card that is NOT in the seeded Sultai deck. Otherwise
   * the card-cache from the initial deck resolve already has it
   * (cached case-insensitively) and refreshResolved returns
   * synchronously — no network call, no chance for our override
   * to inject the canonical capitalization that reproduces the
   * bug. */
  await page.fill("#add-card-paste-text", "1 mana crypt");
  const responsePromise = page.waitForResponse((r) =>
    r.url().includes("/cards/collection") && r.request().method() === "POST"
  );
  await page.click("#add-card-paste-btn");
  await responsePromise;
  await page.waitForTimeout(200);

  /* The Artifact group must show the card under its canonical
   * "Mana Crypt" spelling, NOT the user's lowercase typing, and
   * the row must NOT land in the Inconnu bucket. */
  const artifactGroup = page.locator('details[data-group-type="Artifact"]');
  await expect(artifactGroup).toBeVisible();
  await expect(artifactGroup).toContainText("Mana Crypt");
  const inconnuGroup = page.locator('details[data-group-type="Inconnu"]');
  const inconnuCount = await inconnuGroup.count();
  if (inconnuCount > 0) {
    await expect(inconnuGroup).not.toContainText(/mana crypt/i);
  }
});
