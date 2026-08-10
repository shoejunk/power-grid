/**
 * Bot policy — what a computer-controlled seat actually wants to do.
 *
 * The previous behaviour was "make the least presumptuous legal move": pass on
 * every bid, buy no fuel, build no houses. That is the right answer for a
 * safety net and a useless answer for an opponent — such a seat powers nothing,
 * collects the 10₤ consolation payment forever and never contests anything.
 *
 * This module replaces it with a plan. The plan is one round deep and is
 * rebuilt from scratch at **every single decision**, because everything it
 * rests on moves underneath it: a plant can be bid away, a resource can sell
 * out before the bot's turn in Phase 3 comes round, a city can be taken in
 * Phase 4 by someone earlier in reverse order, and a sealed auction can settle
 * above the price the bot budgeted for.
 *
 * `planRound` is the whole idea. Given a hypothetical wallet and plant set it
 * answers one question — *how many cities would I be powering at the end of
 * this round?* — by choosing, jointly:
 *
 *   1. which plants to run, and therefore what fuel to buy (§7), and
 *   2. how many houses to connect with what is left (§8),
 *
 * under the two constraints that make the answer honest:
 *
 *   - fuel and houses come out of the same wallet, so the plant bought in
 *     Phase 2 has to leave enough behind to feed and use itself, and
 *   - **a house that cannot be powered is never built** — `k` is capped by the
 *     production capacity of the plants the plan intends to run.
 *
 * Every other decision is expressed in terms of that number. Bidding compares
 * the plan after winning the plant at price P against the plan after taking the
 * best alternative on the table, and the sealed maximum is the largest P where
 * the plant still wins that comparison. Nothing here consults the RNG or the
 * clock: like the rest of the engine it is a pure function of state (§14).
 */

import type {
  CityId,
  GameAction,
  GameState,
  PlayerId,
  ResourceBundle,
  ResourceType,
} from '../types.js';
import { RESOURCE_TYPES, emptyResources } from '../types.js';
import { getPlant } from '../data/plants.js';
import { MAX_PLANTS_PER_PLAYER, USA_COAL_STORAGE_PRICE, payoutFor } from './constants.js';
import { getPlayer, humanPlayers } from './state.js';
import { bestSupply, fuelSlots } from './production.js';
import { endGameThreshold } from './endgame.js';
import { maxFlowAssign, poolFits, slotsSaturated, type PlantSlot } from './allocation.js';
import { storedPool, usesCoalStorage } from './resources.js';
import { buildTargets } from './building.js';
import { minimumBid } from './plantMarket.js';
import { cheapestRoutes, stateMap } from './mapAccess.js';
import type { LegalActions } from './legal.js';

/* ------------------------------------------------------------------ *
 * Tuning
 *
 * These are the only free numbers in the module. They trade a round of income
 * against cash in hand; everything else is derived from the rules.
 * ------------------------------------------------------------------ */

/**
 * Rounds of income a plan is credited with. Higher = more willing to invest.
 */
const INCOME_ROUNDS = 2;
/**
 * Worth of one *powered* city beyond the income it earns, in Elektro.
 *
 * Without this the plan is a one-round cash-flow calculation, and a bot with a
 * large network hoards: the eighth city earns about 9₤ a round, which two
 * rounds of income cannot justify against a 25₤ connection. But §11 ends the
 * game on city count and decides it on cities powered, so a house is a claim on
 * the win as well as an income stream — and the connection only gets dearer as
 * rivals take the cheap slots. `planRound` has already proved every plan
 * affordable, so paying above one round's return here is not a solvency risk.
 */
const POWERED_CITY_VALUE = 20;
/** Worth of one point of production capacity the bot cannot use *yet*. */
const SPARE_CAPACITY_VALUE = 6;
/** How far ahead spare capacity is assumed to find houses to power. */
const FUTURE_BUILD_HEADROOM = 3;
/** Small credit for printed capacity that is currently unfuelled but ownable. */
const PRINTED_CAPACITY_VALUE = 1;
/**
 * Cash the bot treats as worth its face value: roughly a plant, its fuel and a
 * couple of connections. Money beyond this is counted at `SURPLUS_CASH_VALUE`.
 *
 * Elektro is only ever a means to plants, fuel and houses, plus a tie-break at
 * the very end (§11). A bot sitting on ten times what a turn can absorb is not
 * ten times better off, and scoring it as though it were is what makes an
 * engine hoard: every marginal connection loses to the cash it costs. The
 * kink puts the early game — where 50₤ really is the whole plan — on a
 * face-value footing, and stops the late game from being a savings account.
 */
const WORKING_CAPITAL = 80;
const SURPLUS_CASH_VALUE = 0.2;
/**
 * How much of a rival plant's advantage counts as a real alternative. Below 1
 * because a plant left on the market may be taken before the bot's next turn.
 */
const RIVAL_PLANT_DISCOUNT = 0.8;
/** Cash held back from stockpiling so the next round's auction is not skipped. */
const AUCTION_RESERVE = 25;
/** Depth of the connection ladder. Beyond this, money runs out long before. */
const MAX_PLANNED_BUILDS = 10;
/** Price assumed for a resource that is sold out, when comparing burn costs. */
const SOLD_OUT_PRICE = 20;
/** Neighbours summed when scoring a starting city for connectivity. §2. */
const START_CITY_NEIGHBOURS = 5;

function cashValue(money: number): number {
  if (money <= WORKING_CAPITAL) return money;
  return WORKING_CAPITAL + (money - WORKING_CAPITAL) * SURPLUS_CASH_VALUE;
}

/* ------------------------------------------------------------------ *
 * Bundles
 * ------------------------------------------------------------------ */

function addBundles(a: ResourceBundle, b: ResourceBundle): ResourceBundle {
  const out = emptyResources();
  for (const t of RESOURCE_TYPES) out[t] = (a[t] ?? 0) + (b[t] ?? 0);
  return out;
}

function bundleKey(b: ResourceBundle): string {
  return RESOURCE_TYPES.map((t) => b[t] ?? 0).join('/');
}

/** Storage slots — 2× fuel per plant — for a hypothetical plant set. §1. */
function storageSlotsFor(plantIds: readonly number[]): PlantSlot[] {
  return plantIds.map((id) => {
    const p = getPlant(id);
    return { accepts: p.accepts.slice(), cap: p.fuel * 2 };
  });
}

/**
 * The part of `pool` that would survive on `storage`. Mirrors what the engine
 * does when a plant is scrapped: tokens are relaid across the remaining plants
 * and the overflow is lost to the supply. §6.
 */
function clampPool(pool: ResourceBundle, storage: readonly PlantSlot[]): ResourceBundle {
  const { alloc } = maxFlowAssign(pool, storage);
  const out = emptyResources();
  for (const row of alloc) {
    RESOURCE_TYPES.forEach((t, i) => {
      out[t] += row[i] ?? 0;
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Planning context — everything that is fixed for one decision
 * ------------------------------------------------------------------ */

interface BuildLadder {
  /** Cities in the order the bot would connect them, cheapest first. */
  cities: CityId[];
  /** `cumulative[k]` is the cost of connecting the first `k` of them. */
  cumulative: number[];
}

interface BotContext {
  state: GameState;
  playerId: PlayerId;
  /** Cities already connected — the ceiling on what can be powered today. */
  network: number;
  ladder: BuildLadder;
  /** Per resource, the price of each successive token, cheapest first. §7, §12. */
  prices: Record<ResourceType, number[]>;
  /** Memo for `fuelChoices`, which is by far the most expensive thing here. */
  fuelCache: Map<string, FuelChoice[]>;
}

function makeContext(state: GameState, playerId: PlayerId): BotContext {
  const player = getPlayer(state, playerId);
  return {
    state,
    playerId,
    network: player.cities.length,
    ladder: buildLadder(state, playerId),
    prices: {
      coal: unitPrices(state, 'coal'),
      oil: unitPrices(state, 'oil'),
      garbage: unitPrices(state, 'garbage'),
      uranium: unitPrices(state, 'uranium'),
    },
    fuelCache: new Map(),
  };
}

/**
 * Price of each token still buyable, cheapest first. Equivalent to walking
 * `purchaseCost` one token at a time, but reusable for "which single token is
 * cheapest right now" questions. §7, §12.
 */
function unitPrices(state: GameState, type: ResourceType): number[] {
  const out: number[] = [];
  for (const space of state.resourceMarket[type]) {
    for (let i = 0; i < space.filled; i++) out.push(space.price);
  }
  // §12 USA: once the market is dry, coal keeps coming from storage at a flat price.
  if (out.length === 0 && type === 'coal' && usesCoalStorage(state)) {
    for (let i = 0; i < state.usaCoalStorage; i++) out.push(USA_COAL_STORAGE_PRICE);
  }
  return out;
}

/**
 * The cities the bot would connect, in order, with the running total.
 *
 * Connecting one city changes the route cost of every other, so this replays
 * the greedy choice against a scratch copy of the board rather than adding up
 * today's prices. The copy is deliberately shallow apart from the two things
 * `buildTargets` reads and this loop writes.
 */
function buildLadder(state: GameState, playerId: PlayerId): BuildLadder {
  const player = getPlayer(state, playerId);
  const limit = Math.min(MAX_PLANNED_BUILDS, player.housesRemaining);
  const cities: CityId[] = [];
  const cumulative = [0];
  if (limit <= 0) return { cities, cumulative };

  const sim: GameState = {
    ...state,
    log: [],
    citySlots: Object.fromEntries(
      Object.entries(state.citySlots).map(([id, slots]) => [id, slots.slice()]),
    ),
    players: { ...state.players, [playerId]: { ...player, cities: player.cities.slice() } },
  };
  const scratch = sim.players[playerId]!;

  for (let k = 0; k < limit; k++) {
    // `buildTargets` sorts by total cost, so index 0 is the greedy next city.
    const target = buildTargets(sim, playerId)[0];
    if (!target) break;
    sim.citySlots[target.cityId]![target.slot] = playerId;
    scratch.cities.push(target.cityId);
    scratch.housesRemaining -= 1;
    scratch.hasNetwork = true;
    cities.push(target.cityId);
    cumulative.push(cumulative[k]! + target.total);
  }
  return { cities, cumulative };
}

/* ------------------------------------------------------------------ *
 * Fuel
 * ------------------------------------------------------------------ */

interface FuelChoice {
  /** Plants this choice intends to operate in Phase 5. */
  plantIds: number[];
  /** Cities they would supply between them. §1. */
  capacity: number;
  /** Tokens that must be bought to saturate them. §7. */
  buy: ResourceBundle;
  cost: number;
}

/**
 * Every set of plants the player could run this round, with the cheapest
 * purchase that makes each one operable.
 *
 * §1 is strict — a plant runs on *exactly* its printed requirement — so this is
 * a saturation question, not an arithmetic one, and hybrids make it a matching
 * problem. The greedy loop buys the cheapest token that increases the flow,
 * which is optimal here because every token is interchangeable within a type.
 *
 * Deliberately not budget-aware: the cost is reported and `planRound` decides
 * what is affordable. That keeps the result cacheable across the many wallets
 * a bid search asks about.
 */
function fuelChoices(
  ctx: BotContext,
  plantIds: readonly number[],
  pool: ResourceBundle,
  allowBuying: boolean,
): FuelChoice[] {
  const ids = [...plantIds].sort((a, b) => a - b);
  const key = `${ids.join(',')}|${bundleKey(pool)}|${allowBuying ? 'buy' : 'hold'}`;
  const cached = ctx.fuelCache.get(key);
  if (cached) return cached;

  const storage = storageSlotsFor(ids);
  const out: FuelChoice[] = [];
  for (let mask = 0; mask < 1 << ids.length; mask++) {
    const subset = ids.filter((_, i) => (mask & (1 << i)) !== 0);
    const slots = fuelSlots(subset);
    const capacity = subset.reduce((s, id) => s + getPlant(id).cities, 0);
    if (slotsSaturated(pool, slots)) {
      out.push({ plantIds: subset, capacity, buy: emptyResources(), cost: 0 });
      continue;
    }
    if (!allowBuying) continue;
    const purchase = purchaseToward(ctx, pool, slots, storage);
    if (purchase.saturated) {
      out.push({ plantIds: subset, capacity, buy: purchase.buy, cost: purchase.cost });
    }
  }
  ctx.fuelCache.set(key, out);
  return out;
}

interface Purchase {
  buy: ResourceBundle;
  cost: number;
  /** True when `pool + buy` fills every slot exactly, so the set can operate. §1. */
  saturated: boolean;
}

/**
 * Buys the cheapest tokens that bring `pool` closer to filling `slots`, and
 * reports whether it got all the way there.
 *
 * Partial results are the point. §1 will not let a plant run on less than its
 * printed requirement, so a bot that only ever buys complete loads buys nothing
 * at all once the market thins out — and then never buys again, because the
 * market it is waiting for is being emptied every round by whoever *can* still
 * complete a load. Tokens keep, so a half-load bought now is a full load next
 * round. Callers that need certainty check `saturated`.
 *
 * `from` continues an earlier purchase: the accumulated counts index into the
 * price ladder, so successive calls keep paying the right escalating price.
 */
function purchaseToward(
  ctx: BotContext,
  pool: ResourceBundle,
  slots: readonly PlantSlot[],
  storage: readonly PlantSlot[],
  budget = Infinity,
  from?: Purchase,
): Purchase {
  const buy = from ? { ...from.buy } : emptyResources();
  let cost = from ? from.cost : 0;

  // One token per iteration; the guard is well above the 12 that filling the
  // storage of three plants can ever need.
  for (let guard = 0; guard <= 32; guard++) {
    const combined = addBundles(pool, buy);
    if (slotsSaturated(combined, slots)) return { buy, cost, saturated: true };
    const baseline = maxFlowAssign(combined, slots).flow;

    let pick: { type: ResourceType; price: number } | null = null;
    for (const t of RESOURCE_TYPES) {
      const available = ctx.prices[t];
      if (buy[t] >= available.length) continue;
      const trial = { ...combined };
      trial[t] += 1;
      // Only tokens that actually get the set closer to running are worth buying.
      if (maxFlowAssign(trial, slots).flow <= baseline) continue;
      if (!poolFits(trial, storage)) continue;
      const price = available[buy[t]]!;
      if (!pick || price < pick.price) pick = { type: t, price };
    }
    if (!pick || cost + pick.price > budget) return { buy, cost, saturated: false };
    buy[pick.type] += 1;
    cost += pick.price;
  }
  /* istanbul ignore next — unreachable while storage is capped at 2× fuel */
  return { buy, cost, saturated: slotsSaturated(addBundles(pool, buy), slots) };
}

/* ------------------------------------------------------------------ *
 * The plan
 * ------------------------------------------------------------------ */

interface RoundPlan {
  /** Plants to run in Phase 5. */
  operate: number[];
  /** Cities those plants supply. */
  capacity: number;
  /** Fuel to buy in Phase 3. */
  buy: ResourceBundle;
  fuelCost: number;
  /** Cities to connect in Phase 4, in order. */
  buildCities: CityId[];
  buildCost: number;
  /** Cities actually powered at the end of the round — the thing being maximised. */
  powered: number;
  leftover: number;
  score: number;
}

const EMPTY_PLAN = (money: number): RoundPlan => ({
  operate: [],
  capacity: 0,
  buy: emptyResources(),
  fuelCost: 0,
  buildCities: [],
  buildCost: 0,
  powered: 0,
  leftover: money,
  score: -Infinity,
});

/**
 * Best joint choice of fuel and houses for a hypothetical wallet and plant set.
 *
 * The search is small enough to be exhaustive: at most eight operable subsets
 * of at most three plants, crossed with the connection ladder. `k` never
 * exceeds `capacity - network`, which is the rule that stops the bot connecting
 * cities it could not light.
 */
function planRound(
  ctx: BotContext,
  plantIds: readonly number[],
  pool: ResourceBundle,
  money: number,
  allowBuying: boolean,
): RoundPlan {
  const printed = plantIds.reduce((s, id) => s + getPlant(id).cities, 0);
  let best = EMPTY_PLAN(money);

  for (const choice of fuelChoices(ctx, plantIds, pool, allowBuying)) {
    if (choice.cost > money) continue;
    const maxBuilds = Math.max(
      0,
      Math.min(choice.capacity - ctx.network, ctx.ladder.cities.length),
    );
    for (let k = 0; k <= maxBuilds; k++) {
      const buildCost = ctx.ladder.cumulative[k]!;
      const spend = choice.cost + buildCost;
      if (spend > money) break;

      const powered = Math.min(ctx.network + k, choice.capacity);
      const leftover = money - spend;
      // Capacity beyond what the bot can plausibly connect soon is not income.
      const usable = Math.min(choice.capacity, ctx.network + k + FUTURE_BUILD_HEADROOM);
      const score =
        INCOME_ROUNDS * payoutFor(powered) +
        POWERED_CITY_VALUE * powered +
        SPARE_CAPACITY_VALUE * usable +
        PRINTED_CAPACITY_VALUE * printed +
        cashValue(leftover);

      if (score > best.score) {
        best = {
          operate: choice.plantIds.slice(),
          capacity: choice.capacity,
          buy: { ...choice.buy },
          fuelCost: choice.cost,
          buildCities: ctx.ladder.cities.slice(0, k),
          buildCost,
          powered,
          leftover,
          score,
        };
      }
    }
  }
  // The empty subset always qualifies at cost 0, so `best` is always real.
  return best;
}

/* ------------------------------------------------------------------ *
 * Valuing a plant (§6)
 * ------------------------------------------------------------------ */

/** Plant sets the player would end up with after acquiring `plantId`. §6. */
function setsAfterAcquiring(owned: readonly number[], plantId: number): number[][] {
  if (owned.length < MAX_PLANTS_PER_PLAYER) return [[...owned, plantId]];
  // At the limit the purchase forces a scrap, and which plant goes is part of
  // the decision — so every survivor set is a candidate.
  return owned.map((_, i) => [...owned.filter((_, j) => j !== i), plantId]);
}

/** Value of owning `plantId` at price `price`, after the forced scrap if any. */
function utilityAfterBuying(
  ctx: BotContext,
  owned: readonly number[],
  pool: ResourceBundle,
  money: number,
  plantId: number,
  price: number,
): number {
  if (price > money) return -Infinity;
  let best = -Infinity;
  for (const set of setsAfterAcquiring(owned, plantId)) {
    const kept = clampPool(pool, storageSlotsFor(set));
    const plan = planRound(ctx, set, kept, money - price, true);
    if (plan.score > best) best = plan.score;
  }
  return best;
}

/**
 * The bar a purchase has to clear: what the bot gets by walking away.
 *
 * Not simply "the value of passing" — a plant left in the market is a genuine
 * alternative the bot may nominate later, so the best of those counts too,
 * discounted because someone else may take it first. Using the alternative
 * rather than "no plant at all" is what stops the bot paying its whole wallet
 * for the first plant it sees during the §6 mandatory first-round purchase.
 */
function alternativeUtility(passUtility: number, rivalBest: number): number {
  if (!Number.isFinite(rivalBest) || rivalBest <= passUtility) return passUtility;
  return passUtility + RIVAL_PLANT_DISCOUNT * (rivalBest - passUtility);
}

/**
 * Highest price at which the plant still beats `alternative`, or `floor - 1`
 * when it never does. This is the sealed maximum bid: utility falls
 * monotonically as the price rises, so a binary search finds the crossing.
 */
function bidCeiling(
  ctx: BotContext,
  owned: readonly number[],
  pool: ResourceBundle,
  money: number,
  plantId: number,
  floor: number,
  alternative: number,
): number {
  if (floor > money) return floor - 1;
  const value = (price: number) => utilityAfterBuying(ctx, owned, pool, money, plantId, price);
  if (value(floor) < alternative) return floor - 1;

  let lo = floor;
  let hi = money;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (value(mid) >= alternative) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Best value obtainable from any *other* current-market plant, at its floor. §6. */
function rivalPlantUtility(
  ctx: BotContext,
  owned: readonly number[],
  pool: ResourceBundle,
  money: number,
  excludePlantId: number | null,
): number {
  let best = -Infinity;
  for (const id of ctx.state.plantMarket.current) {
    if (id === excludePlantId || getPlant(id).isStep3) continue;
    const floor = minimumBid(ctx.state, id);
    if (floor > money) continue;
    const value = utilityAfterBuying(ctx, owned, pool, money, id, floor);
    if (value > best) best = value;
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * The move the bot wants to make, or null when it has no opinion and the
 * conservative default should be used instead.
 *
 * Callers must still validate: this is a policy, not an authority.
 */
export function botActionFor(
  state: GameState,
  playerId: PlayerId,
  legal: LegalActions,
): GameAction | null {
  const ctx = makeContext(state, playerId);
  switch (state.phase) {
    case 'setup':
      return setupAction(state, legal);
    case 'auction':
      return auctionAction(ctx, legal);
    case 'resources':
      return resourcesAction(ctx);
    case 'building':
      return buildingAction(ctx, legal);
    case 'bureaucracy':
      return bureaucracyAction(ctx, legal);
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * Phase 2 — Auction Power Plants (§6)
 * ------------------------------------------------------------------ */

function auctionAction(ctx: BotContext, legal: LegalActions): GameAction | null {
  if (legal.scrappablePlants.length > 0) return scrapAction(ctx, legal);
  if (legal.bidding) return bidAction(ctx, legal);
  if (legal.nominatablePlants.length > 0) return nominateAction(ctx, legal);
  return legal.canPassNomination ? { type: 'passNomination' } : null;
}

function nominateAction(ctx: BotContext, legal: LegalActions): GameAction | null {
  const player = getPlayer(ctx.state, ctx.playerId);
  const owned = player.plants.map((p) => p.plantId);
  const pool = storedPool(ctx.state, ctx.playerId);
  const money = player.money;

  const affordable = legal.nominatablePlants.filter((p) => p.affordable);
  if (affordable.length === 0) {
    // §6 releases a player who cannot meet any minimum bid, so passing is legal.
    return legal.canPassNomination ? { type: 'passNomination' } : null;
  }

  const ranked = affordable
    .map((p) => ({
      ...p,
      utility: utilityAfterBuying(ctx, owned, pool, money, p.plantId, p.minimumBid),
    }))
    .sort((a, b) => b.utility - a.utility || a.plantId - b.plantId);

  const best = ranked[0]!;
  const passUtility = planRound(ctx, owned, pool, money, true).score;
  const mustBuy = !legal.canPassNomination;

  // Nothing in the market beats keeping the cash — and §6 lets us say so.
  if (!mustBuy && best.utility <= passUtility) return { type: 'passNomination' };

  const rivalBest = ranked.length > 1 ? ranked[1]!.utility : -Infinity;
  const ceiling = bidCeiling(
    ctx,
    owned,
    pool,
    money,
    best.plantId,
    best.minimumBid,
    alternativeUtility(passUtility, rivalBest),
  );

  // §6: with nobody left to raise, the nominated plant costs exactly its minimum.
  const maxBid = best.uncontested
    ? best.minimumBid
    : Math.min(money, Math.max(best.minimumBid, ceiling));

  return { type: 'nominatePlant', plantId: best.plantId, bid: best.minimumBid, maxBid };
}

/**
 * Sealed response to a running auction. §6.
 *
 * The minimum is always the floor: the engine replays an ordinary clockwise
 * auction from these ranges and raises by one Elektro at a time, so opening
 * above the floor only ever pays more for the same plant. All the judgement
 * lives in the maximum.
 */
function bidAction(ctx: BotContext, legal: LegalActions): GameAction {
  const bidding = legal.bidding!;
  if (!bidding.canRaise) return { type: 'passBid' };

  const player = getPlayer(ctx.state, ctx.playerId);
  const owned = player.plants.map((p) => p.plantId);
  const pool = storedPool(ctx.state, ctx.playerId);
  const money = player.money;
  const floor = bidding.minimumRaise;

  const passUtility = planRound(ctx, owned, pool, money, true).score;
  const rivalBest = rivalPlantUtility(ctx, owned, pool, money, bidding.plantId);
  const ceiling = bidCeiling(
    ctx,
    owned,
    pool,
    money,
    bidding.plantId,
    floor,
    alternativeUtility(passUtility, rivalBest),
  );

  if (ceiling < floor) return { type: 'passBid' };
  return {
    type: 'submitBidRange',
    minBid: floor,
    maxBid: Math.min(bidding.maximumBid, Math.max(floor, ceiling)),
  };
}

/** Give up the plant whose loss costs the least production. §6. */
function scrapAction(ctx: BotContext, legal: LegalActions): GameAction {
  const player = getPlayer(ctx.state, ctx.playerId);
  const owned = player.plants.map((p) => p.plantId);
  const pool = storedPool(ctx.state, ctx.playerId);

  let best: { plantId: number; score: number } | null = null;
  for (const plantId of legal.scrappablePlants) {
    const survivors = owned.filter((id) => id !== plantId);
    const kept = clampPool(pool, storageSlotsFor(survivors));
    const score = planRound(ctx, survivors, kept, player.money, true).score;
    if (!best || score > best.score || (score === best.score && plantId < best.plantId)) {
      best = { plantId, score };
    }
  }
  return { type: 'scrapPlant', plantId: best!.plantId };
}

/* ------------------------------------------------------------------ *
 * Phase 3 — Buy Resources (§7)
 * ------------------------------------------------------------------ */

function resourcesAction(ctx: BotContext): GameAction {
  const player = getPlayer(ctx.state, ctx.playerId);
  const plantIds = player.plants.map((p) => p.plantId);
  const pool = storedPool(ctx.state, ctx.playerId);
  const plan = planRound(ctx, plantIds, pool, player.money, true);

  /*
   * Start from what this round's plan needs, then spend forwards — but only out
   * of money the plan has already proved it does not need for this round's
   * houses, and only down to a reserve that keeps the bot in next round's
   * auction.
   *
   * Two further targets, in order: one operating load for *every* plant owned
   * (not just the ones being run this round), then a second load on top. The
   * second is ordinary stockpiling — prices only rise as rivals buy (§9.2). The
   * first is what keeps a bot alive in a thin market: it accumulates towards
   * plants it cannot yet fire, instead of waiting for a full load that a richer
   * rival will always take first.
   *
   * Storage caps at twice a plant's requirement (§1), so the second target is
   * a full hold and the sequence terminates: once reached, the next pass
   * through here buys nothing and the bot moves on to Phase 4.
   */
  let acc: Purchase = { buy: plan.buy, cost: plan.fuelCost, saturated: true };
  const budget = plan.fuelCost + Math.max(0, plan.leftover - AUCTION_RESERVE);
  if (budget > acc.cost) {
    const storage = storageSlotsFor(plantIds);
    acc = purchaseToward(ctx, pool, fuelSlots(plantIds), storage, budget, acc);
    acc = purchaseToward(ctx, pool, fuelSlots([...plantIds, ...plantIds]), storage, budget, acc);
  }

  const purchases = RESOURCE_TYPES.filter((t) => acc.buy[t] > 0).map((t) => ({
    resource: t,
    count: acc.buy[t],
  }));
  if (purchases.length === 0) return { type: 'passResources' };
  return { type: 'buyResources', purchases };
}

/* ------------------------------------------------------------------ *
 * Phase 4 — Build Houses (§8)
 * ------------------------------------------------------------------ */

function buildingAction(ctx: BotContext, legal: LegalActions): GameAction {
  const player = getPlayer(ctx.state, ctx.playerId);
  const plantIds = player.plants.map((p) => p.plantId);
  const pool = storedPool(ctx.state, ctx.playerId);

  // No more fuel can be bought in Phase 4, so the plan is limited to what is
  // already on the plants — which is exactly the capacity that caps building.
  const plan = planRound(ctx, plantIds, pool, player.money, false);

  const next = plan.buildCities[0] ?? closingCity(ctx, legal);
  if (next === undefined) return { type: 'passBuilding' };

  const target = legal.buildableCities.find((c) => c.cityId === next);
  if (!target || !target.affordable) return { type: 'passBuilding' };
  return { type: 'buildCity', cityId: next };
}

/**
 * The winning move, when there is one: the next city on the way to the §11
 * threshold, taken even though the bot cannot light it.
 *
 * This is the one place a house is worth more than the electricity it carries.
 * §11 ends the game the moment a network reaches the threshold, and the winner
 * is whoever *can supply* the most cities — so once the bot already leads on
 * supply, the remaining houses buy the win outright, and their darkness costs
 * nothing. Without this a table can sit forever: with the plant stack
 * exhausted, capacity stops growing, every seat's network is already as large
 * as its plants can light, and nobody will take the last step.
 *
 * Guarded hard, because outside that endgame a house you cannot power is
 * exactly the mistake this planner exists to avoid: the full remaining distance
 * has to be affordable now, and the bot has to be winning the evaluation
 * including its tie-break, after paying for it.
 */
function closingCity(ctx: BotContext, legal: LegalActions): CityId | undefined {
  const state = ctx.state;
  if (state.endGameTriggered) return undefined;

  const player = getPlayer(state, ctx.playerId);
  const shortfall = endGameThreshold(state) - player.cities.length;
  if (shortfall <= 0 || shortfall > player.housesRemaining) return undefined;
  if (shortfall > ctx.ladder.cities.length) return undefined;

  const cost = ctx.ladder.cumulative[shortfall]!;
  if (cost > player.money) return undefined;

  const mine = bestSupply(state, ctx.playerId);
  for (const rival of humanPlayers(state)) {
    if (rival.id === ctx.playerId) continue;
    const theirs = bestSupply(state, rival.id);
    if (theirs.cities > mine.cities) return undefined;
    // §11 breaks a tie on money, which this purchase is about to spend.
    if (theirs.cities === mine.cities && rival.money >= player.money - cost) return undefined;
  }

  const next = ctx.ladder.cities[0]!;
  return legal.buildableCities.some((c) => c.cityId === next) ? next : undefined;
}

/* ------------------------------------------------------------------ *
 * Phase 5 — Bureaucracy (§9.1)
 * ------------------------------------------------------------------ */

function bureaucracyAction(ctx: BotContext, legal: LegalActions): GameAction {
  const options = legal.powerOptions;
  if (options.length === 0) {
    return { type: 'powerCities', decision: { operatePlantIds: [], citiesSupplied: 0 } };
  }
  /* Take the largest payment; among equal payments burn the fuel that is
     cheapest to replace, so an unnecessary uranium token is never spent to
     supply cities a coal plant could have covered. */
  const best = [...options].sort(
    (a, b) =>
      b.payoutAtMax - a.payoutAtMax ||
      burnCost(ctx, a.plantIds) - burnCost(ctx, b.plantIds) ||
      a.plantIds.length - b.plantIds.length,
  )[0]!;

  return {
    type: 'powerCities',
    decision: { operatePlantIds: best.plantIds, citiesSupplied: best.maxCities },
  };
}

/** What it would cost to replace the fuel a plant set burns. §7. */
function burnCost(ctx: BotContext, plantIds: readonly number[]): number {
  let total = 0;
  for (const id of plantIds) {
    const plant = getPlant(id);
    if (plant.fuel === 0) continue;
    const cheapest = Math.min(
      ...plant.accepts.map((t) => ctx.prices[t][0] ?? SOLD_OUT_PRICE),
    );
    total += plant.fuel * cheapest;
  }
  return total;
}

/* ------------------------------------------------------------------ *
 * Setup (§2)
 * ------------------------------------------------------------------ */

function setupAction(state: GameState, legal: LegalActions): GameAction | null {
  if (legal.startCityChoices.length > 0) {
    return { type: 'markStartCity', cityId: bestHub(state, legal.startCityChoices) };
  }
  // Zone selection and Trust placement have no production consequences worth
  // modelling; `defaultActionFor` covers them.
  return null;
}

/**
 * The best-connected city among `choices`: the one whose nearest neighbours are
 * cheapest to reach, so the first few houses of §8 cost the least. Ties break on
 * id, keeping the choice a pure function of state (§14).
 */
function bestHub(state: GameState, choices: readonly CityId[]): CityId {
  const map = stateMap(state);
  let best: { cityId: CityId; cost: number } | null = null;
  for (const cityId of [...choices].sort()) {
    const routes = cheapestRoutes(map, state.zone, [cityId]);
    const nearest = [...routes.entries()]
      .filter(([id]) => id !== cityId)
      .map(([, cost]) => cost)
      .sort((a, b) => a - b)
      .slice(0, START_CITY_NEIGHBOURS);
    const cost = nearest.reduce((s, c) => s + c, 0) + (START_CITY_NEIGHBOURS - nearest.length) * 50;
    if (!best || cost < best.cost) best = { cityId, cost };
  }
  return best!.cityId;
}
