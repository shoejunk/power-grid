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
import './board-visuals.scss';
import { DowIcon } from './iconography';

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
    <div className="dow-board dow-winter-board" aria-label="Dead of Winter board">
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
        !isColony ? `dow-place--${location}` : '',
        isTarget ? 'dow-place--target' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="region"
      aria-label={`${locationName(location)}. ${
        isColony ? 'Colony hub with six entrances.' : 'Non-colony search location.'
      }`}
      title={
        <span className="dow-place__title-block">
          <span className="dow-place__title">
            {locationName(location)}
            <span className="dow-place__count" aria-label={`${occupied} of ${capacity} survivor spaces occupied`}>
              {occupied}/{capacity}
            </span>
          </span>
          <span className="dow-place__subtitle">
            {isColony ? 'Central safehouse · six entrances' : 'Search site · one entrance'}
          </span>
        </span>
      }
      actions={
        <span className="dow-place__marks">
          {zombies > 0 ? (
            <span
              className="dow-place__mark dow-place__mark--zombie"
              title="Zombies here"
              aria-label={`${zombies} zombies here`}
            >
              <DowIcon name="zombie" size={12} decorative /> {zombies} zombies
            </span>
          ) : null}
          {!isColony && site ? (
            <>
              <span
                className="dow-place__mark dow-place__mark--noise"
                title="Noise tokens — each is rolled in the Colony Phase"
                aria-label={`${site.noise} of ${site.noiseSpaces} noise spaces used`}
              >
                <DowIcon name="noise" size={12} decorative /> noise {site.noise}/{site.noiseSpaces}
              </span>
              <span
                className="dow-place__mark dow-place__mark--deck"
                title="Cards left in this location's deck"
                aria-label={`${site.deck.length} cards left in the location deck`}
              >
                <DowIcon name="card" size={12} decorative /> deck {site.deck.length}
              </span>
            </>
          ) : null}
          {isColony ? (
            <>
              {state.colony.helpless > 0 ? (
                <span className="dow-place__mark dow-place__mark--helpless" title="Helpless survivors">
                  <DowIcon name="survivor" size={12} decorative /> helpless {state.colony.helpless}
                </span>
              ) : null}
              <span
                className="dow-place__mark dow-place__mark--waste"
                title="Cards in the waste pile"
                aria-label={`${state.colony.waste.length} cards in the waste pile`}
              >
                <DowIcon name="card" size={12} decorative /> waste {state.colony.waste.length}
              </span>
            </>
          ) : null}
        </span>
      }
    >
      {isColony ? (
        <div className="dow-hub__scene" aria-hidden="true">
          <span className="dow-hub__moon" />
          <span className="dow-hub__snowline" />
          <span className="dow-hub__building" />
          <span className="dow-hub__roof" />
          <span className="dow-hub__window dow-hub__window--left" />
          <span className="dow-hub__window dow-hub__window--right" />
          <span className="dow-hub__door" />
          <span className="dow-hub__lamp" />
        </div>
      ) : (
        <div className={`dow-landmark dow-landmark--${location}`} aria-hidden="true">
          <span className="dow-landmark__horizon" />
          <span className="dow-landmark__snow" />
          <span className="dow-landmark__structure" />
          <span className="dow-landmark__roof" />
          <span className="dow-landmark__detail" />
          <span className="dow-landmark__door" />
        </div>
      )}

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
        <button
          type="button"
          className="dow-place__pick"
          onClick={() => onPickLocation(location)}
          aria-label={`${targetLabel}: ${locationName(location)}`}
        >
          {targetLabel}
        </button>
      ) : null}
    </Panel>
  );
}
