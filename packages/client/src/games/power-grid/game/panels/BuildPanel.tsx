import { AnimatePresence, motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import type { BuildTarget } from '@game/power-grid';
import {
  END_GAME_THRESHOLD,
  HOUSE_SLOT_COSTS,
  PAYMENT_TABLE,
  SLOTS_OPEN_AT_STEP,
  STEP2_THRESHOLD,
} from '@game/power-grid';

import { net } from '@/net';
import { springSnappy } from '@tt/ui';
import {
  Badge,
  Button,
  Modal,
  TextInput,
  Tooltip,
} from '@tt/ui';
import { Money } from '../../ui/Money';
import { plural } from '../format';
import { useMatch } from '../model';
import { Callout, PhaseShell, Stat, Waiting, type RuleLine } from './shell';

const BUILD_RULES: readonly RuleLine[] = [
  { text: 'Players build in reverse player order; each connects as many cities as they like, then the next player acts.', rule: '§4, §8' },
  { text: 'Your first house may go in any empty city in the zone, for 10₤ and no connection cost.', rule: '§8' },
  { text: 'Every later city costs the cheapest route from your network plus the lowest empty slot in that city.', rule: '§8' },
  { text: 'The route cost is paid again in full for each new city, even when it reuses the same edges.', rule: '§8' },
  { text: 'Only cities and connections inside the playing zone may be used — not even as a route through.', rule: '§1, §14' },
];

export function BuildPanel(): JSX.Element {
  const { state, me, meId, legal, cityIndex, map } = useMatch();
  const [query, setQuery] = useState('');

  const builtThisTurn = useMemo(
    () => (state.buildHistory ?? []).filter((b) => b.playerId === meId),
    [state.buildHistory, meId],
  );
  const spent = builtThisTurn.reduce((sum, b) => sum + b.routeCost + b.slotCost, 0);

  const count = state.settings.playerCount;
  const endAt = END_GAME_THRESHOLD[count] ?? 17;
  const step2At = STEP2_THRESHOLD[count] ?? 7;
  const slotsOpen = SLOTS_OPEN_AT_STEP[state.step];
  const costsOpen = HOUSE_SLOT_COSTS.slice(0, slotsOpen).join(', ');

  if (!legal.isActive || !me) {
    return (
      <PhaseShell
        title="Build Houses"
        subtitle="Phase 4 · reverse player order"
        actions={<PaymentSummaryButton />}
        rules={BUILD_RULES}
      >
        <Waiting note="Connecting cities, paying the cheapest route plus the city slot (§8)." />
        <StepNote step={state.step} slotsOpen={slotsOpen} costsOpen={costsOpen} />
      </PhaseShell>
    );
  }

  const targets = legal.buildableCities;
  const filtered = query.trim()
    ? targets.filter((t) => {
        const name = cityIndex.get(t.cityId)?.name ?? t.cityId;
        return name.toLowerCase().includes(query.trim().toLowerCase());
      })
    : targets;

  return (
    <PhaseShell
      title="Build Houses"
      subtitle="Phase 4 · your turn"
      tone="live"
      rules={BUILD_RULES}
      actions={
        <div className="pg-gactions">
          <PaymentSummaryButton />
          <Badge tone="accent" dot>
            Acting
          </Badge>
        </div>
      }
      footer={
        <div className="pg-gactions">
          <Tooltip
            placement="top"
            title={legal.canUndoBuild ? 'Take back the last house' : 'Nothing to undo'}
            rule="§8 Build Houses"
            content={
              legal.canUndoBuild
                ? 'Refunds the route and slot cost of the most recent city you connected this turn.'
                : 'You have not connected a city yet this turn.'
            }
          >
            <span className="pg-gactions__wrap">
              <Button
                variant="ghost"
                disabled={!legal.canUndoBuild}
                onClick={() => net.action({ type: 'undoLastBuild' })}
              >
                Undo
              </Button>
            </span>
          </Tooltip>
          <Button variant="primary" onClick={() => net.action({ type: 'passBuilding' })}>
            End building
          </Button>
        </div>
      }
    >
      <div className="pg-gsummary">
        <Stat label="Spent this turn" value={<Money value={spent} tone={spent > 0 ? 'loss' : 'muted'} />} />
        <Stat
          label="Connected this turn"
          value={<span className="tt-numeral">{builtThisTurn.length}</span>}
        />
        <Stat label="Money left" value={<Money value={me.money} />} />
      </div>

      <div className="pg-gnetwork">
        <span className="tt-overline">Network</span>
        <span className="pg-gnetwork__figure">
          <b className="tt-numeral">{me.cities.length}</b> {plural(me.cities.length, 'city', 'cities')}
        </span>
        <span className="tt-caption">
          Step 2 at {step2At} · game ends at {endAt}
        </span>
      </div>

      <StepNote step={state.step} slotsOpen={slotsOpen} costsOpen={costsOpen} />

      {targets.length === 0 ? (
        <Callout tone="warning" title="Nothing you can connect">
          Every city in the zone is either already yours, full at the current Step, or beyond what you can
          pay for. End building to pass the turn along. <em>§8, §14</em>
        </Callout>
      ) : (
        <>
          <div className="pg-gsectionhead">
            <span className="tt-overline pg-gsectionlabel">
              {targets.length} connectable {plural(targets.length, 'city', 'cities')}
            </span>
            <TextInput
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Filter cities"
              aria-label="Filter connectable cities"
            />
          </div>
          <div className="pg-gcities" role="list">
            <AnimatePresence initial={false}>
              {filtered.slice(0, 40).map((target) => (
                <CityRow key={target.cityId} target={target} money={me.money} />
              ))}
            </AnimatePresence>
          </div>
        </>
      )}

      {me.cities.length === 0 ? (
        <Callout tone="info" title="Your first house">
          With no network yet you may take any empty city in the zone for its lowest open slot and no
          connection cost. <em>§8</em>
        </Callout>
      ) : null}

      <span className="tt-caption pg-gzone">
        Zone: {state.zone.map((id) => map.areas.find((a) => a.id === id)?.name ?? id).join(' · ')}
      </span>
    </PhaseShell>
  );
}

function PaymentSummaryButton(): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Payment summary
      </Button>
      {open ? (
        <Modal
          open
          onClose={() => setOpen(false)}
          title="Payment summary card"
          description="Elektro income for the number of cities supplied during Phase 5."
          width="720px"
        >
          <div className="pg-gpay">
            <span className="tt-overline pg-gsectionlabel">Cities supplied → Elektro earned</span>
            <div className="pg-gpay__grid">
              {PAYMENT_TABLE.map((amount, cities) => (
                <div key={cities} className="pg-gpay__cell">
                  <span className="pg-gpay__cities tt-numeral">{cities}</span>
                  <span className="pg-gpay__amount tt-numeral">{amount}</span>
                </div>
              ))}
            </div>
            <p className="tt-caption">Supplying zero cities still pays the guaranteed minimum of 10 Elektro. <em>§9.1</em></p>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function StepNote({
  step,
  slotsOpen,
  costsOpen,
}: {
  step: number;
  slotsOpen: number;
  costsOpen: string;
}): JSX.Element {
  return (
    <div className="pg-gstepnote">
      <Badge tone="info">Step {step}</Badge>
      <span className="tt-caption">
        {slotsOpen} {plural(slotsOpen, 'house')} allowed per city, costing {costsOpen}₤. <em>§8, §10</em>
      </span>
    </div>
  );
}

function CityRow({ target, money }: { target: BuildTarget; money: number }): JSX.Element {
  const { cityIndex, map, state } = useMatch();
  const city = cityIndex.get(target.cityId);
  const area = city ? map.areas.find((a) => a.id === city.area) : undefined;
  const occupants = (state.citySlots[target.cityId] ?? []).filter((s) => s !== null).length;

  return (
    <motion.div
      className="pg-gcity"
      role="listitem"
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={springSnappy}
      data-affordable={target.affordable}
    >
      <span className="pg-gcity__name">
        {city?.name ?? target.cityId}
        <em>{area?.name ?? ''}</em>
      </span>
      <Tooltip
        placement="left"
        title={`${city?.name ?? target.cityId} — ${target.total}₤`}
        rule="§8 Build Houses"
        content={`Cheapest route from your network ${target.routeCost}₤ + slot ${target.slot + 1} of 3 at ${target.slotCost}₤. ${occupants} of 3 slots are already taken.`}
      >
        <span className="pg-gcity__cost" tabIndex={0}>
          <span className="pg-gcity__break tt-caption">
            {target.routeCost}
            <i>+</i>
            {target.slotCost}
          </span>
          <Money value={target.total} size="sm" tone={target.affordable ? 'default' : 'loss'} />
        </span>
      </Tooltip>
      <Tooltip
        placement="left"
        title={target.affordable ? `Connect ${city?.name ?? target.cityId}` : 'You cannot pay for that'}
        rule="§8 Build Houses"
        content={
          target.affordable
            ? 'Pays the route and slot cost to the bank and places your house immediately; your network count updates at once.'
            : `Connecting costs ${target.total}₤ and you hold ${money}₤. §8: a player may connect no city unless they can pay all connection and building costs.`
        }
      >
        <span className="pg-gactions__wrap">
          <Button
            size="sm"
            variant={target.affordable ? 'secondary' : 'ghost'}
            disabled={!target.affordable}
            onClick={() => net.action({ type: 'buildCity', cityId: target.cityId })}
          >
            Connect
          </Button>
        </span>
      </Tooltip>
    </motion.div>
  );
}
