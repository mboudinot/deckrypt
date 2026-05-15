import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, seedSultaiDeck } from "./_helpers.js";

/* Settings modal: opening from the account dropdown, ⌘+, shortcut,
 * tab switching, theme picker persistence. Auth is mocked at the
 * window.sync level by overriding currentUser BEFORE the controller
 * reads it — keeps these tests offline. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
});

test("settings modal is hidden by default", async ({ page }) => {
  await expect(page.locator("#settings-modal")).toBeHidden();
});

test("Ctrl+, opens the settings modal even without going through the account menu", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await expect(page.locator("#settings-modal")).toBeVisible();
});

test("Escape closes the settings modal", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await expect(page.locator("#settings-modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#settings-modal")).toBeHidden();
});

test("clicking the backdrop closes the modal", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await expect(page.locator("#settings-modal")).toBeVisible();
  /* Click the backdrop near the edge (outside .settings-modal). */
  const box = await page.locator("#settings-modal").boundingBox();
  await page.mouse.click(box.x + 5, box.y + 5);
  await expect(page.locator("#settings-modal")).toBeHidden();
});

test("clicking the X button closes the modal", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await page.click("#btn-settings-close");
  await expect(page.locator("#settings-modal")).toBeHidden();
});

test("clicking each tab switches which panel is visible", async ({ page }) => {
  await page.keyboard.press("Control+,");
  /* Default = Apparence. */
  await expect(page.locator('[data-settings-panel="appearance"]')).toBeVisible();
  await expect(page.locator('[data-settings-panel="preferences"]')).toBeHidden();
  await page.click('[data-settings-tab="preferences"]');
  await expect(page.locator('[data-settings-panel="preferences"]')).toBeVisible();
  await expect(page.locator('[data-settings-panel="appearance"]')).toBeHidden();
  await page.click('[data-settings-tab="account"]');
  await expect(page.locator('[data-settings-panel="account"]')).toBeVisible();
});

test("Raccourcis tab no longer exists (removed from the modal)", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await expect(page.locator('[data-settings-tab="shortcuts"]')).toHaveCount(0);
  await expect(page.locator('[data-settings-panel="shortcuts"]')).toHaveCount(0);
});

test("theme-card check badge is only visible on the active theme", async ({ page }) => {
  await page.keyboard.press("Control+,");
  const studioCheck = page.locator('[data-theme="studio"] .theme-card-check');
  const editorialCheck = page.locator('[data-theme="editorial"] .theme-card-check');
  const opacity = (loc) => loc.evaluate((el) => parseFloat(getComputedStyle(el).opacity));
  /* Poll past the 0.15s opacity transition. */
  await expect.poll(() => opacity(studioCheck)).toBe(1);
  await expect.poll(() => opacity(editorialCheck)).toBe(0);
  await page.click('[data-theme="editorial"]');
  await expect.poll(() => opacity(studioCheck)).toBe(0);
  await expect.poll(() => opacity(editorialCheck)).toBe(1);
});

test("modal frame keeps the same height across tab switches (no reflow on rubric change)", async ({ page }) => {
  await page.keyboard.press("Control+,");
  const modal = page.locator(".settings-modal");
  /* The 0.25s modal-in animation scales the box; wait for it to
   * settle before sampling so the first measurement isn't taken
   * mid-transform. */
  await page.waitForTimeout(300);
  const h1 = (await modal.boundingBox()).height;
  await page.click('[data-settings-tab="preferences"]');
  const h2 = (await modal.boundingBox()).height;
  await page.click('[data-settings-tab="account"]');
  const h3 = (await modal.boundingBox()).height;
  expect(h2).toBe(h1);
  expect(h3).toBe(h1);
});

test("Compte tab shows Pseudo + Email, hides UID, and exposes both editor rows", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await page.click('[data-settings-tab="account"]');
  const panel = page.locator('[data-settings-panel="account"]');
  await expect(panel).toContainText("Pseudo");
  await expect(panel).toContainText("Email");
  await expect(panel).not.toContainText("UID");
  await expect(panel.locator('[data-edit-open="pseudo"]')).toBeVisible();
  await expect(panel.locator('[data-edit-open="password"]')).toBeVisible();
});

test("Pseudo + Mot de passe forms are collapsed by default (only the trigger row is visible)", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await page.click('[data-settings-tab="account"]');
  await expect(page.locator("#settings-pseudo-form")).toBeHidden();
  await expect(page.locator("#settings-password-form")).toBeHidden();
  await page.click('[data-edit-open="pseudo"]');
  await expect(page.locator("#settings-pseudo-form")).toBeVisible();
  /* Clicking the trigger again collapses it. */
  await page.click('[data-edit-open="pseudo"]');
  await expect(page.locator("#settings-pseudo-form")).toBeHidden();
});

test("Pseudo edit form opens, submits, and the displayed pseudo updates", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await page.click('[data-settings-tab="account"]');
  await page.click('[data-edit-open="pseudo"]');
  const form = page.locator("#settings-pseudo-form");
  await expect(form).toBeVisible();
  await form.locator("input[name='pseudo']").fill("Nouveau Pseudo");
  await form.locator("button[type='submit']").click();
  await expect(page.locator('[data-settings-panel="account"]')).toContainText("Nouveau Pseudo");
});

test("Voir/Cacher toggle swaps each password input between password and text type", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await page.click('[data-settings-tab="account"]');
  await page.click('[data-edit-open="password"]');
  const input = page.locator("#settings-pwd-current");
  const toggle = input.locator("xpath=../button[contains(@class, 'pwd-toggle')]");
  await expect(input).toHaveAttribute("type", "password");
  await expect(toggle).toHaveText("Voir");
  await toggle.click();
  await expect(input).toHaveAttribute("type", "text");
  await expect(toggle).toHaveText("Cacher");
  await toggle.click();
  await expect(input).toHaveAttribute("type", "password");
});

test("New password shorter than 8 chars shows an inline length error (no Firebase round-trip)", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await page.click('[data-settings-tab="account"]');
  await page.click('[data-edit-open="password"]');
  const form = page.locator("#settings-password-form");
  /* HTML5 minLength would also block submission with a native bubble.
   * We need to bypass that to exercise our JS validator — set the
   * attribute to 1 just for this test so the form submits with a
   * short value, then assert the JS catches it. */
  await form.locator("input[name='next'], input[name='confirm']").evaluateAll((els) => {
    els.forEach((el) => el.setAttribute("minlength", "1"));
  });
  await form.locator("input[name='current']").fill("oldoldold");
  await form.locator("input[name='next']").fill("short");
  await form.locator("input[name='confirm']").fill("short");
  await form.locator("button[type='submit']").click();
  await expect(form.locator(".account-edit-msg.error")).toContainText("au moins 8");
});

test("Mismatching new + confirm passwords shows an inline mismatch error", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await page.click('[data-settings-tab="account"]');
  await page.click('[data-edit-open="password"]');
  const form = page.locator("#settings-password-form");
  await form.locator("input[name='current']").fill("oldoldold");
  await form.locator("input[name='next']").fill("brandnewpassword");
  await form.locator("input[name='confirm']").fill("brandnewdifferent");
  await form.locator("button[type='submit']").click();
  await expect(form.locator(".account-edit-msg.error")).toContainText("ne correspondent pas");
});

test("Strength meter is attached to the 'next' field only (not current, not confirm)", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await page.click('[data-settings-tab="account"]');
  await page.click('[data-edit-open="password"]');
  /* Each .field with the meter has it as a direct child; the others don't. */
  await expect(page.locator("#settings-pwd-next ~ .pwd-meter, #settings-pwd-next + .pwd-meter")).toHaveCount(0); // sanity: meter is below the wrap, not the input
  /* Scope the count via the parent field instead — the meter is the last child of the next-field. */
  const fields = page.locator("#settings-password-form .field");
  await expect(fields).toHaveCount(3);
  await expect(fields.nth(0).locator(".pwd-meter")).toHaveCount(0);
  await expect(fields.nth(1).locator(".pwd-meter")).toHaveCount(1);
  await expect(fields.nth(2).locator(".pwd-meter")).toHaveCount(0);
});

test("Strength meter stays hidden for empty input, surfaces score + non-blocking note for weak passwords", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await page.click('[data-settings-tab="account"]');
  await page.click('[data-edit-open="password"]');
  const meter = page.locator("#settings-password-form .pwd-meter");
  await expect(meter).toBeHidden();
  /* Common-list password → score 0 → "Très faible" + disclaimer. */
  await page.locator("#settings-pwd-next").fill("password123");
  await expect(meter).toBeVisible();
  await expect(meter).toHaveAttribute("data-score", "0");
  await expect(meter.locator(".pwd-meter-label")).toHaveText("Très faible");
  await expect(meter.locator(".pwd-meter-note")).toBeVisible();
  /* Strong password → score ≥ 3 → no disclaimer. */
  await page.locator("#settings-pwd-next").fill("MyD3ckRulez!");
  await expect(meter).not.toHaveAttribute("data-score", "0");
  await expect(meter.locator(".pwd-meter-note")).toBeHidden();
});

test("Weak password does NOT block submit (philosophy: warn, don't gate)", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await page.click('[data-settings-tab="account"]');
  await page.click('[data-edit-open="password"]');
  const form = page.locator("#settings-password-form");
  /* `password123` is in the common list — meter scores it 0/4 but
   * the form must still accept the submission (TEST_MODE makes
   * sync.changePassword a no-op, so a green "Mot de passe mis à
   * jour" is the success signal). */
  await form.locator("input[name='current']").fill("oldoldoldold");
  await form.locator("input[name='next']").fill("password123");
  await form.locator("input[name='confirm']").fill("password123");
  await form.locator("button[type='submit']").click();
  await expect(form.locator(".account-edit-msg.success")).toContainText("Mot de passe mis à jour");
});

test("Zone à risque exposes an enabled 'Supprimer' trigger (no more À venir placeholder)", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await page.click('[data-settings-tab="account"]');
  const trigger = page.locator('[data-edit-open="delete"]');
  await expect(trigger).toBeVisible();
  await expect(trigger).toBeEnabled();
  await expect(trigger).toHaveText("Supprimer");
  /* Zone à risque section no longer carries the (À venir) placeholder. */
  await expect(page.locator(".danger-zone .settings-section-head")).not.toContainText("À venir");
});

test("Delete-account form expands with a warning + current-password field for password users", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await page.click('[data-settings-tab="account"]');
  await expect(page.locator("#settings-delete-form")).toBeHidden();
  await page.click('[data-edit-open="delete"]');
  const form = page.locator("#settings-delete-form");
  await expect(form).toBeVisible();
  await expect(form.locator(".account-edit-warning")).toContainText("définitive");
  await expect(form.locator("#settings-delete-pwd")).toBeVisible();
  await expect(form.locator("button[type='submit']")).toHaveText("Supprimer définitivement");
});

test("Submitting the delete form (password user) closes the modal and re-locks the shell", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await page.click('[data-settings-tab="account"]');
  await page.click('[data-edit-open="delete"]');
  await page.locator("#settings-delete-pwd").fill("anyvalue");
  await page.locator("#settings-delete-form button[type='submit']").click();
  /* TEST_MODE's deleteAccount fans out auth-null synchronously, so
   * the auth subscriber re-locks the shell + reopens the overlay. */
  await expect(page.locator("#settings-modal")).toBeHidden();
  await expect(page.locator("html")).toHaveClass(/auth-locked/);
  await expect(page.locator("#login-overlay")).toBeVisible();
});

test("Account deletion clears the pre-rendered manage view (cross-user leak guard)", async ({ page }) => {
  /* Reproduces what the user hit on their first manual test: after
   * deleting their account and re-signing-in, the Manage tab still
   * showed the previous deck because clearActiveView only reset the
   * Play view. The Manage / Analyze / Gallery panels are pre-rendered
   * for instant tab switching, so their DOM survives unless we
   * explicitly re-render them. New contract: each renderer toggles
   * `.view-empty` on its container, which the CSS uses to hide the
   * pre-rendered layout and show the shared CTA — checking the class
   * is the right invariant (the textContent of `#manage-deck-name`
   * is now an implementation detail of the hidden subtree). */
  await page.click("#tab-manage");
  await expect(page.locator("#view-manage")).not.toHaveClass(/view-empty/);
  await page.keyboard.press("Control+,");
  await page.click('[data-settings-tab="account"]');
  await page.click('[data-edit-open="delete"]');
  await page.locator("#settings-delete-pwd").fill("anyvalue");
  await page.locator("#settings-delete-form button[type='submit']").click();
  await expect(page.locator("html")).toHaveClass(/auth-locked/);
  await expect(page.locator("#view-manage")).toHaveClass(/view-empty/);
});

test("Delete-account form switches to a Google-reauth note for Google-only users (no password input)", async ({ page }) => {
  await page.addInitScript(() => {
    window.__deckryptTestUser = {
      uid: "test-uid-google",
      email: "google@example.com",
      displayName: "Google User",
      photoURL: null,
      providers: ["google.com"],
    };
  });
  await page.reload();
  await page.locator("#commander-zone .card").first().waitFor();
  await page.keyboard.press("Control+,");
  await page.click('[data-settings-tab="account"]');
  await page.click('[data-edit-open="delete"]');
  const form = page.locator("#settings-delete-form");
  await expect(form.locator("#settings-delete-pwd")).toHaveCount(0);
  await expect(form.locator(".account-edit-note")).toContainText("Google");
  await expect(form.locator("button[type='submit']")).toHaveText("Continuer avec Google");
});

test("Password change is disabled for Google-authed users (provider gate)", async ({ page }) => {
  /* The default mockAuth user is a password user; layer a Google-only
   * override on top, then reload so sync.js picks up the new seam at
   * init time. addInitScript ordering is registration order, so this
   * script runs AFTER the default and wins. */
  await page.addInitScript(() => {
    window.__deckryptTestUser = {
      uid: "test-uid-google",
      email: "google@example.com",
      displayName: "Google User",
      photoURL: null,
      providers: ["google.com"],
    };
  });
  await page.reload();
  await page.locator("#commander-zone .card").first().waitFor();
  await page.keyboard.press("Control+,");
  await page.click('[data-settings-tab="account"]');
  await expect(page.locator('[data-edit-open="password"]')).toBeDisabled();
});

test("clicking a theme card sets html[data-direction] and persists in localStorage", async ({ page }) => {
  await page.keyboard.press("Control+,");
  /* Studio is the default at boot. */
  await expect(page.locator("html")).toHaveAttribute("data-direction", "studio");
  await page.click('[data-theme="editorial"]');
  await expect(page.locator("html")).toHaveAttribute("data-direction", "editorial");
  const saved = await page.evaluate(() => localStorage.getItem("deckrypt-direction"));
  expect(saved).toBe("editorial");
  /* The active class follows the selection. */
  await expect(page.locator('[data-theme="editorial"]')).toHaveClass(/active/);
  await expect(page.locator('[data-theme="studio"]')).not.toHaveClass(/active/);
});

test("reloading the page keeps the saved theme (boot-theme.js applies before CSS)", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await page.click('[data-theme="editorial"]');
  await expect(page.locator("html")).toHaveAttribute("data-direction", "editorial");
  await page.reload();
  await page.locator("#commander-zone .card").first().waitFor();
  await expect(page.locator("html")).toHaveAttribute("data-direction", "editorial");
});

test("clicking a default-view segmented button persists the choice", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await page.click('[data-settings-tab="preferences"]');
  await page.click('.segmented[data-segmented="default-view"] [data-value="manage"]');
  const saved = await page.evaluate(() => localStorage.getItem("deckrypt-default-view"));
  expect(saved).toBe("manage");
  await expect(page.locator('.segmented[data-segmented="default-view"] [data-value="manage"]')).toHaveClass(/active/);
});

test("density segmented control is disabled (placeholder UI)", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await expect(page.locator('.segmented[data-segmented="density"]')).toHaveAttribute("aria-disabled", "true");
});
