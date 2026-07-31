/**
 * Player-facing rule explanations.
 *
 * Every string here is a paraphrase of a specific section of
 * `power-grid-gameplay-requirements.md`, and carries its citation so a player
 * can always trace a claim in the UI back to the rulebook (quality bar U8).
 *
 * Keeping the copy in one module means the same explanation appears in the
 * lobby, the setup screen and the in-game help without drifting.
 */

export interface RuleNote {
  title: string;
  body: string;
  /** Section reference, rendered in the tooltip footer. */
  rule: string;
}

export const RULES: Record<string, RuleNote> = {
  experiencedStart: {
    title: 'Experienced start',
    body:
      'After the playing zone is chosen, each player reserves a future starting city in player order. That city is where their network must begin, and — except as starting cities — reserved cities cannot be connected during Step 1. Recommended once everyone knows the map.',
    rule: '§2 Optional experienced-player starting cities',
  },
  againstTheTrust: {
    title: 'Against the Trust',
    body:
      'The two-player variant. An automated third faction, the Trust, takes plants and resources for free, always sits second in turn order, blocks cities you try to expand into — and cannot win. It uses the 3-area zone and 16 houses.',
    rule: '§13 Two-player variant',
  },
  playerCount: {
    title: 'Player count',
    body:
      'Seats at the table, 2 to 6. The count decides the size of the playing zone (3 areas for 2–3 players, 4 for 4, 5 for 5–6), how many plant cards are removed during setup, the resource refill rates, and the city totals that trigger Step 2 and the end of the game.',
    rule: '§1, §2, §10, §11',
  },
  zone: {
    title: 'Playing zone',
    body:
      'Every map has 6 areas of 7 cities. Only a contiguous subset is in play, and you may use nothing outside it for the whole game — not even as a route through.',
    rule: '§1 Board and map data',
  },
  seed: {
    title: 'Setup seed',
    body:
      'Every random operation — the plant shuffle, the removed cards, the initial turn order — is driven by this seed. Two games with the same seed and settings set up identically, which makes matches replayable and auditable.',
    rule: '§14 Determinism and auditability',
  },
  bots: {
    title: 'Bots',
    body:
      'Fill empty seats with AI opponents. Bots obey exactly the same legal-action rules as human players and can be removed by the host at any time before the game starts.',
    rule: '§14 Authoritative state',
  },
  ready: {
    title: 'Ready',
    body:
      'Marks that you are happy with the settings. The host can only start once every seated player is ready.',
    rule: '§2 Setup requirements',
  },
  gameCode: {
    title: 'Game code',
    body:
      'Share this six-character code so friends can join. Their seat, money, plants and houses are tied to it, and it survives a refresh or a server restart.',
    rule: '§14 Authoritative state',
  },
  colour: {
    title: 'Seat colour',
    body:
      'Your 22 houses and your marker on the scoring and turn-order tracks all use this colour. Each colour also has its own shape, so ownership stays readable without relying on hue.',
    rule: '§1 Players and inventory',
  },
} as const;

/* ------------------------------------------------------------------ *
 * Setup-dependent numbers, mirrored from the requirements tables so the
 * setup screen can preview the consequences of a player-count change
 * before the server ever builds a game.
 * ------------------------------------------------------------------ */

/** Areas in the playing zone, by player count. §1. */
export const ZONE_AREAS: Record<number, number> = { 2: 3, 3: 3, 4: 4, 5: 5, 6: 5 };

/** Connected cities that trigger Step 2, by player count. §10. */
export const STEP2_CITIES: Record<number, number> = { 2: 7, 3: 7, 4: 7, 5: 7, 6: 6 };

/** Connected cities that end the game, by player count. §11. */
export const END_GAME_CITIES: Record<number, number> = { 2: 18, 3: 17, 4: 17, 5: 15, 6: 14 };

/** Starting money, houses and plant limit — constant across player counts. §1. */
export const STARTING_MONEY = 50;
export const HOUSES_PER_PLAYER = 22;
export const MAX_PLANTS_PER_PLAYER = 3;

/**
 * The five phases of every round, in order, with the one-line description the
 * UI shows in the phase rail and in the how-to-play sheet. §3.
 */
export const PHASES: { key: string; index: number; name: string; summary: string }[] = [
  {
    key: 'order',
    index: 1,
    name: 'Player Order',
    summary: 'Rank by connected cities, largest plant breaks ties.',
  },
  {
    key: 'auction',
    index: 2,
    name: 'Auction Plants',
    summary: 'One plant per player per round. Minimum bid is the plant number.',
  },
  {
    key: 'resources',
    index: 3,
    name: 'Buy Resources',
    summary: 'Reverse order. Prices rise as the market empties.',
  },
  {
    key: 'building',
    index: 4,
    name: 'Build Houses',
    summary: 'Reverse order. Pay the cheapest route plus the city slot.',
  },
  {
    key: 'bureaucracy',
    index: 5,
    name: 'Bureaucracy',
    summary: 'Power cities for income, refill the market, age the plants.',
  },
];
