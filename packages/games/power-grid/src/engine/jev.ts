import type { GameAction, GameState } from '../types.js';
import { legalActions } from './legal.js';
import { validateAction } from './index.js';
import { getPlant } from '../data/plants.js';
import { stateMap } from './mapAccess.js';
import { buildTargets } from './building.js';
import { operableCombinations } from './production.js';
import { endGameThreshold } from './endgame.js';
import { PAYMENT_TABLE, STEP2_THRESHOLD, REFILL_TABLE, MAX_PLANTS_PER_PLAYER, HOUSE_SLOT_COSTS, payoutFor } from './constants.js';
import { JEV_RULES } from './jevRules.js';

/** Finite, validated choices. Money decisions are bounded by the player's cash. */
export function jevChoices(state: GameState, playerId: string): GameAction[] {
  const legal = legalActions(state, playerId);
  const choices: GameAction[] = [];
  const add = (action: GameAction | null) => {
    if (action && validateAction(state, playerId, action).ok
      && !choices.some(a => JSON.stringify(a) === JSON.stringify(action))) choices.push(action);
  };
  if (legal.zoneRequired) add({ type: 'selectZone', areas: [] });
  for (const cityId of legal.startCityChoices) add({ type: 'markStartCity', cityId });
  for (const cityId of legal.trustHouseCities) add({ type: 'placeTrustHouse', cityId });
  for (const plantId of legal.scrappablePlants) add({ type: 'scrapPlant', plantId });
  const money = state.players[playerId]!.money;
  const bids = (min: number) => {
    const count = Math.min(money - min + 1, Math.floor(240 / Math.max(1, legal.nominatablePlants.length)));
    return Array.from({ length: Math.max(0, count) }, (_, i) => min + Math.floor(i * (money - min) / Math.max(1, count - 1)));
  };
  for (const p of legal.nominatablePlants) {
    for (const maxBid of bids(p.minimumBid)) add({ type: 'nominatePlant', plantId: p.plantId, bid: p.minimumBid, maxBid });
  }
  if (legal.bidding) {
    for (const maxBid of bids(legal.bidding.minimumRaise)) add({ type: 'submitBidRange', minBid: legal.bidding.minimumRaise, maxBid });
    add({ type: 'passBid' });
  }
  if (legal.canPassNomination) add({ type: 'passNomination' });
  if (legal.canPassResources) {
    add({ type: 'passResources' });
    // Enumerate all legal baskets before sampling across the entire space.
    // Prefix truncation favored large coal purchases and omitted smaller baskets.
    const options = legal.resourceOptions.filter(o => o.maxCount > 0);
    const baskets: GameAction[] = [];
    const visit = (i: number, purchases: { resource: typeof options[number]['resource']; count: number }[]) => {
      if (i === options.length) {
        const action: GameAction = { type: 'buyResourcesAndFinish', purchases };
        if (purchases.length && validateAction(state, playerId, action).ok) baskets.push(action);
        return;
      }
      const option = options[i]!;
      for (let n = 0; n <= option.maxCount; n++) {
        visit(i + 1, n ? [...purchases, { resource: option.resource, count: n }] : purchases);
      }
    };
    visit(0, []);
    const count = Math.min(baskets.length, 240 - choices.length);
    for (let i = 0; i < count; i++) add(baskets[Math.floor(i * (baskets.length - 1) / Math.max(1, count - 1))]!);
  }
  for (const target of legal.buildableCities) add({ type: 'buildCity', cityId: target.cityId });
  if (legal.canPassBuilding) add({ type: 'passBuilding' });
  for (const option of legal.powerOptions) {
    for (let citiesSupplied = 0; citiesSupplied <= option.maxCities; citiesSupplied++) {
      add({ type: 'powerCities', decision: { operatePlantIds: option.plantIds, citiesSupplied } });
    }
  }
  return choices;
}

/** Public game context only: no seed, deck order, logs, account data or rival bids. */
export function jevContext(state: GameState, playerId: string) {
  return {
    game: 'Power Grid', playerId, phase: state.phase, step: state.step, round: state.round,
    settings: { mapId: state.settings.mapId, playerCount: state.settings.playerCount, experiencedStart: state.settings.experiencedStart, againstTheTrust: state.settings.againstTheTrust },
    setupStage: state.setupStage, activePlayerId: state.activePlayerId,
    zone: state.zone, playerOrder: state.playerOrder, citySlots: state.citySlots,
    players: Object.values(state.players).map(p => ({
      id: p.id, money: p.money, cities: p.cities, plants: p.plants, isTrust: p.isTrust,
      housesRemaining: p.housesRemaining, hasNetwork: p.hasNetwork,
      markedStartCity: p.markedStartCity, phaseStatus: p.phaseStatus,
      generationCapacity: p.plants.reduce((sum, plant) => sum + getPlant(plant.plantId).cities, 0),
      productionWithStoredFuel: operableCombinations(state, p.id).map(option => ({
        ...option, citiesSupplied: Math.min(option.capacity, p.cities.length),
        income: payoutFor(Math.min(option.capacity, p.cities.length)),
      })),
    })),
    plantMarket: { current: state.plantMarket.current, future: state.plantMarket.future, remainingDeckCount: state.plantMarket.stack.length, discountPlantId: state.plantMarket.discountPlantId, discountReplacementRuleArmed: state.plantMarket.discountReplacementRuleArmed, step3CardRevealed: state.plantMarket.step3CardRevealed },
    plants: [...new Set([...state.plantMarket.current, ...state.plantMarket.future, ...Object.values(state.players).flatMap(p => p.plants.map(p => p.plantId))])].map(getPlant),
    resourceMarket: state.resourceMarket,
    supply: state.supply, usaCoalStorage: state.usaCoalStorage, uraniumPhaseOut: state.uraniumPhaseOut,
    acquiredThisRound: state.acquiredThisRound, passedThisPhase: state.passedThisPhase,
    pendingScrap: state.pendingScrap, pendingStep3: state.pendingStep3,
    step2Triggered: state.step2Triggered, endGameTriggered: state.endGameTriggered,
    trustStartCities: state.trustStartCities,
    pendingPowerDecisions: state.pendingPowerDecisions,
    auction: state.auction ? { plantId: state.auction.plantId, auctioneerId: state.auction.auctioneerId, eligibleBidders: state.auction.eligibleBidders } : null,
    legal: legalActions(state, playerId), map: stateMap(state),
    expansion: { explanation: 'Costs for your next single city using the current board, even outside the building phase. These are facts, not recommendations. Includes unaffordable cities. Costs and availability can change before your turn or after each build; purchases use the same cash as auctions and fuel.', targets: buildTargets(state, playerId) },
    tables: { incomeByCitiesSupplied: PAYMENT_TABLE, step2CityThreshold: STEP2_THRESHOLD[state.settings.playerCount], endGameCityThreshold: endGameThreshold(state), maxPlants: MAX_PLANTS_PER_PLAYER, houseSlotCosts: HOUSE_SLOT_COSTS, resourceRefill: REFILL_TABLE[state.settings.mapId] },
    rules: JEV_RULES,
    choiceSemantics: 'Choices are unranked legal actions, not recommendations. Bids and large resource-basket spaces are sampled under the provider limit. Select using your own strategy. Buying a plant does not build a city or generate income by itself. Each buildCity adds one city and leaves your building turn open for another decision; passBuilding ends building and opens production selection.',
  };
}
