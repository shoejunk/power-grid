import { useState } from 'react';
import {
  END_GAME_THRESHOLD,
  HOUSE_SLOT_COSTS,
  PAYMENT_TABLE,
  SLOTS_OPEN_AT_STEP,
  STEP2_THRESHOLD,
  refillFor,
} from '@pg/shared';

import { Badge, Button, IconBook, Modal } from '../ui';
import { PHASE_META, RESOURCE_META, RESOURCE_ORDER } from './format';
import { useMatch } from './model';

/**
 * The always-reachable rules reference (quality bar U8).
 *
 * Everything here is read from the same tables the engine uses, for the *current*
 * player count, map and Step — so it can never disagree with the game being
 * played.
 */
export function RulesSheet(): JSX.Element {
  const [open, setOpen] = useState(false);
  const { state } = useMatch();
  const count = state.settings.playerCount;

  return (
    <>
      <Button variant="ghost" size="sm" icon={<IconBook />} onClick={() => setOpen(true)}>
        Rules
      </Button>
      {/*
       * Mounted only while open, rather than left mounted with `open={false}`.
       * `ui/Modal` closes through an AnimatePresence exit, and under
       * StrictMode's double-mount that exit can hang — leaving a dialog the
       * player cannot dismiss. Unmounting the whole subtree makes closing
       * unconditional; the entrance spring is unaffected.
       */}
      {open ? (
      <Modal
        open
        onClose={() => setOpen(false)}
        title="Rules reference"
        description={`${state.settings.playerCount} players · ${state.settings.mapId === 'usa' ? 'USA' : 'Germany'} · Step ${state.step}`}
        width="720px"
      >
        <div className="pg-gsheet">
          <section>
            <h3 className="pg-gsheet__h">The round</h3>
            <ol className="pg-gsheet__phases">
              {(['order', 'auction', 'resources', 'building', 'bureaucracy'] as const).map((phase) => {
                const meta = PHASE_META[phase];
                return (
                  <li key={phase} data-active={state.phase === phase}>
                    <span className="pg-gsheet__num pg-numeral">{meta.index}</span>
                    <span>
                      <strong>{meta.name}</strong>
                      <em>{meta.order}</em>
                      <span>{meta.summary}</span>
                    </span>
                    <span className="pg-gsheet__ref">{meta.rule}</span>
                  </li>
                );
              })}
            </ol>
          </section>

          <section>
            <h3 className="pg-gsheet__h">Thresholds for {count} players</h3>
            <div className="pg-gsheet__facts">
              <Fact label="Step 2 begins at" value={`${STEP2_THRESHOLD[count] ?? 7} cities`} rule="§10" />
              <Fact label="Game ends at" value={`${END_GAME_THRESHOLD[count] ?? 17} cities`} rule="§11" />
              <Fact
                label="Houses per city now"
                value={`${SLOTS_OPEN_AT_STEP[state.step]} — costing ${HOUSE_SLOT_COSTS.slice(0, SLOTS_OPEN_AT_STEP[state.step]).join(', ')}₤`}
                rule="§8, §10"
              />
              <Fact label="Plants per player" value="3 — a fourth forces a scrap" rule="§6" />
            </div>
          </section>

          <section>
            <h3 className="pg-gsheet__h">Resupply this Step</h3>
            <div className="pg-gsheet__refill">
              {RESOURCE_ORDER.map((type) => (
                <span key={type} className="pg-gsheet__refillcell">
                  <span className="pg-gtok pg-gtok--xs" data-res={type} aria-hidden="true">
                    {RESOURCE_META[type].mark}
                  </span>
                  {RESOURCE_META[type].label}
                  <b className="pg-numeral">
                    +{refillFor(state.settings.mapId, count, state.step)[type]}
                  </b>
                </span>
              ))}
            </div>
            <p className="pg-caption">
              Added during Phase 5, filling the most expensive empty space first. If the supply runs short,
              the market simply stays partly empty. <em>§9.2</em>
            </p>
          </section>

          <section>
            <h3 className="pg-gsheet__h">Payment summary</h3>
            <div className="pg-gsheet__pay">
              {PAYMENT_TABLE.map((amount, cities) => (
                <span key={cities}>
                  <b className="pg-numeral">{cities}</b>
                  <i className="pg-numeral">{amount}</i>
                </span>
              ))}
            </div>
            <p className="pg-caption">
              Elektro earned for the number of cities you supply. Supplying none still pays 10. <em>§9.1</em>
            </p>
          </section>

          <section>
            <h3 className="pg-gsheet__h">Things the interface will not let you do</h3>
            <ul className="pg-gsheet__illegal">
              <li>Bid on a future-market plant in Steps 1–2 <Badge>§14</Badge></li>
              <li>Re-enter an auction after passing, or buy a second plant in one round <Badge>§6</Badge></li>
              <li>Buy resources your plants cannot burn or store, or a depleted type <Badge>§7</Badge></li>
              <li>Build outside the zone, in a full city, twice in the same city, or off-network <Badge>§8</Badge></li>
              <li>Scrap the plant you just acquired <Badge>§6</Badge></li>
              <li>Take any cash during the end-game winner evaluation <Badge>§11</Badge></li>
            </ul>
          </section>
        </div>
      </Modal>
      ) : null}
    </>
  );
}

function Fact({ label, value, rule }: { label: string; value: string; rule: string }): JSX.Element {
  return (
    <div className="pg-gsheet__fact">
      <span className="pg-overline">{label}</span>
      <strong>{value}</strong>
      <em>{rule}</em>
    </div>
  );
}
