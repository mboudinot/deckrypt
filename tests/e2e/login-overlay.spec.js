import { test, expect } from "@playwright/test";
import { mockScryfall } from "./_helpers.js";

/* UI-level tests for the login overlay. We never hit real Firebase
 * here — those calls would either flake or require live credentials.
 * The goal is to lock the overlay's open/close lifecycle, the
 * signin↔signup mode toggle, the password show/hide flip, and the
 * keyboard accessibility (Esc closes). Real auth round-trips are
 * smoke-tested manually via devtools. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  /* Also block the api.scryfall.com hero-card image requests on the
   * login visual side — those redirect to cards.scryfall.io but in
   * tests we don't want any real network traffic. */
  await page.route("https://api.scryfall.com/cards/named*", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from([]) })
  );
});

test("login overlay is hidden by default and the account button reads 'Connexion'", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#login-overlay")).toBeHidden();
  await expect(page.locator("#btn-account")).toHaveText("Connexion");
});

test("clicking the account button opens the overlay and focuses the email field", async ({ page }) => {
  await page.goto("/index.html");
  await page.click("#btn-account");
  await expect(page.locator("#login-overlay")).toBeVisible();
  await expect(page.locator("#login-email")).toBeFocused();
  await expect(page.locator("#btn-account")).toHaveAttribute("aria-expanded", "true");
});

test("close button's X icon is actually visible (not crushed to a dot)", async ({ page }) => {
  /* Regression: the global `button { padding: 10px 18px }` rule was
   * applying to .login-close, leaving only ~2px of content width
   * for the SVG once box-sizing accounted for padding + border.
   * The X looked like a single dot. Lock the SVG's rendered size
   * here so any future global button rule that wipes our padding
   * reset gets caught. */
  await page.goto("/index.html");
  await page.click("#btn-account");
  const svgBox = await page.locator("#login-close svg").boundingBox();
  expect(svgBox.width).toBeGreaterThanOrEqual(20);
  expect(svgBox.height).toBeGreaterThanOrEqual(20);
});

test("close button hides the overlay", async ({ page }) => {
  await page.goto("/index.html");
  await page.click("#btn-account");
  await page.click("#login-close");
  await expect(page.locator("#login-overlay")).toBeHidden();
  await expect(page.locator("#btn-account")).toHaveAttribute("aria-expanded", "false");
});

test("Escape key closes the overlay", async ({ page }) => {
  await page.goto("/index.html");
  await page.click("#btn-account");
  await expect(page.locator("#login-overlay")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#login-overlay")).toBeHidden();
});

test("password show/hide toggle flips the input type", async ({ page }) => {
  await page.goto("/index.html");
  await page.click("#btn-account");
  const pwd = page.locator("#login-pwd");
  const toggle = page.locator("#login-pwd-toggle");
  await expect(pwd).toHaveAttribute("type", "password");
  await expect(toggle).toHaveText("Voir");
  await toggle.click();
  await expect(pwd).toHaveAttribute("type", "text");
  await expect(toggle).toHaveText("Cacher");
  await toggle.click();
  await expect(pwd).toHaveAttribute("type", "password");
});

test("mode toggle swaps the title, submit label, and password autocomplete", async ({ page }) => {
  await page.goto("/index.html");
  await page.click("#btn-account");

  // Default = signin
  await expect(page.locator("#login-title")).toHaveText("Connexion");
  await expect(page.locator("#login-submit-label")).toHaveText("Se connecter");
  await expect(page.locator("#login-pwd")).toHaveAttribute("autocomplete", "current-password");
  await expect(page.locator("#login-pwd-hint")).toBeHidden();
  await expect(page.locator("#login-signin-only")).toBeVisible();

  // Switch to signup
  await page.click("#login-mode-toggle");
  await expect(page.locator("#login-title")).toHaveText("Créer un compte");
  await expect(page.locator("#login-submit-label")).toHaveText("Créer mon compte");
  await expect(page.locator("#login-pwd")).toHaveAttribute("autocomplete", "new-password");
  await expect(page.locator("#login-pwd-hint")).toBeVisible();
  /* "Se souvenir / Mot de passe oublié" row is signin-only. */
  await expect(page.locator("#login-signin-only")).toBeHidden();

  // Switch back to signin
  await page.click("#login-mode-toggle");
  await expect(page.locator("#login-title")).toHaveText("Connexion");
  await expect(page.locator("#login-signin-only")).toBeVisible();
});

test("re-opening the overlay always resets to signin mode (no carryover from last close)", async ({ page }) => {
  await page.goto("/index.html");
  await page.click("#btn-account");
  await page.click("#login-mode-toggle"); // signup
  await page.keyboard.press("Escape");
  await page.click("#btn-account");
  await expect(page.locator("#login-title")).toHaveText("Connexion");
});

test("submitting with empty email surfaces an inline error, doesn't crash", async ({ page }) => {
  await page.goto("/index.html");
  await page.click("#btn-account");
  /* Form is novalidate so the browser doesn't pre-empt the submit;
   * our controller has to catch the empty-field case itself. */
  await page.click("#login-submit");
  await expect(page.locator("#login-error")).toBeVisible();
});

test("empty form submit: error names BOTH missing fields and both get the invalid border", async ({ page }) => {
  await page.goto("/index.html");
  await page.click("#btn-account");
  await page.click("#login-submit");
  await expect(page.locator("#login-error")).toHaveText("Renseigne ton email et ton mot de passe.");
  await expect(page.locator("#login-email")).toHaveClass(/is-invalid/);
  await expect(page.locator("#login-pwd")).toHaveClass(/is-invalid/);
});

test("missing email only: message is tailored and only email gets the invalid border", async ({ page }) => {
  await page.goto("/index.html");
  await page.click("#btn-account");
  await page.fill("#login-pwd", "secret123");
  await page.click("#login-submit");
  await expect(page.locator("#login-error")).toHaveText("Renseigne ton email.");
  await expect(page.locator("#login-email")).toHaveClass(/is-invalid/);
  await expect(page.locator("#login-pwd")).not.toHaveClass(/is-invalid/);
});

test("missing password only: message + invalid border only on password", async ({ page }) => {
  await page.goto("/index.html");
  await page.click("#btn-account");
  await page.fill("#login-email", "a@b.com");
  await page.click("#login-submit");
  await expect(page.locator("#login-error")).toHaveText("Renseigne ton mot de passe.");
  await expect(page.locator("#login-email")).not.toHaveClass(/is-invalid/);
  await expect(page.locator("#login-pwd")).toHaveClass(/is-invalid/);
});

test("submitting a malformed email flags only the email field with the format message", async ({ page }) => {
  await page.goto("/index.html");
  await page.click("#btn-account");
  await page.fill("#login-email", "not-an-email");
  await page.fill("#login-pwd", "anything12");
  await page.click("#login-submit");
  await expect(page.locator("#login-error")).toHaveText("Format d'email invalide.");
  await expect(page.locator("#login-email")).toHaveClass(/is-invalid/);
  await expect(page.locator("#login-pwd")).not.toHaveClass(/is-invalid/);
});

test("invalid email + empty password: BOTH flagged, message lists both issues", async ({ page }) => {
  /* The regression that prompted aggregated validation: with the
   * previous "return on first failure" logic, the empty-pwd error
   * fired and the malformed email was silently ignored. Now every
   * field is validated independently and all problems are surfaced. */
  await page.goto("/index.html");
  await page.click("#btn-account");
  await page.fill("#login-email", "dsf");
  await page.click("#login-submit");
  await expect(page.locator("#login-email")).toHaveClass(/is-invalid/);
  await expect(page.locator("#login-pwd")).toHaveClass(/is-invalid/);
  const errText = await page.locator("#login-error").textContent();
  expect(errText).toContain("Format d'email invalide");
  expect(errText).toContain("Renseigne ton mot de passe");
});

test("signup mode: weak password (no digit) flags the password with the strength message", async ({ page }) => {
  await page.goto("/index.html");
  await page.click("#btn-account");
  await page.click("#login-mode-toggle"); // signup
  await page.fill("#login-email", "valid@example.com");
  await page.fill("#login-pwd", "alphabetsoup"); // 12 chars, no digit
  await page.click("#login-submit");
  await expect(page.locator("#login-pwd")).toHaveClass(/is-invalid/);
  await expect(page.locator("#login-email")).not.toHaveClass(/is-invalid/);
  await expect(page.locator("#login-error")).toContainText("Mot de passe");
  await expect(page.locator("#login-error")).toContainText("au moins 1 chiffre");
});

test("signup mode: a strong password (≥8 with digit) passes the client-side check", async ({ page }) => {
  /* We don't follow through to Firebase here (would be flaky) — just
   * assert that the password field does NOT get flagged invalid on a
   * compliant input. The Google/Firebase round-trip is smoke-tested
   * manually via devtools per the auth/persistence model memory. */
  await page.goto("/index.html");
  await page.click("#btn-account");
  await page.click("#login-mode-toggle"); // signup
  await page.fill("#login-email", "valid@example.com");
  await page.fill("#login-pwd", "alphabet1");
  /* Cut off the real Firebase request so we don't depend on network. */
  await page.route("**/identitytoolkit.googleapis.com/**", (r) => r.abort());
  await page.click("#login-submit");
  /* The password field should NOT be flagged. The submission itself
   * may error out (network aborted) but that's a different category
   * of error -- the inline error box may show a network message,
   * but the password border stays clean. */
  await expect(page.locator("#login-pwd")).not.toHaveClass(/is-invalid/);
});

test("typing in an invalid field clears its red border live", async ({ page }) => {
  await page.goto("/index.html");
  await page.click("#btn-account");
  await page.click("#login-submit");
  await expect(page.locator("#login-email")).toHaveClass(/is-invalid/);
  await page.locator("#login-email").type("a");
  await expect(page.locator("#login-email")).not.toHaveClass(/is-invalid/);
  /* The other field's flag stays until that field is engaged. */
  await expect(page.locator("#login-pwd")).toHaveClass(/is-invalid/);
});
