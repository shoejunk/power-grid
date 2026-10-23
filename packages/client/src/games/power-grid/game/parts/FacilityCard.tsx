import { getFacility } from '@game/power-grid';
import { Tooltip } from '@tt/ui';
import type { PlantCardProps } from './PlantCard';
import { Token } from './Tokens';

export function FacilityCard({ plantId, size = 'sm', minimumBid, selected, onSelect, disabledReason, badge, className }: PlantCardProps): JSX.Element {
  const facility = getFacility(plantId);
  const disabled = !!disabledReason;
  const classes = `pg-facility pg-facility--${size} ${selected ? 'is-selected' : ''} ${className ?? ''}`;
  const content = <>
    <span className="pg-facility__size">{facility.size}</span>
    <Token type={facility.resource} size="sm" />
    <strong className="pg-facility__output">+{facility.output}<small>/round</small></strong>
    <span className="pg-facility__name">{facility.resource === 'garbage' ? 'Recycling' : facility.resource}</span>
    <span className="pg-facility__price">{minimumBid === undefined ? `${facility.cost}₤` : `min ${minimumBid}₤`}</span>
    {badge}
  </>;
  return <Tooltip title={facility.name} rule="Industry" placement="left"
    content={`${facility.output} ${facility.resource} per round. Minimum auction bid ${facility.cost} Elektro. Automatic public-market sales earn the filled slot prices less 1 Elektro per token; no income for undelivered output. ${disabledReason ?? ''}`}>
    {onSelect ? <button type="button" className={classes} data-res={facility.resource} aria-label={facility.name}
      aria-pressed={!!selected} aria-disabled={disabled} onClick={disabled ? undefined : onSelect}>{content}</button>
      : <div className={classes} data-res={facility.resource} tabIndex={0} aria-label={facility.name}>{content}</div>}
  </Tooltip>;
}
