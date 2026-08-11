import type { MapId } from '@game/power-grid';

/**
 * Presentation metadata for the two shipped maps.
 *
 * The authoritative topology (cities, connections, costs) lives in
 * @pg/shared/data/maps and is consumed by the engine and the board renderer.
 * This file only carries what the *shell* needs: names, marketing copy, the
 * rule variations a player should know about before choosing, and a painted
 * thumbnail — so the map picker never has to load the full map graph.
 */
export interface MapPresentation {
  id: MapId;
  name: string;
  region: string;
  /** One-line pitch shown under the name in the picker. */
  blurb: string;
  /** The map-specific rules, quoted from the gameplay requirements §12. */
  specialRules: { title: string; detail: string }[];
  cityCount: number;
  areaCount: number;
  /** width / height of the board art, mirrored from GameMap.aspectRatio. */
  aspectRatio: number;
}

export const MAP_PRESENTATION: Record<MapId, MapPresentation> = {
  germany: {
    id: 'germany',
    name: 'Germany',
    region: 'Central Europe',
    blurb:
      'The classic board. Dense, cheap connections in the centre and an expensive north–south spine.',
    specialRules: [
      {
        title: 'Nuclear phase-out',
        detail:
          'The moment any player buys plant 39, uranium is never resupplied again for the rest of the game. Stockpile early or avoid nuclear entirely.',
      },
    ],
    cityCount: 42,
    areaCount: 6,
    aspectRatio: 0.78,
  },
  usa: {
    id: 'usa',
    name: 'United States',
    region: 'North America',
    blurb:
      'Long, expensive coast-to-coast links. Regional dominance matters more than sprawl.',
    specialRules: [
      {
        title: 'Coal storage',
        detail:
          'Coal has a separate storage area, starting empty. Once the coal market is dry you may still buy coal from storage at 8 Elektro per token.',
      },
      {
        title: 'Burned coal returns',
        detail:
          'Coal consumed during production goes into the storage area rather than the supply, and feeds later market refills.',
      },
    ],
    cityCount: 42,
    areaCount: 6,
    aspectRatio: 1.55,
  },
};

export const MAP_IDS: readonly MapId[] = ['germany', 'usa'] as const;

/* ------------------------------------------------------------------ *
 * Thumbnails
 * ------------------------------------------------------------------ */

/** Stylised node/edge layout per map — decorative, not the real topology. */
interface ThumbGeometry {
  viewBox: string;
  silhouette: string;
  /** Normalised-ish node positions in viewBox units. */
  nodes: [number, number][];
  /** Index pairs into `nodes`. */
  edges: [number, number][];
  /** Six region blobs, drawn clipped to the silhouette. */
  regions: { d: string; hue: string }[];
}

/*
 * Decorative region tints for the map-picker thumbnails only.
 *
 * Deliberately NOT the seat colours. Two of these previously reused the old
 * blue and purple seat hexes, which both drifted when the seat palette was
 * re-solved for colour-blind separation — leaving the thumbnails quoting
 * colours that no longer exist anywhere else. These are chosen to sit in the
 * gaps between seat hues so a thumbnail can never be mistaken for a player.
 */
const REGION_HUES = ['#46e2ff', '#d9813f', '#3ad693', '#7f8fa6', '#ffc93c', '#2f7fa8'];

const GEOMETRY: Record<MapId, ThumbGeometry> = {
  germany: {
    viewBox: '0 0 100 128',
    silhouette:
      'M50 4 62 9 67 17 75 19 79 27 74 35 81 43 78 53 87 59 84 71 76 79 79 91 70 101 62 113 53 121 44 118 38 108 30 102 26 92 18 86 14 74 20 64 16 54 23 44 19 34 27 26 31 16 40 10Z',
    regions: [
      { d: 'M50 4 79 27 60 46 24 34 31 16Z', hue: REGION_HUES[0]! },
      { d: 'M79 27 87 59 66 68 60 46Z', hue: REGION_HUES[1]! },
      { d: 'M24 34 60 46 52 74 18 68Z', hue: REGION_HUES[2]! },
      { d: 'M60 46 66 68 60 96 52 74Z', hue: REGION_HUES[3]! },
      { d: 'M18 68 52 74 44 118 26 92Z', hue: REGION_HUES[4]! },
      { d: 'M52 74 60 96 70 101 53 121 44 118Z', hue: REGION_HUES[5]! },
    ],
    nodes: [
      [50, 14], [66, 24], [36, 24], [24, 40], [56, 38], [76, 42],
      [44, 52], [64, 56], [30, 58], [80, 62], [50, 66], [38, 74],
      [68, 76], [24, 78], [56, 84], [44, 92], [70, 92], [34, 96],
      [58, 104], [48, 110],
    ],
    edges: [
      [0, 1], [0, 2], [2, 3], [1, 4], [0, 4], [1, 5], [4, 6], [4, 7],
      [3, 8], [6, 8], [5, 9], [7, 9], [6, 10], [7, 10], [8, 11], [10, 11],
      [10, 12], [9, 12], [11, 13], [12, 14], [10, 14], [11, 15], [13, 17],
      [14, 16], [15, 17], [14, 18], [16, 18], [15, 19], [18, 19],
    ],
  },
  usa: {
    viewBox: '0 0 155 100',
    silhouette:
      'M6 27 30 20 58 16 92 14 124 18 147 25 151 37 146 51 138 63 128 73 112 81 92 85 70 87 48 83 30 75 16 61 8 44Z',
    regions: [
      { d: 'M6 27 52 18 48 48 12 46Z', hue: REGION_HUES[0]! },
      { d: 'M52 18 100 15 96 48 48 48Z', hue: REGION_HUES[1]! },
      { d: 'M100 15 151 37 138 63 96 48Z', hue: REGION_HUES[2]! },
      { d: 'M12 46 48 48 48 83 16 61Z', hue: REGION_HUES[3]! },
      { d: 'M48 48 96 48 92 85 48 83Z', hue: REGION_HUES[4]! },
      { d: 'M96 48 138 63 112 81 92 85Z', hue: REGION_HUES[5]! },
    ],
    nodes: [
      [16, 32], [34, 26], [30, 44], [16, 50], [50, 24], [48, 40],
      [46, 60], [30, 62], [66, 22], [70, 38], [64, 56], [86, 26],
      [88, 44], [82, 62], [104, 24], [108, 42], [100, 60], [124, 30],
      [128, 48], [116, 66], [140, 40], [60, 74], [92, 76],
    ],
    edges: [
      [0, 1], [0, 3], [1, 2], [2, 3], [1, 4], [2, 5], [3, 7], [4, 5],
      [5, 6], [6, 7], [4, 8], [5, 9], [6, 10], [8, 9], [9, 10], [8, 11],
      [9, 12], [10, 13], [11, 12], [12, 13], [11, 14], [12, 15], [13, 16],
      [14, 15], [15, 16], [14, 17], [15, 18], [16, 19], [17, 18], [18, 19],
      [17, 20], [18, 20], [6, 21], [21, 22], [13, 22], [16, 22],
    ],
  },
};

export interface MapThumbnailProps {
  mapId: MapId;
  /** Adds the lit/selected treatment. */
  active?: boolean;
  className?: string;
}

/**
 * Painted map thumbnail.
 *
 * Built from layered gradients, a soft inner shadow, region tints and a glow
 * pass on the node network, so it reads as illustrated board art rather than
 * a flat vector shape (quality bar V2/V6). Pure SVG — no bitmaps to load, and
 * it stays crisp at 4K.
 */
export function MapThumbnail({ mapId, active = false, className }: MapThumbnailProps): JSX.Element {
  const geo = GEOMETRY[mapId];
  const uid = `map-${mapId}`;

  return (
    <svg
      className={['pg-mapthumb', active ? 'is-active' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      viewBox={geo.viewBox}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${MAP_PRESENTATION[mapId].name} map`}
    >
      <defs>
        <linearGradient id={`${uid}-land`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#2c3b4c" />
          <stop offset="55%" stopColor="#1d2836" />
          <stop offset="100%" stopColor="#131b26" />
        </linearGradient>
        <radialGradient id={`${uid}-sheen`} cx="0.3" cy="0.15" r="0.9">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${uid}-clip`}>
          <path d={geo.silhouette} />
        </clipPath>
        <filter id={`${uid}-glow`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={`${uid}-grain`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </defs>

      {/* Land mass */}
      <path d={geo.silhouette} fill={`url(#${uid}-land)`} />

      <g clipPath={`url(#${uid}-clip)`}>
        {/* Region tints */}
        {geo.regions.map((region, i) => (
          <path key={i} d={region.d} fill={region.hue} opacity={active ? 0.2 : 0.13} />
        ))}
        {/* Paper grain */}
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          filter={`url(#${uid}-grain)`}
          opacity="0.06"
        />
        {/* Top-left light */}
        <rect x="0" y="0" width="100%" height="100%" fill={`url(#${uid}-sheen)`} />
      </g>

      {/* Connection network */}
      <g
        stroke={active ? '#8df3ff' : '#7f97ad'}
        strokeWidth="0.7"
        strokeLinecap="round"
        opacity={active ? 0.85 : 0.5}
      >
        {geo.edges.map(([a, b], i) => {
          const from = geo.nodes[a]!;
          const to = geo.nodes[b]!;
          return <line key={i} x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} />;
        })}
      </g>

      {/* Cities */}
      <g filter={active ? `url(#${uid}-glow)` : undefined}>
        {geo.nodes.map(([x, y], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={1.7}
            fill={active ? '#c9f8ff' : '#b3c4d4'}
            stroke="#0a1017"
            strokeWidth="0.5"
          />
        ))}
      </g>

      {/* Coastline */}
      <path
        d={geo.silhouette}
        fill="none"
        stroke={active ? 'rgba(141,243,255,0.75)' : 'rgba(160,196,224,0.35)'}
        strokeWidth="0.9"
      />
    </svg>
  );
}
