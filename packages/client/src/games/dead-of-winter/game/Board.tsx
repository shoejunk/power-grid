/**
 * The board: the colony and the six locations it can reach.
 *
 * Everything §21 asks a table to be able to see at a glance without opening
 * anything — every survivor and where they are, every zombie and which entrance
 * it is at, barricades, noise, how much is left in each deck — is on this
 * screen at once. Nothing here is a menu.
 */

import { COLONY, type GameState, type LocationId } from '@game/dead-of-winter';
import { Panel } from '@tt/ui';

import { locationName } from '../content';
import {
  allLocations,
  entrancesOf,
  occupancyOf,
  survivorCapacityOf,
  survivorsAt,
  zombiesAt,
} from './model';
import { EntranceRow, SurvivorChip } from './parts';

export interface BoardProps {
  state: GameState;
  selectedSurvivorId: string | null;
  onSelectSurvivor: (id: string | null) => void;
  /** Opens the public card detail view; every survivor remains inspectable. */
  onInspectSurvivor: (id: string) => void;
  /** Locations offered as a destination while a move (or an attract source) is being aimed. */
  targets: readonly LocationId[] | null;
  targetLabel: string;
  onPickLocation: (id: LocationId) => void;
  /** Survivors this browser may select — everyone else is shown but inert. */
  actableSurvivorIds: ReadonlySet<string>;
}

export function Board({
  state,
  selectedSurvivorId,
  onSelectSurvivor,
  onInspectSurvivor,
  targets,
  targetLabel,
  onPickLocation,
  actableSurvivorIds,
}: BoardProps): JSX.Element {
  return (
    <div className="dow-board">
      {allLocations.map((id) => (
        <LocationCard
          key={id}
          state={state}
          location={id}
          selectedSurvivorId={selectedSurvivorId}
          onSelectSurvivor={onSelectSurvivor}
          onInspectSurvivor={onInspectSurvivor}
          isTarget={targets?.includes(id) ?? false}
          targetLabel={targetLabel}
          onPickLocation={onPickLocation}
          actableSurvivorIds={actableSurvivorIds}
        />
      ))}
    </div>
  );
}

interface LocationCardProps {
  state: GameState;
  location: LocationId;
  selectedSurvivorId: string | null;
  onSelectSurvivor: (id: string | null) => void;
  onInspectSurvivor: (id: string) => void;
  isTarget: boolean;
  targetLabel: string;
  onPickLocation: (id: LocationId) => void;
  actableSurvivorIds: ReadonlySet<string>;
}

function LocationCard({
  state,
  location,
  selectedSurvivorId,
  onSelectSurvivor,
  onInspectSurvivor,
  isTarget,
  targetLabel,
  onPickLocation,
  actableSurvivorIds,
}: LocationCardProps): JSX.Element {
  const isColony = location === COLONY;
  const entrances = entrancesOf(state, location);
  const survivors = survivorsAt(state, location);
  const zombies = zombiesAt(state, location);
  const capacity = survivorCapacityOf(state, location);
  const occupied = occupancyOf(state, location);
  const site = isColony ? null : state.locations[location];

  return (
    <Panel
      tone={isColony ? 'plate' : 'glass'}
      padding="tight"
      className={[
        'dow-place',
        isColony ? 'dow-place--colony' : '',
        isTarget ? 'dow-place--target' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      title={
        <span className="dow-place__title">
          {locationName(location)}
          <span className="dow-place__count">
            {occupied}/{capacity}
          </span>
        </span>
      }
      actions={
        <span className="dow-place__marks">
          {zombies > 0 ? (
            <span className="dow-place__mark dow-place__mark--zombie" title="Zombies here">
              ● {zombies}
            </span>
          ) : null}
          {!isColony && site ? (
            <>
              <span className="dow-place__mark" title="Noise tokens — each is rolled in the Colony Phase">
                ♪ {site.noise}/{site.noiseSpaces}
              </span>
              <span className="dow-place__mark" title="Cards left in this location's deck">
                🂠 {site.deck.length}
              </span>
            </>
          ) : null}
          {isColony ? (
            <>
              {state.colony.helpless > 0 ? (
                <span className="dow-place__mark" title="Helpless survivors">
                  ✋ {state.colony.helpless}
                </span>
              ) : null}
              <span className="dow-place__mark" title="Cards in the waste pile">
                🗑 {state.colony.waste.length}
              </span>
            </>
          ) : null}
        </span>
      }
    >
      <div className="dow-place__entrances">
        {entrances.map((entrance) => (
          <EntranceRow
            key={entrance.index}
            index={isColony ? entrance.index : undefined}
            zombies={entrance.zombies}
            barricades={entrance.barricades}
            capacity={entrance.capacity}
          />
        ))}
      </div>

      <div className="dow-place__survivors">
        {survivors.length === 0 ? (
          <span className="dow-place__empty">Nobody here.</span>
        ) : (
          survivors.map((survivor) => {
            const actable = actableSurvivorIds.has(survivor.id);
            return (
              <SurvivorChip
                key={survivor.id}
                state={state}
                survivor={survivor}
                selected={survivor.id === selectedSurvivorId}
                muted={!actable}
                onClick={() => {
                  if (actable) {
                    onSelectSurvivor(survivor.id === selectedSurvivorId ? null : survivor.id);
                  }
                  onInspectSurvivor(survivor.id);
                }}
              />
            );
          })
        )}
      </div>

      {isTarget ? (
        <button type="button" className="dow-place__pick" onClick={() => onPickLocation(location)}>
          {targetLabel}
        </button>
      ) : null}
    </Panel>
  );
}
