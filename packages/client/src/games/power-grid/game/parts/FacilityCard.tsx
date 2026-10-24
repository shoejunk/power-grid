import { motion } from 'framer-motion';
import { getFacility, getPlant } from '@game/power-grid';
import { springSnappy, Tooltip } from '@tt/ui';
import type { PlantCardProps } from './PlantCard';
import { plantArtFor } from '../format';
import { cardName } from '../cardNames';
import { Token } from './Tokens';

const RESOURCE_ART = { coal: 4, oil: 3, garbage: 6, uranium: 11 } as const;

export function FacilityCard({ plantId, rulesVersion = 8, size = 'sm', discounted = false, muted = false,
  selected = false, onSelect, disabledReason = null, badge, className }: PlantCardProps): JSX.Element {
  const facility = getFacility(plantId, rulesVersion);
  const name = cardName(plantId, rulesVersion);
  const art = plantArtFor(getPlant(RESOURCE_ART[facility.resource]));
  const disabled = disabledReason !== null;
  const classes = ['pg-gplant', `pg-gplant--${size}`, 'pg-facility', selected ? 'is-selected' : '',
    muted ? 'is-muted' : '', disabled ? 'is-disabled' : '', onSelect ? 'is-interactive' : '', className ?? ''].filter(Boolean).join(' ');
  const content = <>
    <span className="pg-gplant__art" style={{ backgroundImage: `url(${art.illustration})` }} aria-hidden="true" />
    <span className="pg-gplant__accent" style={{ background: art.accent }} aria-hidden="true" />
    <span className="pg-gplant__num tt-numeral">{facility.cost}</span>
    <svg className="pg-facility__symbol" viewBox="0 0 16 16" role="img" aria-label="Facility">
        <path d="M1 14V7l5-3v3l5-3v5h2V1h2v13H1Z" />
    </svg>
    <span className="pg-gplant__mid">
      <Token type={facility.resource} size="xs" />
      <span className="pg-gplant__mult">×</span>
      <span className="pg-gplant__cities tt-numeral">{facility.output}</span>
    </span>
    {discounted ? <motion.span className="pg-gplant__discount" layoutId="pg-discount-token" transition={springSnappy}
      title="Discount token — minimum bid 1₤">1₤</motion.span> : null}

    {badge}
  </>;
  return <Tooltip title={name} rule="Industry" placement="left"
    content={`Produces up to ${facility.output} ${facility.resource} each round and automatically sells it to the resource market. You earn income for resources delivered. ${disabledReason ?? ''}`.trim()}>
    {onSelect ? <motion.button type="button" className={classes} data-kind={facility.resource} aria-label={name}
      aria-pressed={selected} aria-disabled={disabled} onClick={disabled ? undefined : onSelect}
      whileHover={disabled ? undefined : { y: -2 }} whileTap={disabled ? undefined : { scale: .97 }} transition={springSnappy}>{content}</motion.button>
      : <div className={classes} data-kind={facility.resource} tabIndex={0} aria-label={name}>{content}</div>}
  </Tooltip>;
}
