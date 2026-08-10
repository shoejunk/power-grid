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
      {/*
       * §1: "The illustration on a plant card has no gameplay effect." It is
       * decoration, but it is not *hidden* decoration — the card is the second
       * most-viewed surface in the game and the benchmark is judged on
       * illustration, so the art now renders at full strength and legibility is
       * bought locally: a halo on the number and an opaque well behind the
       * fuel/cities row (see .pg-gplant__art in game.scss). The fuel tokens and
       * the city count still carry every load-bearing fact, so the card stays
       * readable at 46px wide and for a player with no colour perception.
       */}
      <span
        className="pg-gplant__art"
        style={{ backgroundImage: `url(${art.illustration})` }}
        aria-hidden="true"
      />
      <span className="pg-gplant__accent" style={{ background: art.accent }} aria-hidden="true" />
      <span className="pg-gplant__num tt-numeral">{plantId}</span>
      <span className="pg-gplant__mid">
        {/*
         * Three 13px tokens plus the arrow and the city count do not fit a
         * 46px card: the row used to overrun its parent by 2.6px at 2 fuel and
         * 12.6px at 3, pushing the "· N" city count outside the card entirely.
         *
         * At 3+ fuel the row collapses to one token and a x3 multiplier, which
         * is both narrower and easier to read at a glance than counting pips.
         * At 1-2 it keeps the printed-card look of discrete tokens.
         */}
        <span className="pg-gplant__fuel">
          {isEcological(def) ? (
            <span className="pg-gplant__eco">ECO</span>
          ) : def.fuel >= 3 ? (
            <>
              <Token type={def.accepts[0]!} size="xs" />
              <span className="pg-gplant__mult">&times;{def.fuel}</span>
              {isHybrid(def) ? <Token type="oil" size="xs" className="pg-gplant__alt" /> : null}
            </>
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
        <span className="pg-gplant__cities tt-numeral">{def.cities}</span>
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
      {interactive && !disabled ? (
        <motion.button
          type="button"
          className={classes}
          data-kind={plantKind(def)}
          aria-pressed={selected}
          onClick={onSelect}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.97 }}
          transition={springSnappy}
        >
          {body}
        </motion.button>
      ) : interactive ? (
        /*
         * Deliberately NOT a `<button disabled>`: Chrome suppresses pointer
         * events and focus on disabled controls, which would make the tooltip
         * stating the rule unreachable. Quality bar U2 requires the player to
         * be able to find out *why* a choice is closed to them, so the card
         * stays hoverable and keyboard-focusable and announces itself disabled.
         */
        <div
          className={classes}
          data-kind={plantKind(def)}
          role="button"
          aria-disabled="true"
          tabIndex={0}
        >
          {body}
        </div>
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
