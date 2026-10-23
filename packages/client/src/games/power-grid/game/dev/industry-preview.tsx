/** Development-only UI fixture. Uses the real reducer locally, without a server. */
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { applyAction, createGame, emptyResources, runFinalEvaluation, powerGrid, type GameSettings, type GameState } from '@game/power-grid';
import { net, useGameStore } from '@/net';
import { GameScreen } from '../../screens/GameScreen';
import { PlantCard } from '../parts/PlantCard';
import { PowerGridSettings } from '../../settings/PowerGridSettings';
import '@tt/ui/styles/index.scss';
import '../../styles/power-grid.scss';

const view = new URLSearchParams(location.search).get('view');
let state = createGame({ ...powerGrid.defaultSettings(), playerCount: 2, rulesMode: view === 'classic' ? 'classic' : 'industry', seed: 'industry-ui' },
  [{ id: 'p1', name: 'Ada' }, { id: 'p2', name: 'Brunel' }], 'p1', 'UI0001', { gameId: 'industry-fixture', now: 1000 });
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
if (view !== 'classic') {
  state.plantMarket.current = [101, 10, 104, 107];
  state.plantMarket.future = [13, 18, 110, 112];
  state.plantMarket.stack = [24, 30, 33, 9999];
  state.plantMarket.discountPlantId = 101;
  state.plantMarket.discountReplacementRuleArmed = true;
}
if (view === 'scrap') {
  const id = state.activePlayerId!;
  state.players[id]!.plants = [3, 4, 5].map(plantId => ({ plantId, stored: emptyResources() }));
  state.players[id]!.facilities = [104, 107];
  state.plantMarket.current = [101, 10, 12, 13];
  state.plantMarket.future = [18, 105, 108, 110];
  state.passedThisPhase = state.playerOrder.filter(p => p !== id);
  state = applyAction(state, id, { type: 'nominatePlant', plantId: 101, bid: 1 }, 1000);
}
if (view === 'end') {
  state.players.p1!.money = 263; state.players.p1!.facilities = [103];
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
  return <div style={{ padding: 40, display: 'grid', gap: 30 }}>{(['xs', 'sm', 'md'] as const).map(size =>
    <div key={size} data-size={size} style={{ display: 'flex', gap: 12, alignItems: 'start' }}>
      {[4, 101, 102, 103, 3, 104, 105, 106, 6, 107, 108, 109, 11, 110, 111, 112].map(plantId =>
        <PlantCard key={plantId} plantId={plantId} size={size} />)}
    </div>)}</div>;
}
createRoot(document.getElementById('root')!).render(view === 'settings' ? <SettingsFixture /> : view === 'cards' ? <CardFixture /> : <GameScreen />);
