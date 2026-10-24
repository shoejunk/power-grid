import { cardName as rulesCardName } from '@game/power-grid';

// Presentation names are separate from the names recorded in audited game history.
const FACILITY_NAMES: Readonly<Record<number, string>> = {
  301: 'Cinderbrook Colliery',
  302: 'Blackstone Pit',
  303: 'Ironvale Mine',
  304: 'Greyrock Colliery',
  305: 'Deepwell Coalworks',
  306: 'Crownridge Coalfield',
  311: 'Copperport Refinery',
  312: 'Riverbend Refinery',
  313: 'Blackwater Refinery',
  314: 'Ironhaven Refinery',
  315: 'Northstar Oilworks',
  316: 'Port Meridian Refinery',
  321: 'Old Town Salvage Yard',
  322: 'Rivermill Reclamation Works',
  323: 'Union Sorting Depot',
  324: 'Crown City Recycling Works',
  331: 'Dawnstone Uranium Mine',
  332: 'Silverpine Uranium Mine',
  333: 'Wolfcrag Uranium Mine',
};

export const cardName = (id: number, version: number): string =>
  FACILITY_NAMES[id] ?? rulesCardName(id, version);
