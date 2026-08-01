import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import type { OwnedPlant } from '@pg/shared';
import { getPlant, isEcological, isHybrid } from '@pg/shared';

import { springSnappy } from '../../styles/motion';
import { Tooltip } from '../../ui';
import { citiesText, fuelText, plantArtFor, plantKind, plantRuleText } from '../format';
import { StorageBar, Token } from './Tokens';

export type PlantCardSize = 'xs' | 'sm' | 'md';

export interface PlantCardProps {
  plantId: number;
  size?: PlantCardSize;
  /** Discount token sits on this plant: minimum bid is 1₤. §6. */
  discounted?: boolean;
  /** Printed under the number when the card is biddable. */
  minimumBid?: number;
  /** Renders the plant's stored fuel underneath. Owned plants only. */
  owned?: OwnedPlant;
  selected?: boolean;
  onSelect?: () => void;
  /**
   * When set, the card is rendered disabled and the tooltip states the rule that
   * forbids choosing it (quality bar U2).
   */
  disabledReason?: string | null;
  /** Rules citation for `disabledReason`. */
  disabledRule?: string;
  /** Dimmed treatment for the non-biddable future market. §6. */
  muted?: boolean;
  badge?: ReactNode;
  className?: string;
}

/**
 * A power plant card.
 *
 * Reads as the printed card: the number plate (which is also the minimum bid,
 * the market sort key and the tie-break value, §1), the fuel it burns, and the
 * cities it supplies. The illustration accent comes from `@/art` and has no
 * gameplay meaning — §1 is explicit about that — so it is never the only channel
 * carrying the fuel type.
 */
export function PlantCard({
  plantId,
  size = 'sm',
  discounted = false,
  minimumBid,
  owned,
  selected = false,
  onSelect,
  disabledReason = null,
  disabledRule,
  muted = false,
  badge,
  className,
}: PlantCardProps): JSX.Element {
  const def = getPlant(plantId);
  const art = plantArtFor(def);
  const disabled = disabledReason !== null;
  const interactive = onSelect !== undefined;

  const classes = [
    'pg-gplant',
    `pg-gplant--${size}`,
    selected ? 'is-selected' : '',
    muted ? 'is-muted' : '',
    disabled ? 'is-disabled' : '',
    interactive ? 'is-interactive' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  if (def.isStep3) {
    return (
      <Tooltip
        placement="left"
        title="Step 3 card"
        rule="§10 Game Steps and transitions"
        content="Not a power plant. It sorts as the highest card, and Step 3 begins at the start of the phase after it is drawn."
      >
        <div className={`${classes} pg-gplant--step3`} tabIndex={0}>
          <span className="pg-gplant__step3">STEP 3</span>
        </div>
      </Tooltip>
    );
  }

  const body = (
    <>
      <span className="pg-gplant__accent" style={{ background: art.accent }} aria-hidden="true" />
      <span className="pg-gplant__num pg-numeral">{plantId}</span>
      <span className="pg-gplant__mid">
        <span className="pg-gplant__fuel">
          {isEcological(def) ? (
            <span className="pg-gplant__eco">ECO</span>
          ) : (
            <>
              {Array.from({ length: def.fuel }, (_, i) => (
                <Token key={i} type={def.accepts[0]!} size="xs" />
              ))}
              {isHybrid(def) ? <Token type="oil" size="xs" className="pg-gplant__alt" /> : null}
            </>
          )}
        </span>
        <span className="pg-gplant__arrow" aria-hidden="true">
          ▸
        </span>
        <span className="pg-gplant__cities pg-numeral">{def.cities}</span>
      </span>
      {discounted ? (
        <motion.span
          className="pg-gplant__discount"
          layoutId="pg-discount-token"
          transition={springSnappy}
          title="Discount token — minimum bid 1₤"
        >
          1₤
        </motion.span>
      ) : null}
      {minimumBid !== undefined && !discounted ? (
        <span className="pg-gplant__min">min {minimumBid}₤</span>
      ) : null}
      {badge}
    </>
  );

  const tooltip = (
    <Tooltip
      placement="left"
      title={`Plant ${plantId} — ${art.title}`}
      rule={disabled ? (disabledRule ?? '§14 Legal-action validation') : '§1 Power plants'}
      content={
        <>
          <span className="pg-gplant__tipline">
            {fuelText(def)} → {citiesText(def)}
          </span>
          <span className="pg-gplant__tipbody">{plantRuleText(def)}</span>
          {discounted ? (
            <span className="pg-gplant__tipbody">
              The discount token is on this plant, so its minimum opening bid is 1 Elektro instead of{' '}
              {plantId}.
            </span>
          ) : null}
          {disabled ? <span className="pg-gplant__tipblock">{disabledReason}</span> : null}
        </>
      }
    >
      {interactive ? (
        <motion.button
          type="button"
          className={classes}
          data-kind={plantKind(def)}
          disabled={disabled}
          aria-pressed={selected}
          onClick={onSelect}
          whileHover={disabled ? undefined : { y: -2 }}
          whileTap={disabled ? undefined : { scale: 0.97 }}
          transition={springSnappy}
        >
          {body}
        </motion.button>
      ) : (
        <div className={classes} data-kind={plantKind(def)} tabIndex={0}>
          {body}
        </div>
      )}
    </Tooltip>
  );

  if (!owned) return tooltip;

  return (
    <div className="pg-gplantwrap">
      {tooltip}
      <StorageBar plant={owned} compact />
    </div>
  );
}
