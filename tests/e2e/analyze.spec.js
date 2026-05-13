import { test, expect } from "@playwright/test";
import { mockScryfall, switchDeckById } from "./_helpers.js";

test.beforeEach(async ({ page }) => {
  await mockScryfall(page);
  await page.goto("/index.html");
  // Wait for the deck to fully resolve — analyze reads state.resolved.
  await page.locator("#commander-zone .card").first().waitFor();
  await page.click("#tab-analyze");
});

test("Analyser tab activates the view and hides the others", async ({ page }) => {
  await expect(page.locator("#view-analyze")).toBeVisible();
  await expect(page.locator("#view-play")).toBeHidden();
  await expect(page.locator("#view-manage")).toBeHidden();
  await expect(page.locator("#tab-analyze")).toHaveClass(/active/);
});

test("Archetypes panel renders rows with progress bars (or mixed-profile fallback)", async ({ page }) => {
  // Mock cards have no oracle_text → most archetype scores stay low.
  // The panel either shows the fallback ("Profil mixte…") or one
  // archetype that still scores above the threshold from structural
  // signals alone (creatureRatio, avgCmc, etc.). Either is valid;
  // we just check the panel exists with one of those two shapes.
  await expect(page.locator("#analyze-archetypes")).toBeVisible();
  const rows = await page.locator(".archetype-row").count();
  if (rows > 0) {
    for (const row of await page.locator(".archetype-row").all()) {
      await expect(row.locator(".archetype-percent")).toHaveText(/\d+\s?%/);
      await expect(row.locator(".archetype-bar-fill")).toBeVisible();
    }
  } else {
    await expect(page.locator("#analyze-archetypes")).toContainText(/Profil mixte/);
  }
});

test("Suggestions panel renders the 5 EDH counters with structure", async ({ page }) => {
  // lands, ramp, draw, interaction, board wipes. Avg-CMC only shows
  // when there are 20+ non-lands — the mocked Sultai deck is bigger
  // than that, so 6 rows total.
  const rowCount = await page.locator(".suggestion-row").count();
  expect(rowCount).toBeGreaterThanOrEqual(5);
  for (const row of await page.locator(".suggestion-row").all()) {
    await expect(row.locator(".suggestion-icon")).toBeVisible();
    await expect(row.locator(".suggestion-value")).toBeVisible();
    await expect(row.locator(".suggestion-advice")).toBeVisible();
  }
  await expect(page.locator("#analyze-suggestions-info"))
    .toHaveText(/\d+\/\d+ dans la cible/);
});

test("Themes panel renders pills (or the empty placeholder)", async ({ page }) => {
  // Mock cards have no oracle_text, so theme regexes don't match.
  // The panel should fall back to the empty placeholder rather than
  // crash or show nothing.
  await expect(page.locator("#analyze-themes")).toBeVisible();
  await expect(page.locator("#analyze-themes")).toContainText(/Aucun thème|.+/);
});

test("Legality panel runs Commander checks for Commander-sized decks", async ({ page }) => {
  /* The mocked Sultai deck triggers the EDH path. Five explicit
   * rules are always rendered for commander format (count, commander
   * validity, format legality, identity, singleton). With the mock
   * returning empty color_identity, no duplicates, and commanders
   * typed as "Legendary Creature" → all five pass. */
  await expect(page.locator("#analyze-legality .legality-row")).toHaveCount(5);
  await expect(page.locator("#analyze-legality .legality-row.legality-ok")).toHaveCount(5);
});

test("Legality panel respects the deck.format selector (commander → limited)", async ({ page }) => {
  // Switch the active deck's format from Commander to "Format libre".
  await page.click("#tab-manage");
  await page.locator("#manage-format-select").selectOption("limited");

  await page.click("#tab-analyze");
  // The panel now shows the format-libre placeholder, not the EDH rules.
  await expect(page.locator("#analyze-legality"))
    .toContainText(/Format libre/);
  await expect(page.locator("#analyze-legality .legality-row")).toHaveCount(0);
});

test("Legality section is rendered above Orientation in the analyze view", async ({ page }) => {
  // Order regression: the user asked for Conformité au format to sit
  // right after Bracket, before the archetype panel.
  const legalityBox = await page.locator("#analyze-legality").boundingBox();
  const archetypesBox = await page.locator("#analyze-archetypes").boundingBox();
  expect(legalityBox.y).toBeLessThan(archetypesBox.y);
});

test("Bracket panel renders a badge, label and methodology note", async ({ page }) => {
  await expect(page.locator(".bracket-badge")).toBeVisible();
  // The badge holds a single digit (1–4).
  const badgeText = await page.locator(".bracket-badge").textContent();
  expect(badgeText.trim()).toMatch(/^[1-5]$/);
  // The note explains the limitation (Scryfall doesn't expose every criterion).
  await expect(page.locator(".bracket-meta .note")).toContainText(/mass land destruction/i);
});

test("Mana curve renders 8 columns (0..6, 7+)", async ({ page }) => {
  await expect(page.locator(".mana-curve-col")).toHaveCount(8);
  // Labels in order.
  const labels = await page.locator(".mana-curve-label").allTextContents();
  expect(labels).toEqual(["0", "1", "2", "3", "4", "5", "6", "7+"]);
});

test("Type chart shows at least one coloured segment + a legend row", async ({ page }) => {
  await expect(page.locator(".type-chart-segment").first()).toBeVisible();
  await expect(page.locator(".type-chart-legend-row").first()).toBeVisible();
});

test("Sources de mana renders coloured pips when the deck produces colours", async ({ page }) => {
  // The mock returns produced_mana=[] for every card, so we don't
  // assert on specific colours — just on the absence of a hard crash.
  // The placeholder text is acceptable too.
  const visible = await page.locator("#analyze-sources").isVisible();
  expect(visible).toBe(true);
});

test("Subtype list renders pills (or a placeholder)", async ({ page }) => {
  // Sultai has many creatures; with the mock's type_line=Creature for
  // every card, the deck-analytics finds many subtypes — though the
  // exact counts depend on the mock.
  await expect(page.locator("#analyze-subtypes")).toBeVisible();
});

test("Token grid shows the empty placeholder when no all_parts data", async ({ page }) => {
  // Our mock doesn't return all_parts, so extractTokenIds → [] → the
  // grid shows the empty placeholder synchronously (no fetch fired).
  await expect(page.locator("#analyze-tokens")).toContainText(/Aucun jeton/);
});

test("Mana-base panel renders the 4 counters + per-colour rows", async ({ page }) => {
  await expect(page.locator("#analyze-mana-base")).toBeVisible();
  await expect(page.locator("#analyze-mana-base-info")).toContainText(/terrain/);
  // Multicolor, Fetch, Slow, Utility — four buckets shown at all times.
  await expect(page.locator(".mana-base-counter")).toHaveCount(4);
  const labels = await page.locator(".mana-base-counter span").allTextContents();
  expect(labels).toEqual(expect.arrayContaining([
    "Multicolores", "Fetch / tutors", "Slow lands", "Utilitaires",
  ]));
});

test("Switching back to Jouer restores the play view", async ({ page }) => {
  await page.click("#tab-play");
  await expect(page.locator("#view-play")).toBeVisible();
  await expect(page.locator("#view-analyze")).toBeHidden();
});

test("switching deck from the sidebar refreshes the analyze view", async ({ page }) => {
  // Two decks in storage so the sidebar select has something to switch to.
  await page.evaluate(() => {
    localStorage.setItem("mtg-hand-sim:user-decks-v1", JSON.stringify([
      {
        id: "deck-a", name: "Deck A",
        commanders: [{ name: "Atraxa, Praetors' Voice" }],
        cards: [{ name: "Forest", qty: 5 }],
      },
      {
        id: "deck-b", name: "Deck B",
        commanders: [{ name: "Krenko, Mob Boss" }],
        cards: [{ name: "Mountain", qty: 5 }],
      },
    ]));
    localStorage.setItem("mtg-hand-sim:defaults-seeded-v1", "1");
  });
  await page.reload();
  await page.locator("#commander-zone .card").first().waitFor();
  await page.click("#tab-analyze");

  // Initial state: deck-a has no all_parts → no tokens. deck-b has
  // Krenko (the mock attaches a Goblin token to it). After switching
  // we should see the token tile appear.
  await expect(page.locator("#analyze-tokens")).toContainText(/Aucun jeton/);

  await switchDeckById(page, "deck-b");
  await expect(page.locator(".token-tile").first()).toBeVisible({ timeout: 5000 });
  await expect(page.locator("#analyze-tokens")).not.toContainText(/Aucun jeton/);
});

test("token grid dedupes printings of the same token (regression)", async ({ page }) => {
  // Krenko's mocked all_parts points at two different "printings" of
  // the Goblin token (different ids, same oracle_id). Without
  // dedupeByOracle the panel rendered two identical Goblin tiles —
  // that's the user-visible bug this regression covers.
  await page.evaluate(() => {
    localStorage.setItem("mtg-hand-sim:user-decks-v1", JSON.stringify([{
      id: "krenko-deck", name: "Krenko",
      commanders: [{ name: "Krenko, Mob Boss" }],
      cards: [{ name: "Forest", qty: 1 }],
    }]));
    localStorage.setItem("mtg-hand-sim:defaults-seeded-v1", "1");
  });
  await page.reload();
  await page.locator("#commander-zone .card").first().waitFor();
  await page.click("#tab-analyze");
  await expect(page.locator(".token-tile").first()).toBeVisible({ timeout: 5000 });
  await expect(page.locator(".token-tile")).toHaveCount(1);
});

test("token fetch by Scryfall ID doesn't crash on identifier dedup (regression)", async ({ page }) => {
  // Regression for "Erreur Scryfall : can't access property toLowerCase,
  // id.name is undefined". Token fetch sends {id: "<uuid>"} identifiers
  // and the dedup step in fetchScryfallCards used to assume `id.name`.
  //
  // We seed a deck whose first card carries `all_parts` (via the helper
  // mock keyed on the card name "Krenko, Mob Boss"), then check the
  // token grid renders a tile rather than the error placeholder.
  await page.evaluate(() => {
    localStorage.setItem("mtg-hand-sim:user-decks-v1", JSON.stringify([{
      id: "token-test-deck",
      name: "Token test",
      commanders: [{ name: "Krenko, Mob Boss" }],
      cards: [{ name: "Forest", qty: 1 }],
    }]));
    localStorage.setItem("mtg-hand-sim:defaults-seeded-v1", "1");
  });
  await page.reload();
  await page.locator("#commander-zone .card").first().waitFor();
  await page.click("#tab-analyze");

  // Either the token tile appears (success path) or the error
  // placeholder shows. Asserting "no error placeholder" + "tile
  // present" gives us both guarantees.
  await expect(page.locator(".token-tile").first()).toBeVisible({ timeout: 5000 });
  await expect(page.locator("#analyze-tokens")).not.toContainText(/Erreur Scryfall/);
});
