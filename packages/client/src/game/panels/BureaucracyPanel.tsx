import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import type { GameState, PowerOption, ResourceBundle } from '@pg/shared';
import {
  PAYMENT_TABLE,
  RESOURCE_TYPES,
  emptyResources,
  fuelSlots,
  maxFlowAssign,
  payoutFor,
  rowToBundle,
  storedPool,
} from '@pg/shared';

import { net } from '../../net';
import { springSoft } from '../../styles/motion';
import { Badge, Button, Money, NumberStepper, Tooltip } from '../../ui';
import { plural } from '../format';
import { useMatch } from '../model';
import { Token } from '../parts/Tokens';
import { Callout, PhaseShell, Stat, Waiting, type RuleLine } from './shell';

const POWER_RULES: readonly RuleLine[] = [
  { text: 'Cash is paid from first to last in player order.', rule: '§4, §9.1' },
  { text: 'An operating plant burns exactly its fuel requirement — never fewer, never more tokens.', rule: '§1, §9.1' },
  { text: 'A plant supplies at most its printed number of cities; storage does not raise that.', rule: '§1' },
  { text: 'Generation above the cities you supply is wasted. You cannot half-run a plant.', rule: '§1' },
  { text: 'Supplying zero cities still pays the guaranteed minimum of 10₤.', rule: '§9.1' },
];

export function BureaucracyPanel(): JSX.Element {
  const { state, me, meId, legal } = useMatch();
  const options = legal.powerOptions;
  const network = me?.cities.length ?? 0;

  const best = useMemo(
    () => options.reduce<PowerOption | null>((acc, o) => (acc && acc.maxCities >= o.maxCities ? acc : o), null),
    [options],
  );

  const [chosen, setChosen] = useState<string | null>(null);
  const [cities, setCities] = useState(0);

  useEffect(() => {
    if (!best) return;
    setChosen(best.plantIds.join(','));
    setCities(best.maxCities);
  }, [best]);

  if (!legal.isActive || !me || !meId) {
    return (
      <PhaseShell title="Bureaucracy" subtitle="Phase 5 · player order" rules={POWER_RULES}>
        <Waiting note="Choosing which plants to operate and how many cities to supply (§9.1)." />
        <PaymentTable highlight={null} />
      </PhaseShell>
    );
  }

  const option = options.find((o) => o.plantIds.join(',') === chosen) ?? best ?? null;
  const capacity = option?.capacity ?? 0;
  const maxCities = option?.maxCities ?? 0;
  const wasted = Math.max(0, capacity - cities);
  const payout = payoutFor(cities);
  const burn = option ? consumption(state, meId, option.plantIds) : emptyResources();
  const burnTotal = RESOURCE_TYPES.reduce((s, t) => s + burn[t], 0);

  return (
    <PhaseShell
      title="Produce electricity"
      subtitle="Phase 5 · your turn"
      tone="live"
      rules={POWER_RULES}
      actions={
        <Badge tone="accent" dot>
          Acting
        </Badge>
      }
      footer={
        <div className="pg-gactions">
          <Tooltip
            placement="top"
            title={`Earn ${payout}₤`}
            rule="§9.1 Earning cash and producing electricity"
            content={`Burns ${burnTotal} ${plural(burnTotal, 'token')} from the chosen plants and pays the payment-summary figure for ${cities} supplied ${plural(cities, 'city', 'cities')}. Consumed fuel returns to the supply, never to the market.`}
          >
            <span className="pg-gactions__wrap">
              <Button
                variant="primary"
                disabled={option === null}
                onClick={() => {
                  if (!option) return;
                  net.action({
                    type: 'powerCities',
                    decision: { operatePlantIds: option.plantIds, citiesSupplied: cities },
                  });
                }}
              >
                Supply {cities} for {payout}₤
              </Button>
            </span>
          </Tooltip>
        </div>
      }
    >
      <div className="pg-gsummary">
        <Stat label="Network" value={<span className="pg-numeral">{network}</span>} />
        <Stat label="Generation" value={<span className="pg-numeral">{capacity}</span>} />
        <Stat label="Payout" value={<Money value={payout} tone="gain" />} />
      </div>

      <span className="pg-overline pg-gsectionlabel">Which plants run</span>
      <div className="pg-gcombos" role="radiogroup" aria-label="Plants to operate">
        {options.map((o) => {
          const key = o.plantIds.join(',');
          const selected = key === (option?.plantIds.join(',') ?? '');
          return (
            <button
              key={key || 'none'}
              type="button"
              role="radio"
              aria-checked={selected}
              className="pg-gcombo"
              data-selected={selected}
              onClick={() => {
                setChosen(key);
                setCities(o.maxCities);
              }}
            >
              <span className="pg-gcombo__plants">
                {o.plantIds.length === 0 ? (
                  <span className="pg-gcombo__none">Run nothing</span>
                ) : (
                  o.plantIds.map((id) => (
                    <span key={id} className="pg-gcombo__chip pg-numeral">
                      {id}
                    </span>
                  ))
                )}
              </span>
              <span className="pg-gcombo__cap">
                <b className="pg-numeral">{o.capacity}</b> generated
              </span>
              <span className="pg-gcombo__pay">
                <Money value={o.payoutAtMax} size="sm" tone="gain" />
              </span>
            </button>
          );
        })}
      </div>

      {option && option.plantIds.length > 0 ? (
        <div className="pg-gburn">
          <span className="pg-overline">Fuel burnt</span>
          <span className="pg-gburn__tokens">
            {burnTotal === 0 ? (
              <span className="pg-caption">Nothing — ecological plants burn no fuel (§1).</span>
            ) : (
              RESOURCE_TYPES.flatMap((t) =>
                Array.from({ length: burn[t] }, (_, i) => <Token key={`${t}-${i}`} type={t} size="sm" />),
              )
            )}
          </span>
        </div>
      ) : null}

      <div className="pg-gsupply">
        <span className="pg-overline">Cities to supply</span>
        <NumberStepper
          label="Cities to supply"
          value={cities}
          min={0}
          max={maxCities}
          onChange={setCities}
          unit={plural(cities, 'city', 'cities')}
        />
        <span className="pg-caption">
          Capped at {maxCities} — the lower of your generation ({capacity}) and your network ({network}).
        </span>
      </div>

      {wasted > 0 ? (
        <Callout tone="warning" title={`${wasted} generation wasted`}>
          Those plants produce {capacity} but you are supplying {cities}. §1 forbids running a plant at part
          capacity — the surplus is simply lost, and the fuel is spent all the same.
        </Callout>
      ) : null}

      {cities === 0 ? (
        <Callout tone="info" title="Supplying nothing still pays 10₤">
          §9.1 guarantees a minimum of 10 Elektro even when you power no cities.
        </Callout>
      ) : null}

      <PaymentTable highlight={cities} />
    </PhaseShell>
  );
}

/** The payment summary card, §9.1 — the actual table the payout is read from. */
function PaymentTable({ highlight }: { highlight: number | null }): JSX.Element {
  return (
    <div className="pg-gpay">
      <span className="pg-overline pg-gsectionlabel">Payment summary (§9.1)</span>
      <div className="pg-gpay__grid">
        {PAYMENT_TABLE.map((amount, cities) => (
          <motion.div
            key={cities}
            className="pg-gpay__cell"
            data-active={cities === highlight}
            animate={{ scale: cities === highlight ? 1.06 : 1 }}
            transition={springSoft}
          >
            <span className="pg-gpay__cities pg-numeral">{cities}</span>
            <span className="pg-gpay__amount pg-numeral">{amount}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/** Exactly which tokens the engine will burn for a plant set. §9.1. */
function consumption(
  state: GameState,
  playerId: string,
  plantIds: readonly number[],
): ResourceBundle {
  const pool = storedPool(state, playerId);
  const { alloc } = maxFlowAssign(pool, fuelSlots(plantIds));
  const out = emptyResources();
  for (const row of alloc) {
    const bundle = rowToBundle(row);
    for (const t of RESOURCE_TYPES) out[t] += bundle[t];
  }
  return out;
}
