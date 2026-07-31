import type { SVGProps } from 'react';

/**
 * Inline icon set.
 *
 * Every icon is a 24x24 stroked path drawn on the same grid with the same
 * 1.7px stroke weight, so they optically match at any size. Inlining keeps
 * them themeable (`currentColor`) and removes a network round-trip.
 */

export type IconProps = SVGProps<SVGSVGElement>;

const base = (props: IconProps): IconProps => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
  ...props,
});

export const IconBolt = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M13.4 2 5 13.2h5.3L9.4 22l8.9-11.8h-5.4z" />
  </svg>
);

export const IconPlus = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconMinus = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 12h14" />
  </svg>
);

export const IconCheck = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m4.5 12.5 5 5 10-11" />
  </svg>
);

export const IconClose = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconChevronDown = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m5 9 7 7 7-7" />
  </svg>
);

export const IconChevronRight = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m9 5 7 7-7 7" />
  </svg>
);

export const IconChevronLeft = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m15 5-7 7 7 7" />
  </svg>
);

export const IconCopy = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-6A3.5 3.5 0 0 0 3 6.5v6A2.5 2.5 0 0 0 5.5 15" />
  </svg>
);

export const IconUsers = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20a6 6 0 0 1 12 0" />
    <path d="M16.5 5.6a3.2 3.2 0 0 1 0 6M18 20a6 6 0 0 0-2.2-4.6" />
  </svg>
);

export const IconRobot = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4" y="8" width="16" height="11" rx="3" />
    <path d="M12 4.5V8M8.5 13v1.6M15.5 13v1.6M4 13H2.4M20 13h1.6" />
    <circle cx="12" cy="3.4" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export const IconCrown = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 7.5 6.5 15h11L21 7.5l-4.6 3L12 4.5 7.6 10.5z" />
    <path d="M6.5 18.5h11" />
  </svg>
);

export const IconMap = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m9 4-6 2.6v13.2L9 17.2l6 2.6 6-2.6V4l-6 2.6z" />
    <path d="M9 4v13.2M15 6.6v13.2" />
  </svg>
);

export const IconInfo = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.6v.6" />
  </svg>
);

export const IconWarning = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3.5 21.5 20h-19z" />
    <path d="M12 9.6v4.6M12 17.2v.5" />
  </svg>
);

export const IconError = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9 9l6 6M15 9l-6 6" />
  </svg>
);

export const IconPlug = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 3v5M15 3v5" />
    <path d="M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6z" />
    <path d="M12 17v4" />
  </svg>
);

export const IconLink = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M10.5 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7l-1.6 1.6" />
    <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.7l1.6-1.6" />
  </svg>
);

export const IconLogout = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M14 4.5H6.5A2.5 2.5 0 0 0 4 7v10a2.5 2.5 0 0 0 2.5 2.5H14" />
    <path d="M17 8.5 20.5 12 17 15.5M20.5 12H10" />
  </svg>
);

export const IconSettings = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.8 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
  </svg>
);

export const IconBook = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H18a2 2 0 0 1 2 2v12.5a2 2 0 0 1-2 2H6a2 2 0 0 0-2 2z" />
    <path d="M4 17.5A2 2 0 0 1 6 15.5h14" />
  </svg>
);

export const IconSignal = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 20v-4M9.3 20v-8M14.7 20v-12M20 20V4" />
  </svg>
);

export const IconTrash = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4.5 6.5h15M9.5 6.5V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
    <path d="M6.5 6.5 7.4 19a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-12.5" />
  </svg>
);

export const IconPlay = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M7 4.8v14.4a1 1 0 0 0 1.53.85l11.2-7.2a1 1 0 0 0 0-1.7L8.53 3.95A1 1 0 0 0 7 4.8z" />
  </svg>
);

/* --- Player sigils: a distinct glyph per PlayerColor so ownership never
       relies on hue alone (colour-vision-deficiency safety). --- */

export const SigilCircle = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <circle cx="12" cy="12" r="8" />
  </svg>
);
export const SigilSquare = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <rect x="4.5" y="4.5" width="15" height="15" rx="2" />
  </svg>
);
export const SigilTriangle = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M12 3.5 21 20H3z" />
  </svg>
);
export const SigilDiamond = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M12 2.5 21.5 12 12 21.5 2.5 12z" />
  </svg>
);
export const SigilHex = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M12 2.5 20.7 7.5v9L12 21.5 3.3 16.5v-9z" />
  </svg>
);
export const SigilStar = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="m12 2.5 2.9 6.3 6.8.8-5 4.7 1.3 6.8L12 17.8 6 21.1l1.3-6.8-5-4.7 6.8-.8z" />
  </svg>
);
