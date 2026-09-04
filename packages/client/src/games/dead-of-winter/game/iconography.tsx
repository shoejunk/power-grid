import type { ItemSymbol } from '@game/dead-of-winter';
import type { ReactNode } from 'react';

export type DowIconName =
  | ItemSymbol
  | 'attack'
  | 'search'
  | 'influence'
  | 'leader'
  | 'wound'
  | 'frostbite'
  | 'zombie'
  | 'noise'
  | 'barricade'
  | 'free'
  | 'card';

const ICON_LABEL: Record<DowIconName, string> = {
  attack: 'Attack threshold',
  search: 'Search threshold',
  influence: 'Influence',
  weapon: 'Weapon',
  fuel: 'Fuel',
  education: 'Education',
  food: 'Food',
  medicine: 'Medicine',
  tool: 'Tool',
  survivor: 'Survivor',
  leader: 'Group leader',
  wound: 'Wound',
  frostbite: 'Frostbite',
  zombie: 'Zombie',
  noise: 'Noise token',
  barricade: 'Barricade',
  free: 'Open space',
  card: 'Card',
};

interface IconArtProps {
  name: DowIconName;
}

function IconArt({ name }: IconArtProps): ReactNode {
  const strokeProps = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (name) {
    case 'attack':
    case 'weapon':
      return (
        <g {...strokeProps}>
          <path d="M4 4l16 16M20 4L4 20" />
          <path d="M7 7 4 6l-1 1 1 3 3-1M17 7l3-1 1 1-1 3-3-1" />
        </g>
      );
    case 'search':
      return (
        <g {...strokeProps}>
          <circle cx="10.5" cy="10.5" r="6.2" />
          <path d="m15 15 5 5" />
        </g>
      );
    case 'influence':
      return (
        <g {...strokeProps}>
          <circle cx="12" cy="12" r="5.2" />
          <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
        </g>
      );
    case 'fuel':
      return (
        <g {...strokeProps}>
          <path d="M5 21V4.5h9V21M4 21h11M14 7h3l2 2v7.5a1.5 1.5 0 0 0 3 0V9l-2-2" />
          <path d="M8 7h3" />
        </g>
      );
    case 'education':
      return (
        <g {...strokeProps}>
          <path d="m3 8 9-4 9 4-9 4-9-4Z" />
          <path d="M6 10v5c2.5 2 9.5 2 12 0v-5M21 8v6" />
        </g>
      );
    case 'food':
      return (
        <g {...strokeProps}>
          <path d="M5 6h14v14H5z" />
          <path d="M5 6c0-2 14-2 14 0M5 10c0 2 14 2 14 0" />
        </g>
      );
    case 'medicine':
      return (
        <path
          d="M10 3v7H3v4h7v7h4v-7h7v-4h-7V3h-4Z"
          fill="currentColor"
        />
      );
    case 'tool':
      return (
        <g {...strokeProps}>
          <path d="M14 5a5 5 0 0 0-6.5 6.5L3 16l5 5 4.5-4.5A5 5 0 0 0 19 10l-3 3-3-3 3-3-2-2Z" />
        </g>
      );
    case 'survivor':
      return (
        <g {...strokeProps}>
          <circle cx="12" cy="6.5" r="3" />
          <path d="M6 21v-3.5a6 6 0 0 1 12 0V21M8 14h8" />
        </g>
      );
    case 'leader':
      return <path d="m12 2.5 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.1l6.2-.9L12 2.5Z" fill="currentColor" />;
    case 'wound':
      return (
        <g {...strokeProps}>
          <path d="m6 6 12 12M18 6 6 18" />
          <circle cx="12" cy="12" r="9" />
        </g>
      );
    case 'frostbite':
      return (
        <g {...strokeProps}>
          <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M8 4.8l4 2.4 4-2.4M8 19.2l4-2.4 4 2.4" />
        </g>
      );
    case 'zombie':
      return (
        <g {...strokeProps}>
          <path d="M6 21v-7a6 6 0 0 1 12 0v7" />
          <path d="M8 10V7h2V5h4v2h2v3M9 15h1M14 15h1M9 19h6" />
        </g>
      );
    case 'noise':
      return (
        <g {...strokeProps}>
          <path d="M4 17c2.5-2.5 2.5-7.5 0-10M9 20c4-4 4-12 0-16M15 20c4-4 4-12 0-16M20 17c-2.5-2.5-2.5-7.5 0-10" />
        </g>
      );
    case 'barricade':
      return (
        <g {...strokeProps}>
          <path d="M4 4v16M10 4v16M16 4v16M22 4v16M2 5h22M2 19h22" />
        </g>
      );
    case 'free':
      return <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />;
    case 'card':
      return (
        <g {...strokeProps}>
          <rect x="5" y="3" width="14" height="18" rx="1.5" />
          <path d="M8 8h8M8 12h5M8 16h7" />
        </g>
      );
  }
}

export interface DowIconProps {
  name: DowIconName;
  size?: number;
  label?: string;
  decorative?: boolean;
}

/** Inline, font-independent icons for Dead of Winter's compact UI vocabulary. */
export function DowIcon({ name, size = 14, label, decorative = false }: DowIconProps): JSX.Element {
  const accessibleLabel = label ?? ICON_LABEL[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      focusable="false"
      aria-hidden={decorative ? true : undefined}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : accessibleLabel}
      style={{
        display: 'inline-block',
        flex: '0 0 auto',
        overflow: 'visible',
        shapeRendering: 'geometricPrecision',
        verticalAlign: '-0.16em',
      }}
    >
      {!decorative ? <title>{accessibleLabel}</title> : null}
      <IconArt name={name} />
    </svg>
  );
}

const DIE_PIPS: Record<number, readonly [number, number][]> = {
  1: [[12, 12]],
  2: [[7, 7], [17, 17]],
  3: [[7, 7], [12, 12], [17, 17]],
  4: [[7, 7], [17, 7], [7, 17], [17, 17]],
  5: [[7, 7], [17, 7], [12, 12], [7, 17], [17, 17]],
  6: [[7, 6], [17, 6], [7, 12], [17, 12], [7, 18], [17, 18]],
};

export function DieFace({ value }: { value: number }): JSX.Element {
  const pips = DIE_PIPS[value] ?? [];
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', shapeRendering: 'geometricPrecision' }}
    >
      {pips.length > 0 ? (
        pips.map(([cx, cy], index) => <circle key={index} cx={cx} cy={cy} r="2.1" fill="currentColor" />)
      ) : (
        <text x="12" y="16" textAnchor="middle" fill="currentColor" fontSize="12">
          {value}
        </text>
      )}
    </svg>
  );
}
