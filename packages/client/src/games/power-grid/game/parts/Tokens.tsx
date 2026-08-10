import { motion } from 'framer-motion';
import type { OwnedPlant, ResourceBundle, ResourceType } from '@pg/shared';
import { getPlant, isEcological, isHybrid } from '@pg/shared';

import { springSnappy } from '../../styles/motion';
import { RESOURCE_META, RESOURCE_ORDER } from '../format';
import { Tooltip } from '../../ui';

/* ------------------------------------------------------------------ *
 * A single resource token
 * ------------------------------------------------------------------ */

export interface TokenProps {
  type: ResourceType;
  size?: 'xs' | 'sm' | 'md';
  /** Empty socket rather than a token — used for spare storage capacity. */
  ghost?: boolean;
  className?: string;
}

/**
 * The physical token. Fill carries the resource colour, the stamped letter
 * carries it again for colour-blind readers (quality bar V3).
 */
export function Token({ type, size = 'sm', ghost = false, className }: TokenProps): JSX.Element {
  const meta = RESOURCE_META[type];
  return (
    <span
      className={['pg-gtok', `pg-gtok--${size}`, ghost ? 'is-ghost' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      data-res={type}
      aria-hidden="true"
    >
      {ghost ? '' : meta.mark}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Storage bar (§1 "A plant can store at most twice its operating fuel
 * requirement ... twice the requirement across both resource types")
 * ------------------------------------------------------------------ */

export interface StorageBarProps {
  plant: OwnedPlant;
  /** Tokens the player is about to add, drawn as pending sockets. */
  incoming?: ResourceBundle;
  compact?: boolean;
}

/**
 * One bar per owned plant. A hybrid renders a *single* bar carrying both coal
 * and oil, because §1 shares the capacity across the two types rather than
 * granting each its own.
 */
export function StorageBar({ plant, incoming, compact = false }: StorageBarProps): JSX.Element {
  const def = getPlant(plant.plantId);
  const capacity = def.fuel * 2;
  const eco = isEcological(def);

  const cells: { key: string; type: ResourceType | null; pending: boolean }[] = [];
  for (const type of RESOURCE_ORDER) {
    const n = plant.stored[type] ?? 0;
    for (let i = 0; i < n; i++) cells.push({ key: `${type}-${i}`, type, pending: false });
  }
  const held = cells.length;
  if (incoming) {
    for (const type of RESOURCE_ORDER) {
      if (!def.accepts.includes(type)) continue;
      const n = incoming[type] ?? 0;
      for (let i = 0; i < n; i++) {
        if (cells.length >= capacity) break;
        cells.push({ key: `in-${type}-${i}`, type, pending: true });
      }
    }
  }
  while (cells.length < capacity) cells.push({ key: `empty-${cells.length}`, type: null, pending: false });

  const accepts = eco
    ? 'stores nothing'
    : isHybrid(def)
      ? `${capacity} coal and/or oil`
      : `${capacity} ${RESOURCE_META[def.accepts[0] as ResourceType].label.toLowerCase()}`;

  return (
    <Tooltip
      placement="left"
      title={`Plant ${plant.plantId} storage`}
      rule="§1 Power plants"
      content={
        eco
          ? 'Ecological plants require no resources and cannot store any.'
          : `Holding ${held} of ${capacity}. Capacity is twice the plant's fuel requirement (${accepts}).`
      }
    >
      <div
        className={['pg-gstore', compact ? 'is-compact' : ''].filter(Boolean).join(' ')}
        tabIndex={0}
        role="img"
        aria-label={`Plant ${plant.plantId}: ${held} of ${capacity} fuel stored`}
      >
        {eco ? (
          <span className="pg-gstore__eco">ECO</span>
        ) : (
          cells.slice(0, capacity).map((cell) => (
            <motion.span
              key={cell.key}
              className={['pg-gstore__cell', cell.pending ? 'is-pending' : ''].filter(Boolean).join(' ')}
              data-res={cell.type ?? 'none'}
              layout
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={springSnappy}
            />
          ))
        )}
      </div>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ *
 * Fuel requirement row on a plant card
 * ------------------------------------------------------------------ */

export function FuelRow({ plantId, size = 'xs' }: { plantId: number; size?: 'xs' | 'sm' }): JSX.Element {
  const def = getPlant(plantId);
  if (isEcological(def)) {
    return <span className="pg-gfuel pg-gfuel--eco">ECO</span>;
  }
  const type = def.accepts[0] as ResourceType;
  return (
    <span className="pg-gfuel">
      {Array.from({ length: def.fuel }, (_, i) => (
        <Token key={i} type={type} size={size} />
      ))}
      {isHybrid(def) ? <span className="pg-gfuel__or">/ oil</span> : null}
    </span>
  );
}
