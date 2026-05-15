import { test, expect } from "@playwright/test";
import { mockScryfall, mockAuth, seedSultaiDeck } from "./_helpers.js";

/* UI-level tests for the login overlay. We never hit real Firebase
 * here — those calls would either flake or require live credentials.
 * The goal is to lock the overlay's open/close lifecycle, the
 * signin↔signup mode toggle, the password show/hide flip, and the
 * keyboard accessibility. Real auth round-trips are smoke-tested
 * manually via devtools.
 *
 * Login-obligatoire model (May 2026): the overlay is open by
 * default and dismiss affordances (X, Escape) are inert until the
 * user authenticates. Most of these specs run UNAUTHENTICATED so
 * they can exercise the overlay directly. The "auth-then-overlay-
 * closes" path uses mockAuth + reload to verify the unlock side. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  /* Block hero-card image fetches on the login visual side. */
  await page.route("https://api.scryfall.com/cards/named*", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from([]) })
  );
});

test("overlay is open by default and the app shell is hidden behind it", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#login-overlay")).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/auth-locked/);
  /* The .container holds the entire app — it's hidden via the
   * html.auth-locked rule in components.css (boot-theme.js applies
   * the class synchronously when no session hint is set). */
  await expect(page.locator(".container")).toBeHidden();
});

test("close button is hidden while auth-locked (no way out without authenticating)", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#login-close")).toBeHidden();
});

test("Escape key does NOT close the overlay while auth-locked", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#login-overlay")).toBeVisible();
  await page.keyboard.press("Escape");
  /* Still visible — Escape is intercepted by the auth-locked guard. */
  await expect(page.locator("#login-overlay")).toBeVisible();
});

test("email field is focused once the overlay finishes laying out", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#login-email")).toBeFocused();
});

test("password show/hide toggle flips the input type", async ({ page }) => {
  await page.goto("/index.html");
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

test(".pwd-toggle hit target stretches the full input height in both themes", async ({ page }) => {
  /* Regression for the old `padding: 4px 8px` + `translateY(-50%)`
   * chip — its ~44×19 click zone forced a centered click. Stretching
   * top/bottom: 2px gives a ~36 px tall target and pushes the
   * sensitive area to the input's right edge.
   *
   * Verified in BOTH themes so a future editorial-only override
   * that shrinks the toggle back to a chip wouldn't slip past
   * studio's test coverage. */
  await page.goto("/index.html");
  const toggle = page.locator("#login-pwd-toggle");
  const pwd = page.locator("#login-pwd");

  for (const theme of ["studio", "editorial"]) {
    await page.evaluate((t) => {
      document.documentElement.setAttribute("data-direction", t);
    }, theme);
    const box = await toggle.boundingBox();
    /* Minimum touch target on web is ~24 px (Material). Anything
     * below and we're back to the chip. */
    expect(box.height, `hit-target height in ${theme}`).toBeGreaterThanOrEqual(24);
    /* Click 2 px from the top edge — used to miss the chip entirely. */
    const startType = await pwd.getAttribute("type");
    await page.mouse.click(box.x + box.width / 2, box.y + 2);
    const flipped = startType === "password" ? "text" : "password";
    await expect(pwd).toHaveAttribute("type", flipped);
  }
});

test("strength meter is hidden in signin mode + when password is empty in signup mode", async ({ page }) => {
  await page.goto("/index.html");
  const meter = page.locator("#login-form .pwd-meter");
  /* Signin mode by default — meter must stay hidden regardless of
   * whether the user typed something (we're authenticating against
   * an existing password, no point rating it). */
  await page.locator("#login-pwd").fill("anything");
  await expect(meter).toBeHidden();
  /* Switch to signup; empty password still keeps the meter hidden. */
  await page.locator("#login-pwd").fill("");
  await page.click("#login-mode-toggle");
  await expect(meter).toBeHidden();
});

test("strength meter activates on signup with weak password (score 0 + non-blocking note)", async ({ page }) => {
  await page.goto("/index.html");
  await page.click("#login-mode-toggle");
  const meter = page.locator("#login-form .pwd-meter");
  await page.locator("#login-pwd").fill("password");
  await expect(meter).toBeVisible();
  await expect(meter).toHaveAttribute("data-score", "0");
  await expect(meter.locator(".pwd-meter-note")).toBeVisible();
  /* Stronger password drops the disclaimer. */
  await page.locator("#login-pwd").fill("MyD3ckRulez!");
  await expect(meter).not.toHaveAttribute("data-score", "0");
  await expect(meter.locator(".pwd-meter-note")).toBeHidden();
});

test("switching from signup → signin hides the meter even with input present", async ({ page }) => {
  await page.goto("/index.html");
  await page.click("#login-mode-toggle"); // signup
  await page.locator("#login-pwd").fill("anyweakpwd");
  const meter = page.locator("#login-form .pwd-meter");
  await expect(meter).toBeVisible();
  await page.click("#login-mode-toggle"); // back to signin
  await expect(meter).toBeHidden();
});

test("mode toggle swaps the title, submit label, and password autocomplete", async ({ page }) => {
  await page.goto("/index.html");

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

test("submitting with empty email surfaces an inline error, doesn't crash", async ({ page }) => {
  await page.goto("/index.html");
  /* Form is novalidate so the browser doesn't pre-empt the submit;
   * our controller has to catch the empty-field case itself. */
  await page.click("#login-submit");
  await expect(page.locator("#login-error")).toBeVisible();
});

test("empty form submit: error names BOTH missing fields and both get the invalid border", async ({ page }) => {
  await page.goto("/index.html");
  await page.click("#login-submit");
  await expect(page.locator("#login-error")).toHaveText("Renseigne ton email et ton mot de passe.");
  await expect(page.locator("#login-email")).toHaveClass(/is-invalid/);
  await expect(page.locator("#login-pwd")).toHaveClass(/is-invalid/);
});

test("missing email only: message is tailored and only email gets the invalid border", async ({ page }) => {
  await page.goto("/index.html");
  await page.fill("#login-pwd", "secret123");
  await page.click("#login-submit");
  await expect(page.locator("#login-error")).toHaveText("Renseigne ton email.");
  await expect(page.locator("#login-email")).toHaveClass(/is-invalid/);
  await expect(page.locator("#login-pwd")).not.toHaveClass(/is-invalid/);
});

test("missing password only: message + invalid border only on password", async ({ page }) => {
  await page.goto("/index.html");
  await page.fill("#login-email", "a@b.com");
  await page.click("#login-submit");
  await expect(page.locator("#login-error")).toHaveText("Renseigne ton mot de passe.");
  await expect(page.locator("#login-email")).not.toHaveClass(/is-invalid/);
  await expect(page.locator("#login-pwd")).toHaveClass(/is-invalid/);
});

test("submitting a malformed email flags only the email field with the format message", async ({ page }) => {
  await page.goto("/index.html");
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
  await page.click("#login-mode-toggle"); // signup
  await page.fill("#login-email", "valid@example.com");
  await page.fill("#login-pwd", "alphabetsoup"); // 12 chars, no digit
  await page.click("#login-submit");
  await expect(page.locator("#login-pwd")).toHaveClass(/is-invalid/);
  await expect(page.locator("#login-email")).not.toHaveClass(/is-invalid/);
  await expect(page.locator("#login-error")).toContainText("Mot de passe");
  await expect(page.locator("#login-error")).toContainText("au moins 1 chiffre");
});

test("typing in an invalid field clears its red border live", async ({ page }) => {
  await page.goto("/index.html");
  await page.click("#login-submit");
  await expect(page.locator("#login-email")).toHaveClass(/is-invalid/);
  await page.locator("#login-email").type("a");
  await expect(page.locator("#login-email")).not.toHaveClass(/is-invalid/);
  /* The other field's flag stays until that field is engaged. */
  await expect(page.locator("#login-pwd")).toHaveClass(/is-invalid/);
});

test("sign-out wipes the local deck cache and re-locks the app shell", async ({ page }) => {
  /* Login-obligatoire security contract: a user A logging out on a
   * shared browser must NOT leave their decks in localStorage where
   * a subsequent user B could see them. signOut() in sync.js wipes
   * the user-decks key + the per-uid queue, then fans out the null
   * auth transition (in test mode) so the UI re-locks. */
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await expect(page.locator(".container")).toBeVisible();
  /* Verify the cache is populated before signing out. */
  const before = await page.evaluate(() => localStorage.getItem("mtg-hand-sim:user-decks-v1"));
  expect(before).toContain("Ukkima");
  /* Open the account menu, click Déconnexion. */
  await page.click("#btn-account");
  await page.click("#btn-account-signout");
  /* Shell re-locks, overlay reappears, deck cache cleared. */
  await expect(page.locator("html")).toHaveClass(/auth-locked/);
  await expect(page.locator("#login-overlay")).toBeVisible();
  const after = await page.evaluate(() => localStorage.getItem("mtg-hand-sim:user-decks-v1"));
  expect(after).toBe(null);
});

test("zero-flash F5 for signed-in users: shell visible from the FIRST paint, no transient auth-locked class", async ({ page }) => {
  /* The regression: an already-signed-in user pressing F5 used to
   * briefly see the login overlay until Firebase resolved persistence
   * (~50-200ms). Fix: boot-theme.js reads the `has-session-v1` hint
   * synchronously before <body> parses and skips `auth-locked` when
   * the hint is set. sync.js sets the hint on every authed callback.
   *
   * We assert two things: (1) on first paint, the html element does
   * NOT have auth-locked (mockAuth pre-sets the hint, same as a real
   * signed-in user's localStorage on F5); (2) the .container is
   * visible immediately, no waiting. */
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  /* Inspect FIRST — no waitFor / no animations. The check is
   * synchronous from Playwright's perspective. */
  const initialClass = await page.locator("html").getAttribute("class");
  expect(initialClass || "").not.toMatch(/auth-locked/);
  await expect(page.locator(".container")).toBeVisible();
  await expect(page.locator("#login-overlay")).toBeHidden();
});

test("first-ever visit (no session hint): auth-locked applied synchronously, overlay visible from boot", async ({ page }) => {
  /* The other half of the contract — without a hint, boot-theme.js
   * MUST add auth-locked synchronously, otherwise an anon user would
   * briefly see the app shell. */
  await page.goto("/index.html");
  const initialClass = await page.locator("html").getAttribute("class");
  expect(initialClass || "").toMatch(/auth-locked/);
  await expect(page.locator(".container")).toBeHidden();
  await expect(page.locator("#login-overlay")).toBeVisible();
});

test("authenticated boot: shell is visible, overlay hidden, account button shows the user", async ({ page }) => {
  /* This is the post-auth half of the lifecycle. mockAuth primes the
   * sync.js test seam so the boot acts as if Firebase resolved an
   * already-signed-in user. */
  await mockAuth(page, {
    uid: "test-uid",
    email: "alice@example.com",
    displayName: "Alice",
    photoURL: null,
  });
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await expect(page.locator("#login-overlay")).toBeHidden();
  await expect(page.locator("html")).not.toHaveClass(/auth-locked/);
  await expect(page.locator(".container")).toBeVisible();
  await expect(page.locator("#btn-account")).toContainText("Alice");
});
