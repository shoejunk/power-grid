import { useEffect, useState } from 'react';
import type { ResourceBundle } from '@game/power-grid';
import { emptyResources } from '@game/power-grid';

import { PlantMarket } from './PlantMarket';
import { ResourceMarket } from './ResourceMarket';
import { useMatch } from './model';
import { AuctionPanel } from './panels/AuctionPanel';
import { BuildPanel } from './panels/BuildPanel';
import { BureaucracyPanel } from './panels/BureaucracyPanel';
import { EndgamePanel } from './panels/EndgamePanel';
import { ResourcePanel } from './panels/ResourcePanel';
import { SetupPanel } from './panels/SetupPanel';
import { PhaseShell, Waiting } from './panels/shell';

/**
 * The right rail.
 *
 * The two markets sit above the phase panel and never move, so the player can
 * read the plant market and the resource price track in every phase without
 * opening anything (quality bar V10). The panel underneath is the only part that
 * changes with the phase.
 */
export function PhaseRail(): JSX.Element {
  const { state, me, legal } = useMatch();
  const [nominee, setNominee] = useState<number | null>(null);
  const [draft, setDraft] = useState<ResourceBundle>(emptyResources());

  // A new phase, round or turn invalidates any half-built choice.
  useEffect(() => {
    setNominee(null);
    setDraft(emptyResources());
  }, [state.phase, state.round, state.activePlayerId]);

  const nominating =
    state.phase === 'auction' &&
    state.auction === null &&
    state.pendingScrap === null &&
    legal.nominatablePlants.length > 0;

  const buying = state.phase === 'resources' && legal.isActive;

  return (
    <div className="pg-grr">
      {/*
        The two market cards share one scroll container. They are reference
        material: if the frame is too short for everything, they give up height
        (and scroll) so the phase panel below keeps its action bar on screen.
      */}
      <div className="pg-grr__decks">
        <PlantMarket
          {...(nominating
            ? { nominatable: legal.nominatablePlants, onSelect: (id: number) => setNominee(id) }
            : {})}
          selectedPlantId={nominee}
          auctionPlantId={state.auction?.plantId ?? null}
          money={me?.money ?? 0}
        />
        <ResourceMarket draft={buying ? draft : null} />
      </div>
      <div className="pg-grr__phase">
        <PhaseBody nominee={nominee} setNominee={setNominee} draft={draft} setDraft={setDraft} />
      </div>
    </div>
  );
}

function PhaseBody({
  nominee,
  setNominee,
  draft,
  setDraft,
}: {
  nominee: number | null;
  setNominee: (id: number | null) => void;
  draft: ResourceBundle;
  setDraft: (draft: ResourceBundle) => void;
}): JSX.Element {
  const { state } = useMatch();

  switch (state.phase) {
    case 'setup':
      return <SetupPanel />;
    case 'auction':
      return <AuctionPanel selectedPlantId={nominee} onSelectPlant={setNominee} />;
    case 'resources':
      return <ResourcePanel draft={draft} setDraft={setDraft} />;
    case 'building':
      return <BuildPanel />;
    case 'bureaucracy':
      return <BureaucracyPanel />;
    case 'gameOver':
      return <EndgamePanel />;
    case 'order':
    default:
      return (
        <PhaseShell
          title="Determine player order"
          subtitle="Phase 1 · automatic"
          rules={[
            { text: 'Players are ranked by connected cities, highest first.', rule: '§4, §5' },
            { text: 'The highest-numbered owned plant breaks a tie.', rule: '§4' },
            { text: 'Round 1 uses the random setup order for the auctions only.', rule: '§5' },
          ]}
        >
          <Waiting note="Recomputing the order for the round. Phase 2 begins immediately." />
        </PhaseShell>
      );
  }
}
