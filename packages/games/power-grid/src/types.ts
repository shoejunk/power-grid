/**
 * Power Grid — authoritative domain model.
 *
 * This file is the contract every other package builds against: the rules
 * engine mutates these shapes, the server persists them, the client renders
 * them. Nothing here may depend on runtime environment (no DOM, no Node).
 *
 * Rule references in comments point at sections of
 * `power-grid-gameplay-requirements.md`.
 */

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

export type ResourceType = 'coal' | 'oil' | 'garbage' | 'uranium';

export const RESOURCE_TYPES: readonly ResourceType[] = ['coal', 'oil', 'garbage', 'uranium'] as const;

/** Count of each resource type; always all four keys present. */
export type ResourceBundle = Record<ResourceType, number>;

export const emptyResources = (): ResourceBundle => ({ coal: 0, oil: 0, garbage: 0, uranium: 0 });

export type MapId = 'germany' | 'usa';

export const MAP_IDS: readonly MapId[] = ['germany', 'usa'] as const;

/** Game Step. §10. */
export type Step = 1 | 2 | 3;

export type PlayerId = string;
export type CityId = string;
export type AreaId = string;

/* ------------------------------------------------------------------ *
 * Map data (§1 Board and map data)
 * ------------------------------------------------------------------ */

export interface MapArea {
  id: AreaId;
  /** Display name of the region. */
  name: string;
  /** Base hue used by the renderer for region tinting. */
  color: string;
  /** Areas sharing at least one connection with this one — used for contiguity checks. */
  adjacentAreas: AreaId[];
}

export interface MapCity {
  id: CityId;
  name: string;
  area: AreaId;
  /** Normalised board coordinates in [0,1]; renderer scales to canvas. */
  x: number;
  y: number;
  /**
   * Metropolis partner. A metropolis is a pair of city nodes that share a
   * nameplate; a player may hold a house in at most one of the pair. §1, §8.
   */
  metropolisPartner?: CityId;
}

export interface MapConnection {
  a: CityId;
  b: CityId;
  /** Elektro cost to traverse. May be 0. §1. */
  cost: number;
  /**
   * Optional path shaping for the renderer: normalised control points for the
   * quadratic/cubic curve drawn between the two cities.
   */
  waypoints?: { x: number; y: number }[];
}

export interface GameMap {
  id: MapId;
  name: string;
  areas: MapArea[];
  cities: MapCity[];
  connections: MapConnection[];
  /** Background art aspect ratio (width / height) for the renderer. */
  aspectRatio: number;
  rules: {
    /** Germany: buying plant 39 permanently stops uranium resupply. §12. */
    nuclearPhaseOutPlant?: number;
    /** USA: separate coal storage area, coal buyable at this price once market is dry. §12. */
    coalStorage?: { enabled: true; priceWhenMarketEmpty: number };
  };
}

/* ------------------------------------------------------------------ *
 * Power plants (§1 Power plants)
 * ------------------------------------------------------------------ */

export type PlantCategory = 'plug' | 'socket';

export interface PowerPlant {
  /** Printed number: minimum bid, market sort key, tie-break value. */
  id: number;
  category: PlantCategory;
  /**
   * Accepted resource types. Empty for ecological plants. Length 2 (coal+oil)
   * means hybrid: any mix totalling `fuel`.
   */
  accepts: ResourceType[];
  /** Tokens consumed per operation. 0 for ecological. */
  fuel: number;
  /** Cities powered when operated. */
  cities: number;
  /** True for the special Step 3 card. */
  isStep3?: boolean;
}

/** Sentinel id for the Step 3 card so it always sorts last. §10. */
export const STEP3_PLANT_ID = 9999;

export const isEcological = (p: PowerPlant): boolean => p.accepts.length === 0;
export const isHybrid = (p: PowerPlant): boolean => p.accepts.length > 1;

/** A plant can store at most twice its fuel requirement, across all accepted types. §1. */
export const storageCapacity = (p: PowerPlant): number => p.fuel * 2;

/* ------------------------------------------------------------------ *
 * Owned plants
 * ------------------------------------------------------------------ */

export interface OwnedPlant {
  plantId: number;
  /** Tokens currently stored on this plant. Only `accepts` types may be non-zero. */
  stored: ResourceBundle;
}

/* ------------------------------------------------------------------ *
 * Resource market (§1 Resources, §9.2)
 * ------------------------------------------------------------------ */

export interface MarketSpace {
  /** Elektro paid per token taken from this space. */
  price: number;
  /** How many tokens this space holds when full. */
  capacity: number;
  /** How many tokens are on it now. */
  filled: number;
}

export type ResourceMarket = Record<ResourceType, MarketSpace[]>;

/* ------------------------------------------------------------------ *
 * Players
 * ------------------------------------------------------------------ */

export type PlayerColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'black';

export const PLAYER_COLORS: readonly PlayerColor[] = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'black',
] as const;

/** Per-phase status exposed for the UI. §4. */
export type PhaseStatus = 'eligible' | 'acting' | 'purchased' | 'passed' | 'acted' | 'ineligible';

export interface Player {
  id: PlayerId;
  name: string;
  color: PlayerColor;
  /** True for the automated Trust faction in the 2-player variant. §13. */
  isTrust: boolean;
  /** True when driven by the built-in AI rather than a seated human. */
  isBot: boolean;
  money: number;
  /** Houses remaining in the player's supply. 22 for humans, 16(+1) for the Trust. */
  housesRemaining: number;
  plants: OwnedPlant[];
  /** Cities where this player has a house. */
  cities: CityId[];
  /** 0-based index into `GameState.playerOrder`. */
  orderIndex: number;
  phaseStatus: PhaseStatus;
  /** Optional experienced-player setup choice; its map marker is neutral until claimed. §2. */
  markedStartCity?: CityId;
  /** Set once the player has taken their first house off the board. */
  hasNetwork: boolean;
  connected: boolean;
  lastSeen: number;
}

/* ------------------------------------------------------------------ *
 * Auction state (§6)
 * ------------------------------------------------------------------ */

export interface AuctionState {
  /** Plant currently under the hammer. */
  plantId: number;
  /** Player who put it up. */
  auctioneerId: PlayerId;
  /** Public floor minus one while sealed decisions are being collected. */
  currentBid: number;
  /** Null while sealed decisions are being collected. */
  highBidderId: PlayerId | null;
  /** Eligible players, retained for older clients that render a bid ladder. */
  activeBidders: PlayerId[];
  /** First outstanding decision; other eligible players may still answer now. */
  currentBidderId: PlayerId;
  /** True when the plant's minimum bid is 1 because of the discount token. §6. */
  discounted: boolean;
  /** Every human who may take part, in table order beginning with the auctioneer. */
  eligibleBidders: PlayerId[];
  /**
   * Simultaneous sealed decisions. Missing means the player has not answered.
   * Server views replace another player's answer with `submitted` so bid
   * ranges never leak while commitments are being collected.
   */
  commitments: Partial<Record<PlayerId, AuctionCommitment>>;
}

export type AuctionCommitment =
  | { status: 'bid'; minBid: number; maxBid: number }
  | { status: 'pass' }
  | { status: 'submitted' };

/** Pending "scrap a plant" decision after acquiring a 4th plant. §6. */
export interface PendingScrap {
  playerId: PlayerId;
  /** The newly acquired plant, which may not be scrapped. */
  newPlantId: number;
}

/* ------------------------------------------------------------------ *
 * Phases (§3)
 * ------------------------------------------------------------------ */

export type Phase =
  | 'setup'
  | 'order'        // Phase 1 — Determine Player Order
  | 'auction'      // Phase 2 — Auction Power Plants
  | 'resources'    // Phase 3 — Buy Resources
  | 'building'     // Phase 4 — Build Houses
  | 'bureaucracy'  // Phase 5 — Bureaucracy
  | 'gameOver';

export const PHASE_ORDER: readonly Phase[] = ['order', 'auction', 'resources', 'building', 'bureaucracy'] as const;

/** Sub-state of setup, so hosts can drive zone/starting-city flows. §2. */
export type SetupStage =
  | 'lobby'
  | 'zoneSelection'
  | 'trustPlacement'
  | 'startingCities'
  | 'complete';

/* ------------------------------------------------------------------ *
 * Plant market (§1, §9.3)
 * ------------------------------------------------------------------ */

export interface PlantMarket {
  /** Four lowest plants (six in Step 3), available for auction. */
  current: number[];
  /** Higher plants, not biddable. Empty in Step 3. */
  future: number[];
  /** Face-down supply stack, top of stack at index 0. */
  stack: number[];
  /** Cards removed from the game (setup removals, scrapped, discarded). */
  removed: number[];
  /** Plant carrying the discount token, or null once it sits beside the market. §6. */
  discountPlantId: number | null;
  /**
   * True while the discount token is on a plant: the next replacement drawn
   * with a lower printed number must itself be removed. §6.
   */
  discountReplacementRuleArmed: boolean;
  /** True once the Step 3 card has entered the market. §10. */
  step3CardRevealed: boolean;
}

/* ------------------------------------------------------------------ *
 * Bureaucracy state (§9)
 * ------------------------------------------------------------------ */

export interface PowerDecision {
  /** Plants the player elects to operate this round. */
  operatePlantIds: number[];
  /** How many of their cities to actually supply (may be fewer than capacity). */
  citiesSupplied: number;
}

/* ------------------------------------------------------------------ *
 * Game state
 * ------------------------------------------------------------------ */

export interface GameSettings {
  mapId: MapId;
  playerCount: number;
  /** Optional experienced-player starting-city rule. §2. */
  experiencedStart: boolean;
  /** 2-player Against the Trust variant. §13. */
  againstTheTrust: boolean;
  /** Seed for every random operation, so setup is replayable. §14. */
  seed: string;
}

export interface GameState {
  /** Schema version, so persisted games can be migrated. */
  version: number;
  gameId: string;
  /** Short human-shareable join code. */
  code: string;
  hostId: PlayerId;
  settings: GameSettings;

  phase: Phase;
  setupStage: SetupStage;
  step: Step;
  round: number;

  /** Areas making up the playing zone for this game. §1. */
  zone: AreaId[];

  players: Record<PlayerId, Player>;
  /** Player ids ranked first-to-last for the current round. §4. */
  playerOrder: PlayerId[];

  /** Whose input the engine is waiting on; null when resolving automatically. */
  activePlayerId: PlayerId | null;

  plantMarket: PlantMarket;
  resourceMarket: ResourceMarket;
  /** Tokens not on the market and not on a plant. §1. */
  supply: ResourceBundle;
  /** USA only: coal returned from production, feeds later refills. §12. */
  usaCoalStorage: number;

  /** Houses placed per city, in slot order. Index 0 = 10₤ slot, 1 = 15₤, 2 = 20₤. */
  citySlots: Record<CityId, (PlayerId | null)[]>;

  auction: AuctionState | null;
  pendingScrap: PendingScrap | null;

  /** Players who have already acquired a plant this round. §6. */
  acquiredThisRound: PlayerId[];
  /** Players permanently out of this round's auction phase. §6. */
  passedThisPhase: PlayerId[];

  /** Germany: set once plant 39 is bought; uranium never resupplies again. §12. */
  uraniumPhaseOut: boolean;

  /** Set at end of Phase 4 when a player reaches the city threshold. §11. */
  endGameTriggered: boolean;
  winnerId: PlayerId | null;

  /** Deterministic RNG cursor — advanced on every random draw. §14. */
  rngCursor: number;

  log: LogEntry[];
  createdAt: number;
  updatedAt: number;
}

/* ------------------------------------------------------------------ *
 * Rules / effects log (§14 Determinism and auditability)
 * ------------------------------------------------------------------ */

export type LogCategory =
  | 'setup'
  | 'order'
  | 'auction'
  | 'bid'
  | 'payment'
  | 'resource'
  | 'build'
  | 'power'
  | 'market'
  | 'step'
  | 'trust'
  | 'endgame'
  | 'system';

export interface LogEntry {
  id: number;
  round: number;
  phase: Phase;
  step: Step;
  category: LogCategory;
  /** Player the entry is about, when applicable. */
  playerId?: PlayerId;
  /** Human-readable sentence rendered in the log panel. */
  message: string;
  /** Structured payload so the UI can animate the transition it describes. */
  data?: Record<string, unknown>;
  at: number;
}

/* ------------------------------------------------------------------ *
 * Actions — every legal player input. The server validates and applies.
 * ------------------------------------------------------------------ */

export type GameAction =
  /* setup */
  | { type: 'selectZone'; areas: AreaId[] }
  | { type: 'markStartCity'; cityId: CityId }
  | { type: 'placeTrustHouse'; cityId: CityId }
  | { type: 'startGame' }
  /* phase 2 — auction */
  | { type: 'nominatePlant'; plantId: number; bid: number; maxBid?: number }
  | { type: 'passNomination' }
  | { type: 'submitBidRange'; minBid: number; maxBid: number }
  | { type: 'bid'; amount: number }
  | { type: 'passBid' }
  | { type: 'scrapPlant'; plantId: number }
  /* phase 3 — resources */
  | { type: 'buyResources'; purchases: { resource: ResourceType; count: number }[] }
  | { type: 'redistributeResources'; assignment: { plantId: number; stored: ResourceBundle }[] }
  | { type: 'passResources' }
  /* phase 4 — building */
  | { type: 'buildCity'; cityId: CityId }
  | { type: 'passBuilding' }
  /* phase 5 — bureaucracy */
  | { type: 'powerCities'; decision: PowerDecision }
  /* meta */
  | { type: 'undoLastBuild' };

export interface ActionEnvelope {
  playerId: PlayerId;
  action: GameAction;
  /** Client-side id so the UI can correlate acks. */
  nonce?: string;
}

/** Result of validating an action against the current state. */
export type ValidationResult = { ok: true } | { ok: false; reason: string };

/*
 * Lobbies, seats, sessions and the wire protocol used to live here. They are
 * not Power Grid concepts — every game on the platform needs them in exactly
 * the same shape — so they now live in `@tt/core` and reach this package
 * through `plugin.ts` alone. Keeping them out of this file is what makes the
 * separation real rather than nominal.
 */
