/* Default decks seeded into localStorage on first run. After that,
 * they're regular user decks — fully editable, deletable, no special
 * "built-in" treatment. To change the on-disk state for an existing
 * user, edit via the Manage view (this file is only consulted once). */
const DEFAULT_DECKS = [
  {
    id: "sultai-ukkima-cazur",
    name: "Sultai — Ukkima & Cazur",
    format: "commander",
    commanders: [
      { name: "Ukkima, Stalking Shadow" },
      { name: "Cazur, Ruthless Stalker" },
    ],
    cards: [
      { name: "Island", qty: 6 }, { name: "Swamp", qty: 6 }, { name: "Forest", qty: 5 },
      { name: "Polluted Delta", qty: 1 }, { name: "Breeding Pool", qty: 1 },
      { name: "Overgrown Tomb", qty: 1 }, { name: "Underground River", qty: 1 },
      { name: "Llanowar Wastes", qty: 1 }, { name: "Yavimaya Coast", qty: 1 },
      { name: "Drowned Catacomb", qty: 1 }, { name: "Hinterland Harbor", qty: 1 },
      { name: "Woodland Cemetery", qty: 1 }, { name: "Sunken Hollow", qty: 1 },
      { name: "Darkslick Shores", qty: 1 }, { name: "Twilight Mire", qty: 1 },
      { name: "Flooded Grove", qty: 1 }, { name: "Viridescent Bog", qty: 1 },
      { name: "Overflowing Basin", qty: 1 }, { name: "Darkwater Catacombs", qty: 1 },
      { name: "Command Tower", qty: 1 }, { name: "Exotic Orchard", qty: 1 },
      { name: "Fetid Pools", qty: 1 }, { name: "Opulent Palace", qty: 1 },
      { name: "Temple of Deceit", qty: 1 },
      { name: "Birds of Paradise", qty: 1 }, { name: "Sylvan Caryatid", qty: 1 },
      { name: "Great Forest Druid", qty: 1 }, { name: "Tower Winder", qty: 1 },
      { name: "Sol Ring", qty: 1 }, { name: "Arcane Signet", qty: 1 },
      { name: "Wayfarer's Bauble", qty: 1 }, { name: "Three Visits", qty: 1 },
      { name: "Rampant Growth", qty: 1 }, { name: "Kodama's Reach", qty: 1 },
      { name: "Cultivate", qty: 1 }, { name: "Phantom Warrior", qty: 1 },
      { name: "Slippery Scoundrel", qty: 1 }, { name: "Cold-Eyed Selkie", qty: 1 },
      { name: "Invisible Stalker", qty: 1 }, { name: "Triton Shorestalker", qty: 1 },
      { name: "Dauthi Marauder", qty: 1 }, { name: "Thalakos Deceiver", qty: 1 },
      { name: "Neurok Invisimancer", qty: 1 }, { name: "Mist-Cloaked Herald", qty: 1 },
      { name: "Slither Blade", qty: 1 }, { name: "Whirler Rogue", qty: 1 },
      { name: "Veteran Ice Climber", qty: 1 }, { name: "Latch Seeker", qty: 1 },
      { name: "Jhessian Infiltrator", qty: 1 }, { name: "Shadowmage Infiltrator", qty: 1 },
      { name: "Trespassing Souleater", qty: 1 }, { name: "Ohran Frostfang", qty: 1 },
      { name: "Edric, Spymaster of Trest", qty: 1 }, { name: "Felix Five-Boots", qty: 1 },
      { name: "Baleful Strix", qty: 1 }, { name: "Meltstrider Eulogist", qty: 1 },
      { name: "Bonny Pall, Clearcutter", qty: 1 },
      { name: "Aqueous Form", qty: 1 }, { name: "Curiosity", qty: 1 },
      { name: "Curious Obsession", qty: 1 }, { name: "Bred for the Hunt", qty: 1 },
      { name: "Bident of Thassa", qty: 1 }, { name: "Forced Adaptation", qty: 1 },
      { name: "Rhystic Study", qty: 1 }, { name: "Brainstorm", qty: 1 },
      { name: "Concentrate", qty: 1 }, { name: "Mystic Confluence", qty: 1 },
      { name: "Unwind", qty: 1 }, { name: "Mana Leak", qty: 1 }, { name: "Negate", qty: 1 },
      { name: "Putrefy", qty: 1 }, { name: "Doom Blade", qty: 1 },
      { name: "Shoot the Sheriff", qty: 1 }, { name: "Curse of the Swine", qty: 1 },
      { name: "Naturalize", qty: 1 }, { name: "Rapid Hybridization", qty: 1 },
      { name: "Snakeskin Veil", qty: 1 }, { name: "Simic Charm", qty: 1 },
      { name: "Intervene", qty: 1 }, { name: "Trash the Town", qty: 1 },
      { name: "Midnight Recovery", qty: 1 }, { name: "Nature's Spiral", qty: 1 },
      { name: "Arcane Heist", qty: 1 }, { name: "Entrancing Melody", qty: 1 },
    ],
  },
];

/* CommonJS export for tests — no-op in the browser. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { DEFAULT_DECKS };
}
