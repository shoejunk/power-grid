import { motion } from 'framer-motion';
import { useState } from 'react';
import { REFILL_TABLE } from '@pg/shared';
import type { ResourceBundle, ResourceType } from '@pg/shared';

import { springSnappy } from '../styles/motion';
import { Button, Hint, Modal, Panel, Tooltip } from '../ui';
import { useMatch } from './model';
import { RESOURCE_META, RESOURCE_ORDER } from './format';

/** Every price that appears on any track, so all four rows align by price. §1. */
const PRICE_LADDER: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16];

export interface ResourceMarketProps {
  /** Tokens the player is currently building into a purchase, previewed on the track. */
  draft?: ResourceBundle | null;
}

/**
 * The resource market as the printed price track: one column per price, one row
 * per resource, occupancy drawn as tokens sitting on their space.
 *
 * §7: "Each token costs the price of its market space", and purchases always come
 * off the cheapest occupied space — so a draft purchase lifts tokens from the
 * left, which is exactly what the preview shows.
 */
export function ResourceMarket({ draft = null }: ResourceMarketProps): JSX.Element {
  const { state } = useMatch();

  return (
    <Panel
      padding="tight"
      className="pg-gcard pg-gcard--resources"
      title="Resource market"
      subtitle="Buy from the cheapest space first"
      actions={
        <div className="pg-gactions">
          <ResupplySummaryButton />
          <Hint
            placement="left"
            title="Resource market"
            rule="§1, §7, §9.2"
            content="Every space has a printed price and holds up to three tokens (uranium holds one). You pay the price of the space each token is taken from, always starting with the cheapest. Resupply during Phase 5 fills the most expensive empty spaces first."
          />
        </div>
      }
    >
      <div className="pg-gtrack" role="table" aria-label="Resource market price track">
        <div className="pg-gtrack__head" role="row">
          <span className="pg-gtrack__label tt-overline" role="columnheader">
            ₤
          </span>
          {PRICE_LADDER.map((price) => (
            <span key={price} className="pg-gtrack__price tt-numeral" role="columnheader">
              {price}
            </span>
          ))}
        </div>

        {RESOURCE_ORDER.map((type) => (
          <TrackRow
            key={type}
            type={type}
            spaces={state.resourceMarket[type]}
            wanted={draft ? (draft[type] ?? 0) : 0}
            supply={state.supply[type] ?? 0}
          />
        ))}
      </div>
    </Panel>
  );
}

function ResupplySummaryButton(): JSX.Element {
  const { state } = useMatch();
  const [open, setOpen] = useState(false);
  const refill = REFILL_TABLE[state.settings.mapId][state.settings.playerCount]!;
  const steps = [1, 2, 3] as const;

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Resupply table
      </Button>
      {open ? (
        <Modal
          open
          onClose={() => setOpen(false)}
          title="Resource resupply table"
          description={`${state.settings.playerCount}-player game - tokens added during Phase 5.`}
          width="560px"
        >
          <div className="pg-grefill">
            <span className="tt-overline pg-gsectionlabel">Tokens added from the supply</span>
            <div className="pg-grefill__table" role="table" aria-label="Resource resupply table">
              <div className="pg-grefill__row pg-grefill__row--head" role="row">
                <span className="pg-grefill__label tt-overline" role="columnheader">
                  Resource
                </span>
                {steps.map((step) => (
                  <span
                    key={step}
                    className="pg-grefill__cell pg-grefill__step tt-numeral"
                    data-active={state.step === step}
                    role="columnheader"
                  >
                    Step {step}
                  </span>
                ))}
              </div>
              {RESOURCE_ORDER.map((type) => {
                const meta = RESOURCE_META[type];
                return (
                  <div key={type} className="pg-grefill__row" role="row">
                    <span className="pg-grefill__label" role="rowheader">
                      <span className="pg-gtok pg-gtok--xs" data-res={type} aria-hidden="true">
                        {meta.mark}
                      </span>
                      {meta.label}
                    </span>
                    {steps.map((step) => (
                      <span
                        key={step}
                        className="pg-grefill__cell tt-numeral"
                        data-active={state.step === step}
                        role="cell"
                      >
                        {refill[step][type]}
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
            <p className="tt-caption">
              The highlighted column is the current Step. These values fill the most expensive empty spaces first.{' '}
              <em>Rule 9.2</em>
            </p>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function TrackRow({
  type,
  spaces,
  wanted,
  supply,
}: {
  type: ResourceType;
  spaces: { price: number; capacity: number; filled: number }[];
  wanted: number;
  supply: number;
}): JSX.Element {
  const meta = RESOURCE_META[type];
  const byPrice = new Map(spaces.map((s) => [s.price, s]));
  const onMarket = spaces.reduce((sum, s) => sum + s.filled, 0);

  // Preview: the cheapest `wanted` tokens are the ones that would leave the board.
  let remaining = wanted;
  const takenAt = new Map<number, number>();
  for (const space of spaces) {
    if (remaining <= 0) break;
    const take = Math.min(space.filled, remaining);
    if (take > 0) takenAt.set(space.price, take);
    remaining -= take;
  }

  return (
    <div className="pg-gtrack__row" role="row" data-res={type}>
      <Tooltip
        placement="right"
        title={meta.label}
        rule="§1 Resources, §7"
        content={`${onMarket} on the market, ${supply} left in the supply. ${
          onMarket === 0
            ? 'Sold out — nothing of this type can be bought until the next Phase 5 resupply.'
            : 'Tokens are always taken from the cheapest occupied space.'
        }`}
      >
        <span className="pg-gtrack__label" role="rowheader" tabIndex={0}>
          <span className="pg-gtok pg-gtok--xs" data-res={type} aria-hidden="true">
            {meta.mark}
          </span>
          <span className="pg-gtrack__name">{meta.label}</span>
          <span className="pg-gtrack__count tt-numeral">{onMarket}</span>
        </span>
      </Tooltip>

      {PRICE_LADDER.map((price) => {
        const space = byPrice.get(price);
        if (!space) return <span key={price} className="pg-gtrack__cell is-absent" role="cell" />;
        const taken = takenAt.get(price) ?? 0;
        return (
          <span key={price} className="pg-gtrack__cell" role="cell">
            {Array.from({ length: space.capacity }, (_, i) => {
              const index = space.capacity - 1 - i;
              const filled = index < space.filled;
              const isTaken = filled && index >= space.filled - taken;
              return (
                <motion.span
                  key={i}
                  className={[
                    'pg-gtrack__pip',
                    filled ? 'is-filled' : '',
                    isTaken ? 'is-taken' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  data-res={type}
                  animate={{ scale: isTaken ? 0.72 : 1, opacity: filled ? 1 : 0.25 }}
                  transition={springSnappy}
                />
              );
            })}
          </span>
        );
      })}
    </div>
  );
}
