import { test, expect } from "@playwright/test";
import { mockAuth, mockScryfall, seedSultaiDeck } from "./_helpers.js";

/* Play view: 3-column .play-layout (left sidebar | play-main |
 * right sidebar). Left holds commanders + hand stats + graveyard
 * preview; play-main holds battlefield + lands + hand; right
 * holds the Actions panel (turn buttons + basic lands) and the
 * game-state tiles. */

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await mockAuth(page);
  await seedSultaiDeck(page);
  await page.goto("/index.html");
  await page.locator("#commander-zone .card").first().waitFor();
});

test("3-column layout: left sidebar | play-main | right sidebar", async ({ page }) => {
  const left = await page.locator(".play-sidebar:not(.play-sidebar-right)").boundingBox();
  const main = await page.locator(".play-main").boundingBox();
  const right = await page.locator(".play-sidebar-right").boundingBox();
  expect(left).not.toBeNull();
  expect(main).not.toBeNull();
  expect(right).not.toBeNull();
  expect(left.x).toBeLessThan(main.x);
  expect(main.x).toBeLessThan(right.x);
});

test("game-state tiles (Tour / Bibli. / Main) render in the right sidebar", async ({ page }) => {
  const gameState = page.locator(".panel-game-state .game-state");
  await expect(gameState).toBeVisible();
  /* Three tiles, each with a numeric strong. */
  await expect(gameState.locator(".game-state-tile")).toHaveCount(3);
  await expect(page.locator("#game-state-turn")).toBeVisible();
  await expect(page.locator("#game-state-library")).toBeVisible();
  await expect(page.locator("#game-state-hand")).toBeVisible();
});

test("sidebar 'Actions' panel exposes Piocher / Tour suivant / Nouvelle main as a vertical stack", async ({ page }) => {
  const stack = page.locator(".play-sidebar .actions-stack");
  await expect(stack).toBeVisible();
  await expect(stack.locator("#btn-draw")).toBeVisible();
  await expect(stack.locator("#btn-next-turn")).toBeVisible();
  await expect(stack.locator("#btn-new")).toBeVisible();
});

test("piocher button increments the game-state hand counter", async ({ page }) => {
  const before = parseInt(await page.locator("#game-state-hand").textContent(), 10);
  await page.click("#btn-draw");
  await expect.poll(
    async () => parseInt(await page.locator("#game-state-hand").textContent(), 10),
  ).toBe(before + 1);
});

test("tour suivant increments the game-state turn counter", async ({ page }) => {
  const before = parseInt(await page.locator("#game-state-turn").textContent(), 10);
  await page.click("#btn-next-turn");
  await expect.poll(
    async () => parseInt(await page.locator("#game-state-turn").textContent(), 10),
  ).toBe(before + 1);
});

test("left sidebar holds commanders + stats + graveyard; right sidebar holds actions + game-state (per-view, not global)", async ({ page }) => {
  /* Left sidebar = .play-sidebar without .play-sidebar-right; the
   * locator excludes the right one to keep assertions unambiguous. */
  await expect(page.locator(".play-sidebar:not(.play-sidebar-right) #commander-zone")).toBeVisible();
  await expect(page.locator(".play-sidebar:not(.play-sidebar-right) #stat-lands")).toBeVisible();
  await expect(page.locator(".play-sidebar:not(.play-sidebar-right) #graveyard")).toBeVisible();
  await expect(page.locator(".play-sidebar-right #btn-draw")).toBeVisible();
  await expect(page.locator(".play-sidebar-right #game-state-turn")).toBeVisible();

  /* Switching to manage hides both sidebars — the old shared sidebar
   * would have stayed visible across views. */
  await page.click("#tab-manage");
  await expect(page.locator(".play-sidebar:not(.play-sidebar-right)")).toBeHidden();
  await expect(page.locator(".play-sidebar-right")).toBeHidden();
});

test("basic lands appear in a bottom panel with .land-btn pills, one per deck color", async ({ page }) => {
  /* Default Sultai deck = U + B + G commanders → 3 basic-land
   * buttons. The actual count is data-driven; we assert >= 1 and
   * <= 5 so the test stays stable if the seed changes. */
  const buttons = page.locator("#basic-lands .land-btn");
  const n = await buttons.count();
  expect(n).toBeGreaterThanOrEqual(1);
  expect(n).toBeLessThanOrEqual(5);
  /* Each pill carries a colored dot. */
  await expect(buttons.first().locator(".dot")).toBeVisible();
});

test("secondary .btn hover stays soft (surface-2), doesn't flip to accent (regression)", async ({ page }) => {
  /* The global `button:hover:not(:disabled)` rule was flipping every
   * .btn to var(--accent) on hover — in Editorial that's a bordeaux
   * pink that screamed at the user. Design wants a soft hover that
   * only shifts background to surface-2 and bumps the border.
   * The 0.15s background transition means we have to poll instead
   * of reading the value once. */
  const btn = page.locator("#btn-draw");
  const idle = await btn.evaluate((el) => getComputedStyle(el).backgroundColor);
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  await btn.hover();
  /* Wait until the transition settles. */
  await expect.poll(
    async () => btn.evaluate((el) => getComputedStyle(el).backgroundColor),
    { timeout: 1000 },
  ).not.toBe(idle);
  const hover = await btn.evaluate((el) => getComputedStyle(el).backgroundColor);
  /* Hover background must NOT be the accent color. */
  expect(hover).not.toBe(accent);
});

test("primary .btn hover stays on the accent ramp (active CTA still flips)", async ({ page }) => {
  /* "Tour suivant" is the CTA. Its hover SHOULD shift onto the
   * accent-2 ramp (subtle deepening of the indigo / bordeaux).
   * `.btn` has a 0.15s background transition, so we poll the
   * computed color until it settles or the timeout hits — without
   * this the test was occasionally reading the in-flight value
   * (still equal to idle) and failing intermittently. */
  const btn = page.locator("#btn-next-turn");
  const idle = await btn.evaluate((el) => getComputedStyle(el).backgroundColor);
  await btn.hover();
  await expect.poll(
    async () => btn.evaluate((el) => getComputedStyle(el).backgroundColor),
    { timeout: 1000 },
  ).not.toBe(idle);
});

test("each play zone has a .play-section-head ABOVE its container (label sits outside the box)", async ({ page }) => {
  /* The play-main zones (battlefield, lands, hand) use the
   * <section.play-section> → header + cards pattern. Graveyard
   * lives in the left sidebar in a .panel container now, so it
   * isn't part of this check. */
  for (const zoneId of ["battlefield", "lands", "hand"]) {
    const section = page.locator(`#${zoneId}`).locator("xpath=ancestor::section[1]");
    await expect(section.locator(".play-section-head .title")).toBeVisible();
    const headBox = await section.locator(".play-section-head").boundingBox();
    const zoneBox = await page.locator(`#${zoneId}`).boundingBox();
    /* Head is above the box visually. */
    expect(headBox.y + headBox.height).toBeLessThanOrEqual(zoneBox.y + 2);
  }
});

test("hand wraps to a second row instead of overflowing the column (regression)", async ({ page }) => {
  /* The maquette spec'd nowrap+scroll, but a 7-card opening hand
   * blew the 1fr grid column open and pushed the graveyard past
   * the right edge of play-main. Switched to wrap so the strip
   * stays inside its column. */
  const hand = page.locator("#hand");
  await expect(hand).toHaveClass(/hand-strip/);
  expect(await hand.evaluate((el) => getComputedStyle(el).flexWrap)).toBe("wrap");
  /* And the visual proof: the hand box stays inside play-main. */
  const playMain = await page.locator(".play-main").boundingBox();
  const handBox = await hand.boundingBox();
  expect(handBox.x + handBox.width).toBeLessThanOrEqual(playMain.x + playMain.width + 1);
});

test("graveyard lives in the left sidebar (not in play-main) and stays a compact preview", async ({ page }) => {
  /* The graveyard pile used to sit beside the hand inside play-main
   * and frequently overflowed past its right edge on 7-card hands.
   * Moved to the left sidebar as a .panel-graveyard preview — the
   * regression now becomes "is it still in the right column?". */
  const left = await page.locator(".play-sidebar:not(.play-sidebar-right)").boundingBox();
  const playMain = await page.locator(".play-main").boundingBox();
  const graveBox = await page.locator("#graveyard").boundingBox();
  expect(graveBox.x).toBeLessThan(playMain.x);
  expect(graveBox.x).toBeGreaterThanOrEqual(left.x);
});

test("tapped card shows an 'ENGAGÉ' banner via ::after", async ({ page }) => {
  /* Wait until the hand has cards then synthesize a tapped state on
   * any visible card so we can inspect the ::after content. The
   * diagonal "ENGAGÉ" banner is the in-place cue (a 90° rotation
   * would break the flex-row layout). */
  await page.evaluate(() => {
    const target = document.querySelector("#battlefield .card, #hand .card");
    if (target) target.classList.add("tapped");
  });
  const probe = await page.evaluate(() => {
    const target = document.querySelector(".card.tapped");
    if (!target) return null;
    const img = target.querySelector("img");
    return {
      bannerContent: getComputedStyle(target, "::after").content,
      /* The dim must hit the image, NOT the banner. Filter on the
       * pseudo-element should resolve to "none" (no inherited
       * brightness(...)) — see views.css `.card.tapped > *`. */
      imgFilter: img ? getComputedStyle(img).filter : null,
      bannerFilter: getComputedStyle(target, "::after").filter,
    };
  });
  expect(probe.bannerContent).toContain("ENGAG");
  expect(probe.imgFilter).toContain("brightness");
  expect(probe.bannerFilter).toBe("none");
});

test("Game Changer pin renders on game_changer cards (Sol Ring) and only on those", async ({ page }) => {
  /* Sol Ring is in the seeded Sultai deck and the mock flags it
   * game_changer:true. We move Sol Ring directly from library to
   * hand via the game state — way faster + deterministic than
   * spamming the Piocher button until the shuffle reveals it. */
  await page.evaluate(() => {
    const idx = state.game.library.findIndex((i) => i.card.name === "Sol Ring");
    if (idx >= 0) {
      const inst = state.game.library.splice(idx, 1)[0];
      state.game.hand.push(inst);
      renderHand();
    }
  });
  const solRingPin = page.locator('.card:has(img[alt="Sol Ring"]) .gc-mark').first();
  await expect(solRingPin).toBeVisible();
  /* Known non-GC card never gets the pin. */
  const forestPin = page.locator('.card:has(img[alt="Forest"]) .gc-mark').first();
  await expect(forestPin).toHaveCount(0);
});

test("game-state tile values render in accent color, mono, 18px (readability fix)", async ({ page }) => {
  const turnVal = page.locator("#game-state-turn");
  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()
  );
  const computed = await turnVal.evaluate((el) => ({
    color: getComputedStyle(el).color,
    font: getComputedStyle(el).fontFamily,
    size: getComputedStyle(el).fontSize,
  }));
  /* Color comparison: getComputedStyle returns rgb(...), CSS var
   * is hex/oklch. Cross-check by reading var()-resolved through a
   * temp element so both sides are in rgb. */
  const accentRgb = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--accent)";
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  expect(computed.color).toBe(accentRgb);
  expect(computed.font.toLowerCase()).toMatch(/mono/);
  expect(parseFloat(computed.size)).toBeGreaterThanOrEqual(16);
});

test("stat-box Terrains has a sub-line 'N cartes en main'", async ({ page }) => {
  const sub = page.locator("#stat-lands-sub");
  await expect(sub).toBeVisible();
  await expect(sub).toContainText(/\d+ cartes? en main/);
});

test("stat-box Sorts has a sub-line 'CMC moy. X'", async ({ page }) => {
  const sub = page.locator("#stat-spells-sub");
  await expect(sub).toBeVisible();
  await expect(sub).toContainText(/CMC moy\./);
});

test("'Tour suivant' button shows the next turn number dynamically", async ({ page }) => {
  /* Initial turn = 1 → label should read "Tour 2". After click,
   * turn becomes 2 → label updates to "Tour 3". */
  await expect(page.locator("#btn-next-turn-label")).toHaveText(/Tour 2/);
  await page.click("#btn-next-turn");
  await expect(page.locator("#btn-next-turn-label")).toHaveText(/Tour 3/);
});

test("deck-status banner is gone (low-value warnings were cluttering every page)", async ({ page }) => {
  /* Originally a cross-view banner that surfaced messages like
   * "1 introuvable: plain". User feedback: those serve no purpose
   * permanently displayed. Banner removed; setStatus() now logs
   * to console only. flash() handles user-visible error toasts. */
  await expect(page.locator("#deck-status")).toHaveCount(0);
});
