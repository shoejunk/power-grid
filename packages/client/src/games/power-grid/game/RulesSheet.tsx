import { useState } from 'react';
import {
  END_GAME_THRESHOLD,
  HOUSE_SLOT_COSTS,
  PAYMENT_TABLE,
  SLOTS_OPEN_AT_STEP,
  STEP2_THRESHOLD,
  refillFor,
  isIndustry, isLegacyIndustry, industryBaseRefill, industryMoneyTarget,
} from '@game/power-grid';

import {
  Badge,
  Button,
  IconBook,
  Modal,
} from '@tt/ui';
import { phaseMeta, RESOURCE_META, RESOURCE_ORDER } from './format';
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
          {isIndustry(state) ? <section>
            <h3 className="pg-gsheet__h">Power Grid: Industry</h3>
            {state.version >= 7 ? <p>Nineteen facility cards before setup removals: six coal mines producing {state.version >= 8 ? '3–8' : '1–6'} and six oil refineries producing {state.version >= 8 ? '2–7' : '1–6'}; four recycling facilities producing 2–5; and three uranium mines producing {state.version >= 8 ? '2–4' : '1–3'} resources per round. All 61 plants and facilities have unique printed costs from 3 to 63. The highest printed cost among your plants and facilities breaks city-count ties for turn order, even when a card was bought at a discount. Each facility counts toward your five-card limit.</p> : state.version === 6 ? <p>Two copies of every facility size and resource: 24 facility cards before setup removals. Small, medium and large facilities produce 1, 3 and 5 resources per round. Each copy counts toward your five-card limit.</p> : null}
            {isLegacyIndustry(state) ? <p>Win with the most cash after a round reaches {industryMoneyTarget(state.settings)} Elektro. Everyone receives power and facility income, including in the final round. Cash ties share victory.</p> : <p>Use the normal city threshold and victory rules: the player who can power the most connected cities wins, with cash breaking ties. Final evaluation pays no power or facility income.</p>}
            <p>Buy one plant or facility per round. Facilities occupy no cities and cost only their auction price. {isLegacyIndustry(state) ? 'Small offers advance to medium, then large, when bought.' : 'Facilities share the plant deck, current and future markets, and discount token. Sort by printed cost.'} Own any five cards; acquiring a sixth requires scrapping any one card.</p>
            <p>The fixed baseline refills first, then facilities sell automatically into the remaining slots. Each delivered token earns {state.version >= 8 ? 'its full slot price, with no handling fee' : 'its slot price minus 1 Elektro (minimum zero)'}. Producers of the same resource share total revenue in proportion to output, with whole-Elektro rounding. Empty reserves or a full market limit deliveries and income. Germany’s nuclear phase-out is disabled.</p>
          </section> : null}
          <section>
            <h3 className="pg-gsheet__h">The round</h3>
            <ol className="pg-gsheet__phases">
              {(['order', 'auction', 'resources', 'building'] as const).map((phase) => {
                const meta = phaseMeta(state, phase);
                return (
                  <li key={phase} data-active={state.phase === phase}>
                    <span className="pg-gsheet__num tt-numeral">{meta.index}</span>
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
              <Fact label="Game ends at" value={isLegacyIndustry(state) ? `${industryMoneyTarget(state.settings)} Elektro · finish the round` : `${END_GAME_THRESHOLD[count] ?? 17} cities`} rule={isLegacyIndustry(state) ? 'Industry' : '§11'} />
              <Fact
                label="Houses per city now"
                value={`${SLOTS_OPEN_AT_STEP[state.step]} — costing ${HOUSE_SLOT_COSTS.slice(0, SLOTS_OPEN_AT_STEP[state.step]).join(', ')}₤`}
                rule="§8, §10"
              />
              <Fact label={isIndustry(state) ? 'Cards per player' : 'Plants per player'} value={isIndustry(state) ? '5 plants and/or facilities — a sixth forces a scrap' : '3 — a fourth forces a scrap'} rule={isIndustry(state) ? 'Industry' : '§6'} />
            </div>
          </section>

          <section>
            <h3 className="pg-gsheet__h">{isIndustry(state) ? 'Fixed baseline resupply (plus facilities)' : 'Resupply this Step'}</h3>
            <div className="pg-gsheet__refill">
              {RESOURCE_ORDER.map((type) => (
                <span key={type} className="pg-gsheet__refillcell">
                  <span className="pg-gtok pg-gtok--xs" data-res={type} aria-hidden="true">
                    {RESOURCE_META[type].mark}
                  </span>
                  {RESOURCE_META[type].label}
                  <b className="tt-numeral">
                    +{(isIndustry(state) ? industryBaseRefill(state) : refillFor(state.settings.mapId, count, state.step))[type]}
                  </b>
                </span>
              ))}
            </div>
            <p className="tt-caption">
              Added after everyone finishes the combined build-and-power phase, filling the most expensive empty space first. If the supply runs short,
              the market simply stays partly empty. <em>§9.2</em>
            </p>
          </section>

          <section>
            <h3 className="pg-gsheet__h">Payment summary</h3>
            <div className="pg-gsheet__pay">
              {PAYMENT_TABLE.map((amount, cities) => (
                <span key={cities}>
                  <b className="tt-numeral">{cities}</b>
                  <i className="tt-numeral">{amount}</i>
                </span>
              ))}
            </div>
            <p className="tt-caption">
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
              {!isIndustry(state) ? <li>Scrap the plant you just acquired <Badge>§6</Badge></li> : null}
              {!isLegacyIndustry(state) ? <li>Take any cash during the end-game winner evaluation <Badge>§11</Badge></li> : null}
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
      <span className="tt-overline">{label}</span>
      <strong>{value}</strong>
      <em>{rule}</em>
    </div>
  );
}
