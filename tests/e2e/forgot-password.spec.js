import { test, expect } from "@playwright/test";

/* Forgot-password flow. Two parts share the same overlay:
 *
 *   1. Request reset: user clicks "Mot de passe oublié ?" on the
 *      signin form → the form mutates to ask for an email → submit →
 *      neutral success card ("vérifie ta boîte").
 *
 *   2. Complete reset: user lands back on the app via the email link
 *      (?mode=resetPassword&oobCode=…) → reset-complete form opens
 *      with verified email + new-password + confirm fields → submit →
 *      back to signin with a one-shot success banner.
 *
 * We never hit real Firebase. The three façade methods on window.sync
 * (sendPasswordReset / verifyPasswordResetCode / confirmPasswordReset)
 * are stubbed via addInitScript. Stub tells the test what the UI sent
 * by writing to test-only globals (window.__sentResetEmail etc.). */

/* Patch window.sync's reset methods so we never touch Firebase. The
 * polling pattern is necessary because sync.js is an ES module — it
 * defines window.sync AFTER our addInitScript runs. */
async function mockResetMethods(page, opts = {}) {
  await page.addInitScript((options) => {
    const watcher = setInterval(() => {
      if (!window.sync) return;
      clearInterval(watcher);
      window.sync.sendPasswordReset = async (email) => {
        window.__sentResetEmail = email;
        if (options.requestError) {
          const err = new Error("mock");
          err.code = options.requestError;
          throw err;
        }
      };
      window.sync.verifyPasswordResetCode = async (code) => {
        window.__verifiedCode = code;
        if (options.verifyError) {
          const err = new Error("mock");
          err.code = options.verifyError;
          throw err;
        }
        return options.verifiedEmail || "test@example.com";
      };
      window.sync.confirmPasswordReset = async (code, pwd) => {
        window.__confirmedCode = code;
        window.__confirmedPwd = pwd;
        if (options.confirmError) {
          const err = new Error("mock");
          err.code = options.confirmError;
          throw err;
        }
      };
    }, 5);
    /* Safety net: stop polling after 5s even if sync never appears.
     * If sync.js fails to load, the test will fail on the missing UI
     * anyway. */
    setTimeout(() => clearInterval(watcher), 5000);
  }, opts);
}

test.describe("Forgot-password — request reset", () => {
  test.beforeEach(async ({ page }) => {
    await mockResetMethods(page);
    await page.goto("/index.html");
    await expect(page.locator("#login-overlay")).toBeVisible();
  });

  test("clicking 'Mot de passe oublié ?' switches the form to reset-request mode", async ({ page }) => {
    await page.click("#login-forgot");
    /* Title + submit copy change; password field, Google button,
     * divider and remember-me row disappear. */
    await expect(page.locator("#login-title")).toHaveText("Mot de passe oublié");
    await expect(page.locator("#login-submit-label")).toHaveText("Envoyer le lien");
    await expect(page.locator("#login-pwd-field")).toBeHidden();
    await expect(page.locator("#login-google")).toBeHidden();
    await expect(page.locator("#login-divider")).toBeHidden();
    await expect(page.locator("#login-signin-only")).toBeHidden();
    /* Email field stays visible and focused. */
    await expect(page.locator("#login-email")).toBeVisible();
  });

  test("'Retour à la connexion' link in foot returns to signin mode", async ({ page }) => {
    await page.click("#login-forgot");
    await expect(page.locator("#login-title")).toHaveText("Mot de passe oublié");
    await page.click("#login-mode-toggle");
    await expect(page.locator("#login-title")).toHaveText("Connexion");
    await expect(page.locator("#login-pwd-field")).toBeVisible();
  });

  test("submitting an empty email surfaces an inline error, no façade call", async ({ page }) => {
    await page.click("#login-forgot");
    await page.click("#login-submit");
    await expect(page.locator("#login-error")).toHaveText("Renseigne ton email.");
    /* The façade method was NOT called. */
    const sent = await page.evaluate(() => window.__sentResetEmail);
    expect(sent).toBeUndefined();
  });

  test("submitting an invalid email format surfaces inline error, no façade call", async ({ page }) => {
    await page.click("#login-forgot");
    await page.locator("#login-email").fill("not-an-email");
    await page.click("#login-submit");
    await expect(page.locator("#login-error")).toContainText("Format d'email invalide");
    const sent = await page.evaluate(() => window.__sentResetEmail);
    expect(sent).toBeUndefined();
  });

  test("submitting a valid email calls sendPasswordReset + shows neutral success card", async ({ page }) => {
    await page.click("#login-forgot");
    await page.locator("#login-email").fill("matt@example.com");
    await page.click("#login-submit");
    /* Success card replaces the form. */
    await expect(page.locator("#login-reset-success")).toBeVisible();
    await expect(page.locator("#login-form")).toBeHidden();
    /* Neutral wording — anti-enumeration. */
    await expect(page.locator("#login-reset-success")).toContainText("Si un compte existe");
    /* Façade got the email. */
    const sent = await page.evaluate(() => window.__sentResetEmail);
    expect(sent).toBe("matt@example.com");
  });

  test("'Retour à la connexion' button in success card returns to signin", async ({ page }) => {
    await page.click("#login-forgot");
    await page.locator("#login-email").fill("matt@example.com");
    await page.click("#login-submit");
    await expect(page.locator("#login-reset-success")).toBeVisible();
    await page.click("#login-reset-back");
    await expect(page.locator("#login-form")).toBeVisible();
    await expect(page.locator("#login-title")).toHaveText("Connexion");
    /* The email field is reset so the next user doesn't see stale input. */
    await expect(page.locator("#login-email")).toHaveValue("");
  });

  test("rate-limit error from Firebase surfaces in the inline error box", async ({ page }) => {
    await page.evaluate(() => {
      window.sync.sendPasswordReset = async () => {
        const err = new Error("rate");
        err.code = "auth/too-many-requests";
        throw err;
      };
    });
    await page.click("#login-forgot");
    await page.locator("#login-email").fill("matt@example.com");
    await page.click("#login-submit");
    await expect(page.locator("#login-error")).toContainText("Trop d'essais");
    /* Form stays visible — the user can retry later. */
    await expect(page.locator("#login-form")).toBeVisible();
    await expect(page.locator("#login-reset-success")).toBeHidden();
  });
});

test.describe("Forgot-password — complete reset", () => {
  test.beforeEach(async ({ page }) => {
    await mockResetMethods(page, { verifiedEmail: "matt@example.com" });
  });

  test("landing with ?mode=resetPassword&oobCode opens the complete-reset form", async ({ page }) => {
    await page.goto("/index.html?mode=resetPassword&oobCode=test-code-123");
    await expect(page.locator("#login-reset-complete-form")).toBeVisible();
    /* Default forms are hidden when complete-reset is showing. */
    await expect(page.locator("#login-form")).toBeHidden();
    /* The verified email surfaces in the form. */
    await expect(page.locator("#login-reset-email-target")).toHaveText("matt@example.com");
    /* URL params are stripped so reload doesn't re-trigger with the
     * consumed code. */
    const url = page.url();
    expect(url).not.toContain("oobCode");
    expect(url).not.toContain("mode=resetPassword");
  });

  test("invalid oobCode falls back to signin with an explanation", async ({ page }) => {
    await mockResetMethods(page, { verifyError: "auth/invalid-action-code" });
    await page.goto("/index.html?mode=resetPassword&oobCode=bad");
    await expect(page.locator("#login-form")).toBeVisible();
    await expect(page.locator("#login-error")).toContainText("invalide");
  });

  test("submitting mismatched passwords surfaces inline mismatch error", async ({ page }) => {
    await page.goto("/index.html?mode=resetPassword&oobCode=test-code");
    await expect(page.locator("#login-reset-complete-form")).toBeVisible();
    await page.locator("#login-reset-new").fill("Strong123!");
    await page.locator("#login-reset-confirm").fill("Strong123?");
    await page.click("#login-reset-complete-submit");
    await expect(page.locator("#login-reset-complete-error")).toContainText("ne correspondent pas");
    /* Façade was NOT called. */
    const confirmed = await page.evaluate(() => window.__confirmedPwd);
    expect(confirmed).toBeUndefined();
  });

  test("submitting a weak new password surfaces inline strength error", async ({ page }) => {
    await page.goto("/index.html?mode=resetPassword&oobCode=test-code");
    await expect(page.locator("#login-reset-complete-form")).toBeVisible();
    await page.locator("#login-reset-new").fill("short");
    await page.locator("#login-reset-confirm").fill("short");
    await page.click("#login-reset-complete-submit");
    await expect(page.locator("#login-reset-complete-error")).toContainText("Minimum 8");
  });

  test("valid submit calls confirmPasswordReset + routes to signin with a success banner", async ({ page }) => {
    await page.goto("/index.html?mode=resetPassword&oobCode=test-code");
    await expect(page.locator("#login-reset-complete-form")).toBeVisible();
    await page.locator("#login-reset-new").fill("MyNewPwd123!");
    await page.locator("#login-reset-confirm").fill("MyNewPwd123!");
    await page.click("#login-reset-complete-submit");
    /* The reset-complete form goes away, signin form appears with the
     * one-shot success message. */
    await expect(page.locator("#login-reset-complete-form")).toBeHidden();
    await expect(page.locator("#login-form")).toBeVisible();
    await expect(page.locator("#login-title")).toHaveText("Connexion");
    await expect(page.locator("#login-error")).toBeVisible();
    await expect(page.locator("#login-error")).toContainText("Mot de passe réinitialisé");
    await expect(page.locator("#login-error")).toHaveClass(/login-success/);
    /* Façade was called with the entered password. */
    const confirmedPwd = await page.evaluate(() => window.__confirmedPwd);
    expect(confirmedPwd).toBe("MyNewPwd123!");
    const confirmedCode = await page.evaluate(() => window.__confirmedCode);
    expect(confirmedCode).toBe("test-code");
  });

  test("Firebase reject (expired code) on submit surfaces inline error, keeps form open", async ({ page }) => {
    await page.goto("/index.html?mode=resetPassword&oobCode=test-code");
    await expect(page.locator("#login-reset-complete-form")).toBeVisible();
    await page.evaluate(() => {
      window.sync.confirmPasswordReset = async () => {
        const err = new Error("expired");
        err.code = "auth/expired-action-code";
        throw err;
      };
    });
    await page.locator("#login-reset-new").fill("MyNewPwd123!");
    await page.locator("#login-reset-confirm").fill("MyNewPwd123!");
    await page.click("#login-reset-complete-submit");
    await expect(page.locator("#login-reset-complete-error")).toContainText("expiré");
    /* Form stays open so the user sees the message. */
    await expect(page.locator("#login-reset-complete-form")).toBeVisible();
  });
});
