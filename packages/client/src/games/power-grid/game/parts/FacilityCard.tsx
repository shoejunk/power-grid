import { motion } from 'framer-motion';
import { getFacility, getPlant } from '@game/power-grid';
import { springSnappy, Tooltip } from '@tt/ui';
import type { PlantCardProps } from './PlantCard';
import { plantArtFor } from '../format';
import { Token } from './Tokens';

const RESOURCE_ART = { coal: 4, oil: 3, garbage: 6, uranium: 11 } as const;

export function FacilityCard({ plantId, rulesVersion = 6, size = 'sm', minimumBid, discounted = false, muted = false,
  selected = false, onSelect, disabledReason = null, badge, className }: PlantCardProps): JSX.Element {
  const facility = getFacility(plantId, rulesVersion);
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
    {minimumBid !== undefined && !discounted ? <span className="pg-gplant__min">min {minimumBid}₤</span> : null}
    {badge}
  </>;
  return <Tooltip title={facility.name} rule="Industry" placement="left"
    content={`${facility.output} ${facility.resource} produced per round. The factory symbol marks a facility: it supplies resources, not cities. Minimum bid ${discounted ? 1 : facility.cost} Elektro. Sales earn filled-slot prices less 1 Elektro per delivered token. ${disabledReason ?? ''}`}>
    {onSelect ? <motion.button type="button" className={classes} data-kind={facility.resource} aria-label={facility.name}
      aria-pressed={selected} aria-disabled={disabled} onClick={disabled ? undefined : onSelect}
      whileHover={disabled ? undefined : { y: -2 }} whileTap={disabled ? undefined : { scale: .97 }} transition={springSnappy}>{content}</motion.button>
      : <div className={classes} data-kind={facility.resource} tabIndex={0} aria-label={facility.name}>{content}</div>}
  </Tooltip>;
}
