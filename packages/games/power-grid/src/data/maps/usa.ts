/**
 * Power Grid — USA map (base game board, "USA" side).
 *
 * Provenance
 * ----------
 * City list, area (colour region) membership and every connection cost were
 * transcribed by cross-checking six independent open-source machine-readable
 * transcriptions of the physical board:
 *
 *   1. gummyboars/lunboks            powerplant/cities.py (`USA()`)
 *      https://github.com/gummyboars/lunboks/blob/master/powerplant/cities.py
 *   2. boardgamers/powergrid         engine/src/maps/america.ts (`map`, not
 *      `mapRecharged`)
 *      https://github.com/boardgamers/powergrid/blob/master/engine/src/maps/america.ts
 *   3. XBigTK13X/power-grid-automa   src/board/united_states_of_america.py
 *      https://github.com/XBigTK13X/power-grid-automa/blob/master/src/board/united_states_of_america.py
 *   4. js3692/TerraWatts             seed/connection.js + seed/city.js
 *      https://github.com/js3692/TerraWatts/blob/master/seed/connection.js
 *   5. yct21/pgboard                 frontend/game/maps/usa.js
 *      https://github.com/yct21/pgboard/blob/master/frontend/game/maps/usa.js
 *   6. amirbawab/PowerGrid           Resources/config/map/USAMap.xml
 *      https://github.com/amirbawab/PowerGrid/blob/master/Resources/config/map/USAMap.xml
 *
 * All six sources agree on the 42 cities, their spelling and their six area
 * groupings (verified by comparing the partitions, not the colour labels).
 * Sources 1, 2 and 3 reproduce all 87 connections below with identical costs.
 * The remaining divergences and how they were resolved:
 *
 *   - Atlanta–Birmingham (3): in sources 1-5, missing from 6. Included.
 *   - Las Vegas–Salt Lake City (18): in sources 1-5, missing from 6. Included.
 *   - Jacksonville–Tampa: 4 in sources 1-5, 5 in source 6. Using 4.
 *   - Boise–Cheyenne (24): sources 1, 2, 3 and 6 give 24; source 4 gives 21;
 *     source 5 instead draws the link as Boise–Denver 24. Resolved against the
 *     board via the BGG rules thread "Power Grid - Connection Cost Cheyenne to
 *     Boise" (https://boardgamegeek.com/thread/115823/), which confirms both
 *     the endpoints (Cheyenne, not Denver) and the printed 24, and notes that
 *     Cheyenne–Billings–Boise (9+12=21) is always the cheaper route — which is
 *     almost certainly where source 4's 21 came from.
 *
 * The Cheyenne–Denver (0), New York–Philadelphia (0) and Savannah–Jacksonville
 * (0) links are genuinely free on the board; §1 explicitly allows cost 0.
 *
 * NOTE on `adjacentAreas`: source 3 ships its own hand-written region-adjacency
 * table which omits Southwest–South. That table is wrong — Santa Fe (SW) links
 * to Kansas City, Oklahoma City, Dallas and Houston (S) in all six sources.
 * The `adjacentAreas` below are derived mechanically from `connections`.
 *
 * Coordinates
 * -----------
 * `x`/`y` are NOT taken from any source file; they are derived from the real
 * WGS84 latitude/longitude of each city, projected with a cos(mean-latitude)
 * correction, normalised into [0.045, 0.955] on both axes, then relaxed so no
 * two cities sit closer than 0.032 apart.
 *
 * Metropolises: the base USA board has NO metropolis city pairs, so no city
 * carries `metropolisPartner`. A metropolis is a pair of city nodes sharing one
 * nameplate; it is a later-edition / expansion-map device (Recharged and the
 * add-on boards), and all six sources above model the USA board as exactly 42
 * single-node cities — which is also forced by the 6 areas x 7 cities count.
 *
 * Area names are our own descriptive labels — the printed board identifies the
 * six areas by colour only. Colours below follow the board's colour regions.
 */

import type { GameMap } from '../../types.js';

export const USA_MAP: GameMap = {
  id: 'usa',
  name: 'USA',
  aspectRatio: 1.55,
  rules: {
    /** §12: coal returned from production is resold at 8 once the market dries up. */
    coalStorage: { enabled: true, priceWhenMarketEmpty: 8 },
  },

  /* --- Areas (6) — `adjacentAreas` is derived from `connections` below. --- */
  areas: [
    { id: 'northwest', name: 'Northwest', color: '#8659b5', adjacentAreas: ['southwest', 'midwest', 'south'] },
    { id: 'southwest', name: 'Southwest', color: '#4fb3bf', adjacentAreas: ['northwest', 'south'] },
    { id: 'midwest', name: 'Midwest', color: '#d8b62e', adjacentAreas: ['northwest', 'south', 'southeast', 'northeast'] },
    { id: 'south', name: 'South', color: '#c9483f', adjacentAreas: ['northwest', 'southwest', 'midwest', 'southeast'] },
    { id: 'southeast', name: 'Southeast', color: '#3f6fbf', adjacentAreas: ['midwest', 'south', 'northeast'] },
    { id: 'northeast', name: 'Northeast', color: '#a2714b', adjacentAreas: ['midwest', 'southeast'] },
  ],

  /* --- Cities (6 areas x 7 = 42) --- */
  cities: [
    // Northwest
    { id: 'seattle', name: 'Seattle', area: 'northwest', x: 0.0511, y: 0.0450 },
    { id: 'portland', name: 'Portland', area: 'northwest', x: 0.0450, y: 0.1321 },
    { id: 'boise', name: 'Boise', area: 'northwest', x: 0.1592, y: 0.2113 },
    { id: 'billings', name: 'Billings', area: 'northwest', x: 0.2949, y: 0.1209 },
    { id: 'cheyenne', name: 'Cheyenne', area: 'northwest', x: 0.3598, y: 0.3144 },
    { id: 'denver', name: 'Denver', area: 'northwest', x: 0.3568, y: 0.3727 },
    { id: 'omaha', name: 'Omaha', area: 'northwest', x: 0.5164, y: 0.3095 },

    // Southwest
    { id: 'san-francisco', name: 'San Francisco', area: 'southwest', x: 0.0496, y: 0.4545 },
    { id: 'salt-lake-city', name: 'Salt Lake City', area: 'southwest', x: 0.2352, y: 0.3302 },
    { id: 'las-vegas', name: 'Las Vegas', area: 'southwest', x: 0.1779, y: 0.5214 },
    { id: 'santa-fe', name: 'Santa Fe', area: 'southwest', x: 0.3401, y: 0.5415 },
    { id: 'los-angeles', name: 'Los Angeles', area: 'southwest', x: 0.1232, y: 0.6096 },
    { id: 'san-diego', name: 'San Diego', area: 'southwest', x: 0.1423, y: 0.6653 },
    { id: 'phoenix', name: 'Phoenix', area: 'southwest', x: 0.2319, y: 0.6348 },

    // Midwest
    { id: 'fargo', name: 'Fargo', area: 'midwest', x: 0.5014, y: 0.0754 },
    { id: 'duluth', name: 'Duluth', area: 'midwest', x: 0.5841, y: 0.0792 },
    { id: 'minneapolis', name: 'Minneapolis', area: 'midwest', x: 0.5635, y: 0.1545 },
    { id: 'chicago', name: 'Chicago', area: 'midwest', x: 0.6629, y: 0.2836 },
    { id: 'st-louis', name: 'St. Louis', area: 'midwest', x: 0.6176, y: 0.4191 },
    { id: 'cincinnati', name: 'Cincinnati', area: 'midwest', x: 0.7178, y: 0.3992 },
    { id: 'knoxville', name: 'Knoxville', area: 'midwest', x: 0.7282, y: 0.5301 },

    // South
    { id: 'kansas-city', name: 'Kansas City', area: 'south', x: 0.5404, y: 0.3994 },
    { id: 'oklahoma-city', name: 'Oklahoma City', area: 'south', x: 0.4886, y: 0.5507 },
    { id: 'dallas', name: 'Dallas', area: 'south', x: 0.5013, y: 0.6628 },
    { id: 'houston', name: 'Houston', area: 'south', x: 0.5264, y: 0.7884 },
    { id: 'new-orleans', name: 'New Orleans', area: 'south', x: 0.6198, y: 0.7805 },
    { id: 'memphis', name: 'Memphis', area: 'south', x: 0.6202, y: 0.5639 },
    { id: 'birmingham', name: 'Birmingham', area: 'south', x: 0.6775, y: 0.6318 },

    // Southeast
    { id: 'atlanta', name: 'Atlanta', area: 'southeast', x: 0.7200, y: 0.6223 },
    { id: 'raleigh', name: 'Raleigh', area: 'southeast', x: 0.8214, y: 0.5377 },
    { id: 'norfolk', name: 'Norfolk', area: 'southeast', x: 0.8628, y: 0.4930 },
    { id: 'savannah', name: 'Savannah', area: 'southeast', x: 0.7780, y: 0.6916 },
    { id: 'jacksonville', name: 'Jacksonville', area: 'southeast', x: 0.7682, y: 0.7646 },
    { id: 'tampa', name: 'Tampa', area: 'southeast', x: 0.7540, y: 0.8638 },
    { id: 'miami', name: 'Miami', area: 'southeast', x: 0.7940, y: 0.9550 },

    // Northeast
    { id: 'detroit', name: 'Detroit', area: 'northeast', x: 0.7437, y: 0.2648 },
    { id: 'buffalo', name: 'Buffalo', area: 'northeast', x: 0.8171, y: 0.2416 },
    { id: 'pittsburgh', name: 'Pittsburgh', area: 'northeast', x: 0.7974, y: 0.3435 },
    { id: 'washington-dc', name: 'Washington D.C.', area: 'northeast', x: 0.8496, y: 0.4074 },
    { id: 'philadelphia', name: 'Philadelphia', area: 'northeast', x: 0.8826, y: 0.3638 },
    { id: 'new-york', name: 'New York', area: 'northeast', x: 0.9030, y: 0.3322 },
    { id: 'boston', name: 'Boston', area: 'northeast', x: 0.9550, y: 0.2635 },
  ],

  /* --- Connections (87) — grouped by the area each run starts in. --- */
  connections: [
    // Northwest
    { a: 'seattle', b: 'portland', cost: 3 },
    { a: 'seattle', b: 'boise', cost: 12 },
    { a: 'seattle', b: 'billings', cost: 9 },
    { a: 'portland', b: 'boise', cost: 13 },
    { a: 'portland', b: 'san-francisco', cost: 24 },
    { a: 'boise', b: 'billings', cost: 12 },
    { a: 'boise', b: 'cheyenne', cost: 24 },
    { a: 'boise', b: 'salt-lake-city', cost: 8 },
    { a: 'boise', b: 'san-francisco', cost: 23 },
    { a: 'billings', b: 'cheyenne', cost: 9 },
    { a: 'billings', b: 'fargo', cost: 17 },
    { a: 'billings', b: 'minneapolis', cost: 18 },
    { a: 'cheyenne', b: 'denver', cost: 0 },
    { a: 'cheyenne', b: 'minneapolis', cost: 18 },
    { a: 'cheyenne', b: 'omaha', cost: 14 },
    { a: 'denver', b: 'salt-lake-city', cost: 21 },
    { a: 'denver', b: 'santa-fe', cost: 13 },
    { a: 'denver', b: 'kansas-city', cost: 16 },
    { a: 'omaha', b: 'minneapolis', cost: 8 },
    { a: 'omaha', b: 'chicago', cost: 13 },

    // Southwest
    { a: 'omaha', b: 'kansas-city', cost: 5 },
    { a: 'san-francisco', b: 'salt-lake-city', cost: 27 },
    { a: 'san-francisco', b: 'las-vegas', cost: 14 },
    { a: 'san-francisco', b: 'los-angeles', cost: 9 },
    { a: 'salt-lake-city', b: 'las-vegas', cost: 18 },
    { a: 'salt-lake-city', b: 'santa-fe', cost: 28 },
    { a: 'las-vegas', b: 'los-angeles', cost: 9 },
    { a: 'las-vegas', b: 'san-diego', cost: 9 },
    { a: 'las-vegas', b: 'phoenix', cost: 15 },
    { a: 'las-vegas', b: 'santa-fe', cost: 27 },
    { a: 'los-angeles', b: 'san-diego', cost: 3 },
    { a: 'san-diego', b: 'phoenix', cost: 14 },
    { a: 'phoenix', b: 'santa-fe', cost: 18 },
    { a: 'santa-fe', b: 'kansas-city', cost: 16 },
    { a: 'santa-fe', b: 'oklahoma-city', cost: 15 },
    { a: 'santa-fe', b: 'dallas', cost: 16 },
    { a: 'santa-fe', b: 'houston', cost: 21 },

    // Midwest
    { a: 'fargo', b: 'duluth', cost: 6 },
    { a: 'fargo', b: 'minneapolis', cost: 6 },
    { a: 'duluth', b: 'minneapolis', cost: 5 },
    { a: 'duluth', b: 'chicago', cost: 12 },
    { a: 'duluth', b: 'detroit', cost: 15 },
    { a: 'minneapolis', b: 'chicago', cost: 8 },
    { a: 'chicago', b: 'st-louis', cost: 10 },
    { a: 'chicago', b: 'cincinnati', cost: 7 },
    { a: 'chicago', b: 'detroit', cost: 7 },
    { a: 'chicago', b: 'kansas-city', cost: 8 },
    { a: 'st-louis', b: 'kansas-city', cost: 6 },
    { a: 'st-louis', b: 'memphis', cost: 7 },
    { a: 'st-louis', b: 'atlanta', cost: 12 },
    { a: 'st-louis', b: 'cincinnati', cost: 12 },
    { a: 'cincinnati', b: 'detroit', cost: 4 },
    { a: 'cincinnati', b: 'pittsburgh', cost: 7 },
    { a: 'cincinnati', b: 'raleigh', cost: 15 },
    { a: 'cincinnati', b: 'knoxville', cost: 6 },
    { a: 'knoxville', b: 'atlanta', cost: 5 },

    // South
    { a: 'kansas-city', b: 'oklahoma-city', cost: 8 },
    { a: 'kansas-city', b: 'memphis', cost: 12 },
    { a: 'oklahoma-city', b: 'memphis', cost: 14 },
    { a: 'oklahoma-city', b: 'dallas', cost: 3 },
    { a: 'dallas', b: 'memphis', cost: 12 },
    { a: 'dallas', b: 'houston', cost: 5 },
    { a: 'dallas', b: 'new-orleans', cost: 12 },
    { a: 'houston', b: 'new-orleans', cost: 8 },
    { a: 'memphis', b: 'birmingham', cost: 6 },
    { a: 'memphis', b: 'new-orleans', cost: 7 },
    { a: 'new-orleans', b: 'birmingham', cost: 11 },
    { a: 'new-orleans', b: 'jacksonville', cost: 16 },
    { a: 'birmingham', b: 'atlanta', cost: 3 },
    { a: 'birmingham', b: 'jacksonville', cost: 9 },

    // Southeast
    { a: 'atlanta', b: 'raleigh', cost: 7 },
    { a: 'atlanta', b: 'savannah', cost: 7 },
    { a: 'raleigh', b: 'norfolk', cost: 3 },
    { a: 'raleigh', b: 'savannah', cost: 7 },
    { a: 'raleigh', b: 'pittsburgh', cost: 7 },
    { a: 'norfolk', b: 'washington-dc', cost: 5 },
    { a: 'savannah', b: 'jacksonville', cost: 0 },
    { a: 'jacksonville', b: 'tampa', cost: 4 },
    { a: 'tampa', b: 'miami', cost: 4 },

    // Northeast
    { a: 'detroit', b: 'buffalo', cost: 7 },
    { a: 'detroit', b: 'pittsburgh', cost: 6 },
    { a: 'buffalo', b: 'pittsburgh', cost: 7 },
    { a: 'buffalo', b: 'new-york', cost: 8 },
    { a: 'pittsburgh', b: 'washington-dc', cost: 6 },
    { a: 'washington-dc', b: 'philadelphia', cost: 3 },
    { a: 'philadelphia', b: 'new-york', cost: 0 },
    { a: 'new-york', b: 'boston', cost: 3 },
  ],
};
