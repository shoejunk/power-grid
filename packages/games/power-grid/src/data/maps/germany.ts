/**
 * Power Grid — Germany map (base game board, "Germany" side).
 *
 * Provenance
 * ----------
 * City list, area (colour region) membership and every connection cost were
 * transcribed by cross-checking six independent open-source machine-readable
 * transcriptions of the physical board:
 *
 *   1. boardzilla/powergrid          src/game/index.ts
 *      https://github.com/boardzilla/powergrid/blob/master/src/game/index.ts
 *   2. gummyboars/lunboks            powerplant/cities.py (`Germany()`)
 *      https://github.com/gummyboars/lunboks/blob/master/powerplant/cities.py
 *   3. grnt426/PowuhGred             data/germany_connections.txt + germany_cities.txt
 *      https://github.com/grnt426/PowuhGred/tree/master/data
 *   4. boardgamers/powergrid         engine/src/maps/germany.ts (`map`, not
 *      `mapRecharged` — the Recharged variant swaps Wiesbaden for Mainz and
 *      adds Stralsund, so it is a different board)
 *      https://github.com/boardgamers/powergrid/blob/master/engine/src/maps/germany.ts
 *   5. yct21/pgboard                 frontend/game/maps/germany.js
 *      https://github.com/yct21/pgboard/blob/master/frontend/game/maps/germany.js
 *   6. powergrid-comp-345/PowerGrid  germany.map
 *      https://github.com/powergrid-comp-345/PowerGrid/blob/master/germany.map
 *
 * All six sources agree on the 42 cities, their spelling and their six area
 * groupings (verified by comparing the partitions, not the colour labels).
 * Sources 1-4 reproduce all 83 connections below with identical costs; source 5
 * agrees on everything it lists but omits four edges (Bremen–Osnabrück,
 * Mannheim–Saarbrücken, München–Passau, Trier–Wiesbaden). Two real divergences,
 * both resolved 5-to-1 against source 6:
 *
 *   - Erfurt–Fulda: source 6 prints 15; sources 1-5 print 13. Using 13.
 *   - Wiesbaden–Frankfurt-M (cost 0): absent from source 6, present in 1-5.
 *     The two cities are ~30 km apart and the board does draw a free link
 *     between them, so it is included.
 *
 * Two costs are additionally confirmed by the worked example in the published
 * rulebook (Duisburg → Essen is free; Aachen costs 10+9+2 = 21 via Düsseldorf,
 * i.e. Essen–Düsseldorf 2 and Düsseldorf–Aachen 9; Münster–Dortmund is 2).
 *
 * Source 6's region-adjacency block independently confirms the six-area
 * adjacency graph derived from `connections` below.
 *
 * The Essen–Duisburg (0), Halle–Leipzig (0) and Wiesbaden–Frankfurt-M (0)
 * links are genuinely free on the board; §1 explicitly allows cost 0.
 *
 * Coordinates
 * -----------
 * `x`/`y` are NOT taken from any source file; they are derived from the real
 * WGS84 latitude/longitude of each city, projected with a cos(mean-latitude)
 * correction, normalised into [0.045, 0.955] on both axes, then relaxed so no
 * two cities sit closer than 0.032 apart (the Duisburg/Essen/Düsseldorf and
 * Halle/Leipzig clusters are tighter than that in reality). Geography is
 * therefore accurate to within a couple of pixels of nudging.
 *
 * Metropolises: the base Germany board has NO metropolis city pairs, so no
 * city carries `metropolisPartner`. A metropolis is a pair of city nodes
 * sharing one nameplate; it is a later-edition / expansion-map device
 * (Recharged and the add-on boards), and all six sources above model the
 * Germany board as exactly 42 single-node cities — which is also forced by the
 * 6 areas x 7 cities count. (Frankfurt-M and Frankfurt-O are two different
 * cities, not a pair.)
 *
 * Area names are our own descriptive labels — the printed board identifies the
 * six areas by colour only. Colours below follow the board's colour regions.
 */

import type { GameMap } from '../../types.js';

export const GERMANY_MAP: GameMap = {
  id: 'germany',
  name: 'Germany',
  aspectRatio: 0.78,
  rules: {
    /** §12: buying plant 39 permanently stops uranium resupply. */
    nuclearPhaseOutPlant: 39,
  },

  /* --- Areas (6) — `adjacentAreas` is derived from `connections` below. --- */
  areas: [
    { id: 'north', name: 'North', color: '#4fb3bf', adjacentAreas: ['northeast', 'west', 'east'] },
    { id: 'northeast', name: 'Northeast', color: '#a2714b', adjacentAreas: ['north', 'east'] },
    { id: 'west', name: 'West', color: '#c9483f', adjacentAreas: ['north', 'southwest', 'east'] },
    { id: 'southwest', name: 'Southwest', color: '#3f6fbf', adjacentAreas: ['west', 'east', 'south'] },
    { id: 'east', name: 'East', color: '#d8b62e', adjacentAreas: ['north', 'northeast', 'west', 'southwest', 'south'] },
    { id: 'south', name: 'South', color: '#8659b5', adjacentAreas: ['southwest', 'east'] },
  ],

  /* --- Cities (6 areas x 7 = 42) --- */
  cities: [
    // North
    { id: 'flensburg', name: 'Flensburg', area: 'north', x: 0.4050, y: 0.0450 },
    { id: 'kiel', name: 'Kiel', area: 'north', x: 0.4808, y: 0.1038 },
    { id: 'hamburg', name: 'Hamburg', area: 'north', x: 0.4652, y: 0.2025 },
    { id: 'cuxhaven', name: 'Cuxhaven', area: 'north', x: 0.3260, y: 0.1626 },
    { id: 'wilhelmshaven', name: 'Wilhelmshaven', area: 'north', x: 0.2631, y: 0.2053 },
    { id: 'bremen', name: 'Bremen', area: 'north', x: 0.3371, y: 0.2628 },
    { id: 'hannover', name: 'Hannover', area: 'north', x: 0.4372, y: 0.3526 },

    // Northeast
    { id: 'luebeck', name: 'Lübeck', area: 'northeast', x: 0.5397, y: 0.1622 },
    { id: 'schwerin', name: 'Schwerin', area: 'northeast', x: 0.6165, y: 0.1917 },
    { id: 'rostock', name: 'Rostock', area: 'northeast', x: 0.6915, y: 0.1333 },
    { id: 'torgelow', name: 'Torgelow', area: 'northeast', x: 0.8969, y: 0.1920 },
    { id: 'berlin', name: 'Berlin', area: 'northeast', x: 0.8318, y: 0.3342 },
    { id: 'magdeburg', name: 'Magdeburg', area: 'northeast', x: 0.6407, y: 0.3852 },
    { id: 'frankfurt-o', name: 'Frankfurt-O', area: 'northeast', x: 0.9550, y: 0.3562 },

    // West
    { id: 'osnabrueck', name: 'Osnabrück', area: 'west', x: 0.2560, y: 0.3650 },
    { id: 'muenster', name: 'Münster', area: 'west', x: 0.2107, y: 0.4058 },
    { id: 'essen', name: 'Essen', area: 'west', x: 0.1474, y: 0.4700 },
    { id: 'duisburg', name: 'Duisburg', area: 'west', x: 0.1149, y: 0.4703 },
    { id: 'duesseldorf', name: 'Düsseldorf', area: 'west', x: 0.1195, y: 0.5022 },
    { id: 'dortmund', name: 'Dortmund', area: 'west', x: 0.1935, y: 0.4628 },
    { id: 'kassel', name: 'Kassel', area: 'west', x: 0.4100, y: 0.4886 },

    // Southwest
    { id: 'aachen', name: 'Aachen', area: 'southwest', x: 0.0450, y: 0.5571 },
    { id: 'koeln', name: 'Köln', area: 'southwest', x: 0.1391, y: 0.5364 },
    { id: 'trier', name: 'Trier', area: 'southwest', x: 0.1045, y: 0.6883 },
    { id: 'wiesbaden', name: 'Wiesbaden', area: 'southwest', x: 0.2767, y: 0.6457 },
    { id: 'frankfurt-m', name: 'Frankfurt-M', area: 'southwest', x: 0.3242, y: 0.6421 },
    { id: 'saarbruecken', name: 'Saarbrücken', area: 'southwest', x: 0.1429, y: 0.7542 },
    { id: 'mannheim', name: 'Mannheim', area: 'southwest', x: 0.3010, y: 0.7217 },

    // East
    { id: 'fulda', name: 'Fulda', area: 'east', x: 0.4312, y: 0.5855 },
    { id: 'wuerzburg', name: 'Würzburg', area: 'east', x: 0.4606, y: 0.6829 },
    { id: 'erfurt', name: 'Erfurt', area: 'east', x: 0.5765, y: 0.5313 },
    { id: 'halle', name: 'Halle', area: 'east', x: 0.6776, y: 0.4669 },
    { id: 'leipzig', name: 'Leipzig', area: 'east', x: 0.7211, y: 0.4850 },
    { id: 'dresden', name: 'Dresden', area: 'east', x: 0.8676, y: 0.5220 },
    { id: 'nuernberg', name: 'Nürnberg', area: 'east', x: 0.5816, y: 0.7263 },

    // South
    { id: 'stuttgart', name: 'Stuttgart', area: 'south', x: 0.3780, y: 0.8127 },
    { id: 'freiburg', name: 'Freiburg', area: 'south', x: 0.2339, y: 0.9121 },
    { id: 'konstanz', name: 'Konstanz', area: 'south', x: 0.3773, y: 0.9550 },
    { id: 'augsburg', name: 'Augsburg', area: 'south', x: 0.5624, y: 0.8645 },
    { id: 'muenchen', name: 'München', area: 'south', x: 0.6359, y: 0.8947 },
    { id: 'regensburg', name: 'Regensburg', area: 'south', x: 0.6918, y: 0.7825 },
    { id: 'passau', name: 'Passau', area: 'south', x: 0.8346, y: 0.8395 },
  ],

  /* --- Connections (83) — grouped by the area each run starts in. --- */
  connections: [
    // North
    { a: 'flensburg', b: 'kiel', cost: 4 },
    { a: 'kiel', b: 'hamburg', cost: 8 },
    { a: 'kiel', b: 'luebeck', cost: 4 },
    { a: 'hamburg', b: 'luebeck', cost: 6 },
    { a: 'hamburg', b: 'schwerin', cost: 8 },
    { a: 'hamburg', b: 'cuxhaven', cost: 11 },
    { a: 'hamburg', b: 'bremen', cost: 11 },
    { a: 'hamburg', b: 'hannover', cost: 17 },
    { a: 'cuxhaven', b: 'bremen', cost: 8 },
    { a: 'bremen', b: 'wilhelmshaven', cost: 11 },
    { a: 'bremen', b: 'osnabrueck', cost: 11 },
    { a: 'bremen', b: 'hannover', cost: 10 },
    { a: 'wilhelmshaven', b: 'osnabrueck', cost: 14 },
    { a: 'hannover', b: 'schwerin', cost: 19 },
    { a: 'hannover', b: 'magdeburg', cost: 15 },
    { a: 'hannover', b: 'osnabrueck', cost: 16 },
    { a: 'hannover', b: 'kassel', cost: 15 },
    { a: 'hannover', b: 'erfurt', cost: 19 },

    // Northeast
    { a: 'luebeck', b: 'schwerin', cost: 6 },
    { a: 'schwerin', b: 'rostock', cost: 6 },
    { a: 'schwerin', b: 'torgelow', cost: 19 },
    { a: 'schwerin', b: 'berlin', cost: 18 },
    { a: 'schwerin', b: 'magdeburg', cost: 16 },
    { a: 'rostock', b: 'torgelow', cost: 19 },
    { a: 'torgelow', b: 'berlin', cost: 15 },
    { a: 'berlin', b: 'magdeburg', cost: 10 },
    { a: 'berlin', b: 'frankfurt-o', cost: 6 },
    { a: 'berlin', b: 'halle', cost: 17 },
    { a: 'magdeburg', b: 'halle', cost: 11 },
    { a: 'frankfurt-o', b: 'leipzig', cost: 21 },
    { a: 'frankfurt-o', b: 'dresden', cost: 16 },

    // West
    { a: 'osnabrueck', b: 'muenster', cost: 7 },
    { a: 'osnabrueck', b: 'kassel', cost: 20 },
    { a: 'muenster', b: 'essen', cost: 6 },
    { a: 'muenster', b: 'dortmund', cost: 2 },
    { a: 'essen', b: 'duisburg', cost: 0 },
    { a: 'essen', b: 'duesseldorf', cost: 2 },
    { a: 'essen', b: 'dortmund', cost: 4 },
    { a: 'duesseldorf', b: 'aachen', cost: 9 },
    { a: 'duesseldorf', b: 'koeln', cost: 4 },
    { a: 'dortmund', b: 'koeln', cost: 10 },
    { a: 'dortmund', b: 'frankfurt-m', cost: 20 },
    { a: 'dortmund', b: 'kassel', cost: 18 },
    { a: 'kassel', b: 'frankfurt-m', cost: 13 },
    { a: 'kassel', b: 'fulda', cost: 8 },
    { a: 'kassel', b: 'erfurt', cost: 15 },

    // Southwest
    { a: 'aachen', b: 'koeln', cost: 7 },
    { a: 'aachen', b: 'trier', cost: 19 },
    { a: 'koeln', b: 'trier', cost: 20 },
    { a: 'koeln', b: 'wiesbaden', cost: 21 },
    { a: 'trier', b: 'wiesbaden', cost: 18 },
    { a: 'trier', b: 'saarbruecken', cost: 11 },
    { a: 'wiesbaden', b: 'saarbruecken', cost: 10 },
    { a: 'wiesbaden', b: 'frankfurt-m', cost: 0 },
    { a: 'wiesbaden', b: 'mannheim', cost: 11 },
    { a: 'frankfurt-m', b: 'fulda', cost: 8 },
    { a: 'frankfurt-m', b: 'wuerzburg', cost: 13 },
    { a: 'saarbruecken', b: 'mannheim', cost: 11 },
    { a: 'saarbruecken', b: 'stuttgart', cost: 17 },
    { a: 'mannheim', b: 'wuerzburg', cost: 10 },
    { a: 'mannheim', b: 'stuttgart', cost: 6 },

    // East
    { a: 'fulda', b: 'wuerzburg', cost: 11 },
    { a: 'fulda', b: 'erfurt', cost: 13 },
    { a: 'wuerzburg', b: 'nuernberg', cost: 8 },
    { a: 'wuerzburg', b: 'stuttgart', cost: 12 },
    { a: 'wuerzburg', b: 'augsburg', cost: 19 },
    { a: 'erfurt', b: 'halle', cost: 6 },
    { a: 'erfurt', b: 'nuernberg', cost: 21 },
    { a: 'erfurt', b: 'dresden', cost: 19 },
    { a: 'halle', b: 'leipzig', cost: 0 },
    { a: 'leipzig', b: 'dresden', cost: 13 },
    { a: 'nuernberg', b: 'regensburg', cost: 12 },
    { a: 'nuernberg', b: 'augsburg', cost: 18 },

    // South
    { a: 'stuttgart', b: 'freiburg', cost: 16 },
    { a: 'stuttgart', b: 'konstanz', cost: 16 },
    { a: 'stuttgart', b: 'augsburg', cost: 15 },
    { a: 'freiburg', b: 'konstanz', cost: 14 },
    { a: 'konstanz', b: 'augsburg', cost: 17 },
    { a: 'augsburg', b: 'muenchen', cost: 6 },
    { a: 'augsburg', b: 'regensburg', cost: 13 },
    { a: 'regensburg', b: 'muenchen', cost: 10 },
    { a: 'regensburg', b: 'passau', cost: 12 },
    { a: 'muenchen', b: 'passau', cost: 14 },
  ],
};
