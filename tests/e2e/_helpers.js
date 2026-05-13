/* Helpers shared by e2e specs.
 *
 * Network is the slowest, flakiest dependency in e2e. We intercept
 * every Scryfall request and return canned responses, so:
 *   - tests don't depend on the live API or rate limits;
 *   - we can simulate first-run / migration scenarios deterministically;
 *   - test runs stay sub-second once Chromium is warmed up.
 */

/* 1×1 transparent PNG for stubbed image responses. Smaller and faster
 * than letting the browser hit a fake URL and 404. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const fakeImageUris = (set, cn) => ({
  small: `https://test.scryfall.io/sm/${set}/${cn}.png`,
  normal: `https://test.scryfall.io/nm/${set}/${cn}.png`,
});

export async function mockScryfall(page) {
  await page.route("**/api.scryfall.com/**", async (route) => {
    const url = route.request().url();

    // POST /cards/collection — bulk metadata for a deck. Echo back a
    // minimal card per identifier so resolveDeck succeeds, with fake
    // image_uris so the manage view can render <img> thumbnails.
    if (url.includes("/cards/collection")) {
      const body = JSON.parse(route.request().postData() || "{}");
      // Real Scryfall returns unique (set, collector_number) per card.
      // We mimic that by deriving a stable cn from a hash of the
      // identifier — a per-batch counter (the previous approach) reset
      // to 1 on every chunked POST and produced cn collisions across
      // batches once a deck exceeded the 75-card batch size, silently
      // overwriting cache entries and breaking tryResolveSync.
      const hash = (s) => {
        let h = 0;
        for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
        return String(Math.abs(h) % 100000);
      };
      const data = (body.identifiers || []).map((id) => {
        // Token fetches use {id: "<uuid>"} identifiers. Echo them back
        // with both `id` (printing) and `oracle_id` (card identity).
        // The oracle_id is derived from the first 4 chars of the ID,
        // so two IDs sharing a prefix simulate "two printings of the
        // same token" — used to exercise dedupeByOracle in the tests.
        if (id.id) {
          const cn = hash(id.id);
          return {
            id: id.id,
            oracle_id: `oracle-${id.id.slice(0, 4)}`,
            name: `Token ${id.id.slice(0, 4)}`,
            set: "tk", collector_number: cn,
            type_line: "Token Creature — Goblin",
            cmc: 0,
            colors: [], produced_mana: [],
            image_uris: fakeImageUris("tk", cn),
          };
        }
        const set = id.set || "tst";
        const cn = id.collector_number || hash(id.name || JSON.stringify(id));
        // Basic-land identifiers come back typed as Land + producing
        // their canonical colour, so the analyze view's land-related
        // logic (groupings, mana base) has realistic data to chew on.
        const BASIC_LAND_COLOR = {
          Forest: "G", Island: "U", Swamp: "B", Mountain: "R", Plains: "W",
        };
        const isBasicLand = id.name && Object.hasOwn(BASIC_LAND_COLOR, id.name);
        // The Sultai seeded deck declares two commanders by name; mark
        // them legendary so the analyze view's commander-validity rule
        // doesn't flag them in the default e2e setup. Other cards get
        // a plain "Creature" type, which is realistic enough for the
        // analyze panels that don't care about legendary-ness.
        const SEEDED_COMMANDERS = new Map([
          ["Ukkima, Stalking Shadow", ["U", "B"]],
          ["Cazur, Ruthless Stalker", ["B", "G"]],
        ]);
        const isCommander = id.name && SEEDED_COMMANDERS.has(id.name);
        const colorIdentity = isCommander ? SEEDED_COMMANDERS.get(id.name) : [];
        const typeLine = isBasicLand
          ? `Basic Land — ${id.name}`
          : isCommander
            ? "Legendary Creature — Test"
            : "Creature";
        const producedMana = isBasicLand ? [BASIC_LAND_COLOR[id.name]] : [];
        // The card named "Krenko, Mob Boss" carries a fake `all_parts`
        // pointing to TWO different printings of the same token (same
        // `tokn` prefix → same oracle_id). This simulates the real-deck
        // scenario where two cards reference different printings of
        // the same token, and exercises the dedupeByOracle path.
        const all_parts = (id.name === "Krenko, Mob Boss") ? [
          {
            object: "related_card", component: "token",
            id: "tokn-1", name: "Goblin",
            type_line: "Token Creature — Goblin",
            uri: "https://api.scryfall.com/cards/tokn-1",
          },
          {
            object: "related_card", component: "token",
            id: "tokn-2", name: "Goblin",
            type_line: "Token Creature — Goblin",
            uri: "https://api.scryfall.com/cards/tokn-2",
          },
        ] : undefined;
        /* Flag a couple of well-known Game Changers from the seeded
         * Sultai deck so tests can assert the GC pin renders.
         * Sol Ring and Rhystic Study are on Scryfall's actual GC
         * list; using them keeps the mock realistic. */
        const GAME_CHANGERS = new Set(["Sol Ring", "Rhystic Study"]);
        const isGameChanger = id.name && GAME_CHANGERS.has(id.name);
        return {
          name: id.name || `Test Card ${cn}`,
          set, collector_number: cn,
          cmc: 1,
          type_line: typeLine,
          colors: [],
          color_identity: colorIdentity,
          produced_mana: producedMana,
          image_uris: fakeImageUris(set, cn),
          ...(isGameChanger ? { game_changer: true } : {}),
          ...(all_parts ? { all_parts } : {}),
        };
      });
      await route.fulfill({ json: { data, not_found: [] } });
      return;
    }

    // GET /cards/autocomplete — suggestion list.
    if (url.includes("/cards/autocomplete")) {
      const q = new URL(url).searchParams.get("q") || "";
      const data = q.toLowerCase().startsWith("sol")
        ? ["Sol Ring", "Sol", "Solar Tide"]
        : [];
      await route.fulfill({ json: { data } });
      return;
    }

    // GET /cards/search — two distinct shapes used by the app:
    //   1. printings list (printing picker) — query has `unique=prints`
    //   2. French-name lookup — query starts with `lang:fr (...)`
    if (url.includes("/cards/search")) {
      const decoded = decodeURIComponent(url);
      // French-name lookup: extract every !"Name" from the query and
      // echo back a fake French translation so the e2e can assert on
      // the visible UI text.
      if (decoded.includes("lang:fr")) {
        // Two shapes here:
        //   a) `lang:fr (!"X" or !"Y")` — exact-name translation
        //      lookup, used by translations.js. Echo a fake printed_name.
        //   b) `lang:fr name:term` — multilingual autocomplete (FR
        //      partial-name search). Match `term` against a small
        //      known FR→EN dictionary for the tests; unknown terms
        //      return an empty list (Scryfall behaviour for misses).
        const exactMatches = [...decoded.matchAll(/!"([^"]+)"/g)].map((m) => m[1]);
        if (exactMatches.length > 0) {
          const data = exactMatches.map((name) => ({
            name, lang: "fr", printed_name: `[FR] ${name}`,
          }));
          await route.fulfill({ json: { data } });
          return;
        }
        const partial = (decoded.match(/name:([^&\s]+)/i) || [])[1] || "";
        const FR_TO_EN = {
          "foudre": { name: "Lightning Bolt", printed_name: "Foudre" },
          "contresort": { name: "Counterspell", printed_name: "Contresort" },
        };
        const hit = FR_TO_EN[partial.toLowerCase()];
        const data = hit ? [{ name: hit.name, lang: "fr", printed_name: hit.printed_name }] : [];
        await route.fulfill({ json: { data } });
        return;
      }
      // Printing picker: two distinct printings of "Test Card".
      await route.fulfill({
        json: {
          data: [
            {
              name: "Test Card", set: "cmd", collector_number: "1",
              set_name: "Commander", image_uris: fakeImageUris("cmd", "1"),
            },
            {
              name: "Test Card", set: "lea", collector_number: "2",
              set_name: "Alpha", image_uris: fakeImageUris("lea", "2"),
            },
          ],
        },
      });
      return;
    }

    await route.fulfill({ status: 404 });
  });

  // Stub image loads on the fake scryfall.io host so the browser
  // doesn't try to resolve DNS for our test URLs.
  await page.route("https://*.scryfall.io/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: TINY_PNG,
    });
  });
}

/* Apply localStorage state before any of the app scripts run. Called
 * inside `addInitScript` so it executes once per page navigation. */
export async function presetStorage(page, state) {
  await page.addInitScript((s) => {
    for (const [k, v] of Object.entries(s)) {
      localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
    }
  }, state);
}

/* Open the header deck-pill dropdown so its menu items (Importer,
 * Supprimer ce deck, deck list) become visible to Playwright. Tests
 * that previously clicked a top-level "+ Importer" button now have
 * to expand the deck menu first — Playwright won't click an element
 * whose ancestor has [hidden]. */
export async function openDeckMenu(page) {
  await page.click("#btn-deck-pill");
  await page.locator("#deck-dropdown-menu").waitFor({ state: "visible" });
}

/* Switch decks without going through the visible dropdown — useful
 * when the test cares about the post-switch state, not the picker
 * UX. Mutates the hidden #deck-select and dispatches change, which
 * is what the deck-pill click handler does internally. */
export async function switchDeckById(page, deckId) {
  await page.evaluate((id) => {
    const sel = document.getElementById("deck-select");
    sel.value = id;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, deckId);
}
