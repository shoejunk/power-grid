import { motion } from 'framer-motion';
import type { ResourceBundle, ResourceOption, ResourceType } from '@pg/shared';
import {
  RESOURCE_TYPES,
  USA_COAL_STORAGE_PRICE,
  emptyResources,
  getPlant,
  poolStorable,
  purchaseCost,
  storedPool,
} from '@pg/shared';

import { net } from '../../net';
import { springSoft } from '../../styles/motion';
import { Badge, Button, Money, NumberStepper, Tooltip } from '../../ui';
import { RESOURCE_META, plantStorage } from '../format';
import { useMatch } from '../model';
import { StorageBar, Token } from '../parts/Tokens';
import { Callout, PhaseShell, Stat, Waiting, type RuleLine } from './shell';

const RESOURCE_RULES: readonly RuleLine[] = [
  { text: 'Players buy in reverse player order, starting with the last player.', rule: '§4, §7' },
  { text: 'You may only buy resources one of your plants can burn, and only as many as they can store.', rule: '§7, §14' },
  { text: 'Every token costs the price printed on its market space; the cheapest occupied space is emptied first.', rule: '§7' },
  { text: 'A plant stores twice its fuel requirement. A hybrid shares that capacity across coal and oil.', rule: '§1' },
  { text: 'A resource type that is sold out cannot be bought again until the Phase 5 resupply.', rule: '§7, §14' },
];

export interface ResourcePanelProps {
  draft: ResourceBundle;
  setDraft: (draft: ResourceBundle) => void;
}

export function ResourcePanel({ draft, setDraft }: ResourcePanelProps): JSX.Element {
  const { state, me, meId, legal } = useMatch();

  if (!legal.isActive || !me || !meId) {
    return (
      <PhaseShell title="Buy Resources" subtitle="Phase 3 · reverse player order" rules={RESOURCE_RULES}>
        <Waiting note="Buying fuel for the plants they own, in reverse player order (§7)." />
        <MyStorage draft={null} />
      </PhaseShell>
    );
  }

  const total = RESOURCE_TYPES.reduce(
    (sum, type) => sum + (purchaseCost(state, type, draft[type] ?? 0) ?? 0),
    0,
  );
  const tokens = RESOURCE_TYPES.reduce((sum, type) => sum + (draft[type] ?? 0), 0);

  const pool = storedPool(state, meId);
  for (const type of RESOURCE_TYPES) pool[type] += draft[type] ?? 0;
  const storable = poolStorable(state, meId, pool);
  const affordable = total <= me.money;

  const blockedReason = !storable
    ? 'Together those tokens exceed what your plants can store.'
    : !affordable
      ? `That costs ${total}₤ and you hold ${me.money}₤.`
      : tokens === 0
        ? 'Add at least one token to buy.'
        : null;

  const setCount = (type: ResourceType, value: number): void =>
    setDraft({ ...draft, [type]: value });

  return (
    <PhaseShell
      title="Buy Resources"
      subtitle="Phase 3 · your turn"
      tone="live"
      rules={RESOURCE_RULES}
      actions={
        <Badge tone="accent" dot>
          Acting
        </Badge>
      }
      footer={
        <div className="pg-gactions">
          <Button
            variant="ghost"
            onClick={() => {
              setDraft(emptyResources());
              net.action({ type: 'passResources' });
            }}
          >
            Done
          </Button>
          <Tooltip
            placement="top"
            title={blockedReason ? 'Cannot buy' : `Buy ${tokens} tokens`}
            rule="§7 Buy Resources"
            content={
              blockedReason ??
              `Pays ${total}₤ to the bank, taking each token from the cheapest occupied space of its track.`
            }
          >
            <span className="pg-gactions__wrap">
              <Button
                variant="primary"
                disabled={blockedReason !== null}
                onClick={() => {
                  net.action({
                    type: 'buyResources',
                    purchases: RESOURCE_TYPES.filter((t) => (draft[t] ?? 0) > 0).map((t) => ({
                      resource: t,
                      count: draft[t]!,
                    })),
                  });
                  setDraft(emptyResources());
                }}
              >
                Buy for {total}₤
              </Button>
            </span>
          </Tooltip>
        </div>
      }
    >
      <div className="pg-gbuy">
        {legal.resourceOptions.map((option) => (
          <ResourceRow
            key={option.resource}
            option={option}
            value={draft[option.resource] ?? 0}
            onChange={(v) => setCount(option.resource, v)}
            costOf={(n) => purchaseCost(state, option.resource, n) ?? 0}
          />
        ))}
      </div>

      <div className="pg-gsummary">
        <Stat label="Tokens" value={<span className="tt-numeral">{tokens}</span>} />
        <Stat label="Cost" value={<Money value={total} tone="loss" />} />
        <Stat label="After purchase" value={<Money value={me.money - total} />} />
      </div>

      {!storable && tokens > 0 ? (
        <Callout tone="warning" title="Over your storage capacity">
          Each plant holds twice its fuel requirement, and a hybrid shares that total across coal and oil.
          Reduce the purchase until it fits. <em>§1, §7</em>
        </Callout>
      ) : null}

      <MyStorage draft={draft} />
    </PhaseShell>
  );
}

/* ------------------------------------------------------------------ *
 * One market row
 * ------------------------------------------------------------------ */

function ResourceRow({
  option,
  value,
  onChange,
  costOf,
}: {
  option: ResourceOption;
  value: number;
  onChange: (value: number) => void;
  costOf: (n: number) => number;
}): JSX.Element {
  const meta = RESOURCE_META[option.resource];
  const blocked = option.maxCount === 0;
  const cost = costOf(value);
  const nextCost = costOf(value + 1) - cost;

  return (
    <div className="pg-gbuy__row" data-res={option.resource} data-blocked={blocked}>
      <Token type={option.resource} size="sm" />
      <span className="pg-gbuy__name">{meta.label}</span>
      <span className="pg-gbuy__avail tt-caption">
        <span className="tt-numeral">{option.available}</span> available
      </span>

      <Tooltip
        placement="left"
        title={blocked ? `Cannot buy ${meta.label.toLowerCase()}` : `Next token costs ${nextCost}₤`}
        rule={blocked ? '§7, §14 Legal-action validation' : '§7 Buy Resources'}
        content={
          blocked
            ? (option.blockedReason ?? 'No legal purchase of this resource is available.')
            : `You may take up to ${option.maxCount}, limited by the market, your storage and your money. Tokens come off the cheapest occupied space first.`
        }
      >
        <span className="pg-gbuy__ctrl">
          <NumberStepper
            label={`${meta.label} tokens`}
            value={value}
            min={0}
            max={option.maxCount}
            onChange={onChange}
            disabled={blocked}
          />
        </span>
      </Tooltip>

      <span className="pg-gbuy__cost">
        {blocked ? (
          <span className="pg-gbuy__blocked">{option.blockedReason}</span>
        ) : (
          <Money value={cost} tone={value > 0 ? 'loss' : 'muted'} size="sm" />
        )}
      </span>

      {option.fromUsaCoalStorage ? (
        <span className="pg-gbuy__note tt-caption">
          from storage at {USA_COAL_STORAGE_PRICE}₤ (§12)
        </span>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Storage readout
 * ------------------------------------------------------------------ */

function MyStorage({ draft }: { draft: ResourceBundle | null }): JSX.Element | null {
  const { me, state, meId } = useMatch();
  if (!me) return null;

  if (me.plants.length === 0) {
    return (
      <Callout tone="info" title="You own no plants">
        With no plant to burn them, §7 forbids buying any resources at all this round.
      </Callout>
    );
  }

  // Show where the drafted tokens would actually land: the engine repacks the
  // whole pool after a purchase, so a per-plant preview must do the same.
  let preview: Map<number, ResourceBundle> | null = null;
  if (draft && meId) {
    const pool = storedPool(state, meId);
    for (const t of RESOURCE_TYPES) pool[t] += draft[t] ?? 0;
    if (poolStorable(state, meId, pool)) preview = spread(me.plants.map((p) => p.plantId), pool);
  }

  return (
    <div className="pg-gstorage">
      <span className="tt-overline pg-gsectionlabel">Your storage</span>
      {me.plants
        .slice()
        .sort((a, b) => a.plantId - b.plantId)
        .map((owned) => {
          const def = getPlant(owned.plantId);
          const after = preview?.get(owned.plantId);
          const incoming = after ? diff(after, owned.stored) : undefined;
          const held = RESOURCE_TYPES.reduce((s, t) => s + (owned.stored[t] ?? 0), 0);
          return (
            <motion.div key={owned.plantId} className="pg-gstorage__row" layout transition={springSoft}>
              <span className="pg-gstorage__id tt-numeral">{owned.plantId}</span>
              <span className="pg-gstorage__meta">
                <span className="pg-gstorage__fuel">
                  {def.accepts.length === 0
                    ? 'ecological'
                    : def.accepts.map((t) => RESOURCE_META[t].label.toLowerCase()).join(' / ')}
                </span>
                <span className="pg-gstorage__cap tt-caption">
                  <span className="tt-numeral">{held}</span> / {plantStorage(owned.plantId)}
                </span>
              </span>
              <StorageBar plant={owned} {...(incoming ? { incoming } : {})} />
            </motion.div>
          );
        })}
    </div>
  );
}

/** Greedy repack that mirrors the engine's allocation for preview purposes only. */
function spread(plantIds: readonly number[], pool: ResourceBundle): Map<number, ResourceBundle> {
  const out = new Map<number, ResourceBundle>();
  const left = { ...pool };
  const ordered = plantIds.slice().sort((a, b) => {
    const pa = getPlant(a);
    const pb = getPlant(b);
    return pa.accepts.length - pb.accepts.length || a - b;
  });
  for (const id of ordered) out.set(id, emptyResources());
  for (const id of ordered) {
    const def = getPlant(id);
    const bundle = out.get(id)!;
    let room = def.fuel * 2;
    for (const type of def.accepts) {
      const take = Math.min(room, left[type] ?? 0);
      bundle[type] += take;
      left[type] -= take;
      room -= take;
    }
  }
  return out;
}

function diff(after: ResourceBundle, before: ResourceBundle): ResourceBundle {
  const out = emptyResources();
  for (const t of RESOURCE_TYPES) out[t] = Math.max(0, (after[t] ?? 0) - (before[t] ?? 0));
  return out;
}
