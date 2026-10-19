// Icons from the design pack (24 × 24, round caps). Decorative: label the button, not the icon.

const PATHS = {
  scan: { d: 'M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M8 9v6M11 9v6M14 9v6M17 9v6' },
  camera: { d: 'M3.5 9a2 2 0 0 1 2-2h2l1.5-2h6l1.5 2h2a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z', circle: [12, 13, 3.5] },
  search: { d: 'M15 15l5 5', circle: [10.5, 10.5, 6] },
  keyboard: { d: 'M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14.5h8', rect: [2.5, 6, 19, 12, 2.5] },
  close: { d: 'M6 6l12 12M18 6L6 18' },
  back: { d: 'M15 5l-7 7 7 7' },
  chevronDown: { d: 'M7 10l5 5 5-5' },
  chevronRight: { d: 'M10 6l6 6-6 6' },
  remove: { d: 'M8 12h8', circle: [12, 12, 9] },
  add: { d: 'M12 8v8M8 12h8', circle: [12, 12, 9] },
  plus: { d: 'M12 5v14M5 12h14' },
  minus: { d: 'M5 12h14' },
  swap: { d: 'M7 4L4 7l3 3M4 7h12M17 20l3-3-3-3M20 17H8' },
  mic: { d: 'M5 11a7 7 0 0 0 14 0M12 18v3', rect: [9, 3, 6, 11, 3] },
  scale: { d: 'M8.5 10.5a4.5 4.5 0 0 1 7 0M12 10.5l1.4-2.2', rect: [3.5, 3.5, 17, 17, 5] },
  check: { d: 'M5 12.5l4.5 4.5L19 7.5' },
  torch: { d: 'M8 3h8l-1 6H9zM9 9h6l-1 12h-4z' },
  menu: { d: 'M4 7h16M4 12h16M4 17h16' },
  edit: { d: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4' },
  copy: { d: 'M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3', rect: [9, 9, 11, 11, 2] },
  trash: { d: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3' },
  image: { d: 'M4 17l5-5 4 4 3-3 4 4', rect: [3, 4, 18, 16, 3] },
  info: { d: 'M12 11v5M12 8h.01', circle: [12, 12, 9] },
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, stroke = 1.8, className, style }: {
  name: IconName;
  size?: number;
  stroke?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const p = PATHS[name] as { d: string; circle?: readonly number[]; rect?: readonly number[] };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
    >
      {p.rect && <rect x={p.rect[0]} y={p.rect[1]} width={p.rect[2]} height={p.rect[3]} rx={p.rect[4]} />}
      {p.circle && <circle cx={p.circle[0]} cy={p.circle[1]} r={p.circle[2]} />}
      <path d={p.d} />
    </svg>
  );
}

/** The ⋯ glyph used on log groups and meal rows (filled dots). */
export function MoreDots({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}
