import type { GameAction, GameState } from '../types.js';
import { legalActions } from './legal.js';
import { defaultActionFor } from './autoplay.js';
import { validateAction } from './index.js';
import { getPlant } from '../data/plants.js';
import { stateMap } from './mapAccess.js';

/** Finite, validated choices. Money decisions are bounded by the player's cash. */
export function jevChoices(state: GameState, playerId: string): GameAction[] {
  const legal = legalActions(state, playerId);
  const choices: GameAction[] = [];
  const add = (action: GameAction | null) => {
    if (action && validateAction(state, playerId, action).ok
      && !choices.some(a => JSON.stringify(a) === JSON.stringify(action))) choices.push(action);
  };
  add(defaultActionFor(state, playerId));
  for (const cityId of legal.startCityChoices) add({ type: 'markStartCity', cityId });
  for (const cityId of legal.trustHouseCities) add({ type: 'placeTrustHouse', cityId });
  for (const plantId of legal.scrappablePlants) add({ type: 'scrapPlant', plantId });
  const money = state.players[playerId]!.money;
  const bids = (min: number) => [...new Set([min, min + 3, min + 8, Math.floor(money / 2), money])].filter(n => n >= min && n <= money);
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
    // Include mixed baskets, not independent coal/oil purchases. Stop at the
    // provider limit; the strategist's complete basket is always first.
    const options = legal.resourceOptions.filter(o => o.maxCount > 0);
    const visit = (i: number, purchases: { resource: typeof options[number]['resource']; count: number }[]) => {
      if (choices.length >= 240) return;
      if (i === options.length) { add({ type: 'buyResources', purchases }); return; }
      const option = options[i]!;
      for (let n = option.maxCount; n >= 0; n--) {
        visit(i + 1, n ? [...purchases, { resource: option.resource, count: n }] : purchases);
        if (choices.length >= 240) break;
      }
    };
    visit(0, []);
  }
  for (const target of legal.buildableCities) add({ type: 'buildCity', cityId: target.cityId });
  if (legal.canPassBuilding) add({ type: 'passBuilding' });
  for (const option of legal.powerOptions) add({ type: 'powerCities', decision: { operatePlantIds: option.plantIds, citiesSupplied: option.maxCities } });
  return choices;
}

/** Public game context only: no seed, deck order, logs, account data or rival bids. */
export function jevContext(state: GameState, playerId: string): unknown {
  return {
    playerId, phase: state.phase, step: state.step, round: state.round,
    zone: state.zone, playerOrder: state.playerOrder, citySlots: state.citySlots,
    players: Object.values(state.players).map(p => ({ id: p.id, money: p.money, cities: p.cities, plants: p.plants, isTrust: p.isTrust })),
    plantMarket: { current: state.plantMarket.current, future: state.plantMarket.future },
    plants: [...new Set([...state.plantMarket.current, ...state.plantMarket.future, ...Object.values(state.players).flatMap(p => p.plants.map(p => p.plantId))])].map(getPlant),
    resourceMarket: state.resourceMarket,
    auction: state.auction ? { plantId: state.auction.plantId } : null,
    legal: legalActions(state, playerId), map: stateMap(state),
    rules: 'Win by supplying the most cities at game end; cash breaks ties. Reserve money for fuel and connections. Plant storage is twice fuel, shared for hybrids. A resource purchase ends your resource turn; choose the complete basket. Bid ranges are sealed and cannot exceed cash. Build then produce electricity for income.',
  };
}
