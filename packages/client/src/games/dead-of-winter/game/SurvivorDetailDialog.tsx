import type { GameState } from '@game/dead-of-winter';
import { Badge, Button, Modal } from '@tt/ui';

import {
  itemDef,
  locationName,
  survivorArtPath,
  survivorDef,
} from '../content';

export interface SurvivorDetailDialogProps {
  state: GameState;
  survivorId: string | null;
  open: boolean;
  onClose: () => void;
}

/** A public, card-like inspection view for every survivor on the board. */
export function SurvivorDetailDialog({
  state,
  survivorId,
  open,
  onClose,
}: SurvivorDetailDialogProps): JSX.Element | null {
  if (!survivorId) return null;
  const survivor = state.survivors[survivorId];
  if (!survivor) return null;
  const def = survivorDef(state, survivorId);
  if (!def) return null;

  const owner = state.players[survivor.controllerId];
  const wounds = survivor.wounds + survivor.frostbite;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={def.name}
      description={`${def.occupation} · ${owner?.name ?? 'Unassigned survivor'}`}
      width="720px"
      footer={
        <Button variant="primary" onClick={onClose}>
          Back to the colony
        </Button>
      }
    >
      <div className="dow-survivor-detail">
        <div className="dow-survivor-detail__hero">
          <img
            className="dow-survivor-detail__art"
            src={survivorArtPath(survivor.cardId)}
            alt={`${def.name}, ${def.occupation}`}
          />
          <div className="dow-survivor-detail__identity">
            <div className="dow-survivor-detail__eyebrow">
              {survivor.isLeader ? <Badge tone="warning">Group leader</Badge> : null}
              {survivor.movedThisTurn ? <Badge tone="neutral">Moved this turn</Badge> : null}
            </div>
            <p className="dow-survivor-detail__flavor">
              {def.name} is holding the line at {locationName(survivor.location)}.
            </p>
            <dl className="dow-survivor-detail__facts">
              <div>
                <dt>Controller</dt>
                <dd>{owner?.name ?? 'Unassigned'}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{locationName(survivor.location)}</dd>
              </div>
              <div>
                <dt>Condition</dt>
                <dd>{wounds === 0 ? 'Unwounded' : `${wounds} damage`}</dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="dow-survivor-detail__stats" aria-label="Survivor statistics">
          <div><strong>{def.influence}</strong><span>Influence</span></div>
          <div><strong>{def.attackThreshold}+</strong><span>Attack</span></div>
          <div><strong>{def.searchThreshold}+</strong><span>Search</span></div>
          <div><strong>{survivor.wounds}</strong><span>Wounds</span></div>
          <div><strong>{survivor.frostbite}</strong><span>Frostbite</span></div>
        </div>

        <section className="dow-survivor-detail__section">
          <h3>Unique ability</h3>
          <p>{def.ability?.text ?? 'No unique ability is registered for this survivor in this content pack.'}</p>
          {def.ability ? (
            <p className="tt-caption">
              {def.ability.location === 'ANYWHERE' ? 'Any location' : def.ability.location} ·{' '}
              {def.ability.usage}
              {def.ability.dieThreshold === null ? '' : ` · requires ${def.ability.dieThreshold}+ die`}
            </p>
          ) : null}
        </section>

        <section className="dow-survivor-detail__section">
          <h3>Equipment</h3>
          {survivor.equipped.length > 0 ? (
            <ul className="dow-survivor-detail__equipment">
              {survivor.equipped.map((iid) => (
                <li key={iid}>{itemDef(state, iid)?.name ?? 'Face-down card'}</li>
              ))}
            </ul>
          ) : (
            <p className="tt-caption">No equipment equipped.</p>
          )}
        </section>
      </div>
    </Modal>
  );
}
