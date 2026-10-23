/** Development-only UI fixture. Uses the real reducer locally, without a server. */
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { applyAction, createGame, facilitiesForVersion, emptyResources, runFinalEvaluation, powerGrid, type GameSettings, type GameState } from '@game/power-grid';
import { net, useGameStore } from '@/net';
import { GameScreen } from '../../screens/GameScreen';
import { PlantCard } from '../parts/PlantCard';
import { PowerGridSettings } from '../../settings/PowerGridSettings';
import '@tt/ui/styles/index.scss';
import '../../styles/power-grid.scss';

const params = new URLSearchParams(location.search);
const view = params.get('view');
const rulesVersion = params.get('version') === '4' ? 4 : params.get('version') === '5' ? 5 : params.get('version') === '6' ? 6 : params.get('version') === '7' ? 7 : 8;
const facilityId = (old: number): number => rulesVersion < 7 ? old : ({ 101: 301, 102: 303, 103: 305, 104: 311, 105: 313, 106: 315, 107: 321, 108: 323, 109: 324, 110: 331, 111: 332, 112: 333 } as Record<number, number>)[old]!;
let state = createGame({ ...powerGrid.defaultSettings(), playerCount: 2, rulesMode: view === 'classic' ? 'classic' : 'industry', seed: 'industry-ui' },
  [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Brunel' }], 'p1', 'UI0001', { gameId: 'industry-fixture', now: 1000, version: view === 'classic' ? 3 : rulesVersion });
state = applyAction(state, 'p1', { type: 'selectZone', areas: [] }, 1000);

function publish() {
  useGameStore.setState({ gameKey: 'power-grid', state, myPlayerId: state.activePlayerId ?? 'p1', connectionStatus: 'connected' });
}
Object.assign(net, { action: (action: unknown): void => {
  const parsed = powerGrid.parseAction(action);
  if (!parsed || !state.activePlayerId) throw new Error('Invalid fixture action');
  state = applyAction(state, state.activePlayerId, parsed, 1000);
  publish();
} });
if (view !== 'classic' && rulesVersion >= 5) {
  state.plantMarket.current = [facilityId(101), 10, facilityId(104), facilityId(107)];
  state.plantMarket.future = [13, 18, facilityId(110), rulesVersion >= 7 ? facilityId(111) : facilityId(112)];
  state.plantMarket.stack = [24, 30, 33, 9999];
  state.plantMarket.discountPlantId = facilityId(101);
  state.plantMarket.discountReplacementRuleArmed = true;
}
if (rulesVersion === 4) state.facilityMarket = [facilityId(103), facilityId(106), facilityId(109), facilityId(112)];
if (view === 'scrap') {
  const id = state.activePlayerId!;
  state.players[id]!.plants = [3, 4, 5].map(plantId => ({ plantId, stored: emptyResources() }));
  state.players[id]!.facilities = [facilityId(104), facilityId(107)];
  state.plantMarket.current = [facilityId(101), 10, 12, 13];
  state.plantMarket.future = [18, facilityId(105), facilityId(108), facilityId(110)];
  state.passedThisPhase = state.playerOrder.filter(p => p !== id);
  state = applyAction(state, id, { type: 'nominatePlant', plantId: facilityId(101), bid: 1 }, 1000);
}
if (view === 'end') {
  state.players.p1!.money = 263; state.players.p1!.facilities = [facilityId(103)];
  state.players.p2!.money = 252;
  state.players.p1!.cities = ['a'];
  state.players.p1!.plants = [{ plantId: 13, stored: emptyResources() }];
  state.players.p2!.cities = ['a', 'b'];
  state.players.p2!.plants = [{ plantId: 18, stored: emptyResources() }];
  state.endGameTriggered = true;
  runFinalEvaluation(state, 1000);
}
publish();
declare global { interface Window { industryFixture: { state: () => GameState; action: typeof net.action; settings?: GameSettings } } }
window.industryFixture = { state: () => state, action: net.action };
function SettingsFixture() {
  const [settings, setSettings] = useState(powerGrid.defaultSettings());
  window.industryFixture.settings = settings;
  return <div style={{ maxWidth: 800, margin: 'auto', padding: 24 }}><PowerGridSettings settings={settings} seatCount={0} disabled={false}
    onChange={patch => setSettings(s => ({ ...s, ...(patch as Partial<GameSettings>) }))} /></div>;
}
function CardFixture() {
  const cardIds = ['coal', 'oil', 'garbage', 'uranium'].flatMap((resource, i) =>
    [([4, 3, 6, 11] as const)[i]!, ...facilitiesForVersion(rulesVersion).filter(f => f.resource === resource && (rulesVersion >= 7 || f.id < 200)).map(f => f.id)]);
  return <div style={{ padding: 40, display: 'grid', gap: 30 }}>{(['xs', 'sm', 'md'] as const).map(size =>
    <div key={size} data-size={size} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'start' }}>
      {cardIds.map(plantId =>
        <PlantCard rulesVersion={state.version} key={plantId} plantId={plantId} size={size} />)}
    </div>)}</div>;
}
createRoot(document.getElementById('root')!).render(view === 'settings' ? <SettingsFixture /> : view === 'cards' ? <CardFixture /> : <GameScreen />);
