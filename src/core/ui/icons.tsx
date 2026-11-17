/**
 * Erdemcut icon set: original, simple line icons on a 24×24 grid, drawn with
 * `currentColor`. The stroke is scaled so it renders at ~1.6 px at any size.
 * Purely presentational — import from core: `import { Icon } from '../../core'`.
 */
import type { CSSProperties, ReactNode } from 'react';

type Glyph = { d?: string; fill?: string; extra?: ReactNode };

const G = {
  // transport
  play: { fill: 'M8 5.6v12.8c0 .8.9 1.3 1.6.8l9.6-6.4a1 1 0 0 0 0-1.6L9.6 4.8C8.9 4.3 8 4.8 8 5.6z' },
  pause: { fill: 'M7 5h3.2v14H7zM13.8 5H17v14h-3.2z' },
  'skip-start': { d: 'M6 5v14', fill: 'M18 6.6v10.8c0 .8-.9 1.3-1.6.8l-8-5.4a1 1 0 0 1 0-1.6l8-5.4c.7-.5 1.6 0 1.6.8z' },
  'skip-end': { d: 'M18 5v14', fill: 'M6 6.6v10.8c0 .8.9 1.3 1.6.8l8-5.4a1 1 0 0 0 0-1.6l-8-5.4C6.9 5.3 6 5.8 6 6.6z' },
  'frame-back': { d: 'M7 6v12M17 6l-6 6 6 6' },
  'frame-forward': { d: 'M17 6v12M7 6l6 6-6 6' },
  fullscreen: { d: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5' },
  'exit-fullscreen': { d: 'M9 4v5H4M15 4v5h5M20 15h-5v5M4 15h5v5' },
  record: { d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', fill: 'M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z' },
  'record-dot': { fill: 'M12 5.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z' },
  stop: { fill: 'M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z' },
  // history / app
  undo: { d: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11' },
  redo: { d: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13' },
  keyboard: { d: 'M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM7 10h.01M10.5 10h.01M14 10h.01M17 10h.01M8 14h8' },
  help: { d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.5M12 16.8h.01' },
  export: { d: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14' },
  upload: { d: 'M12 16V4M7.5 8.5 12 4l4.5 4.5M5 20h14' },
  'chevron-down': { d: 'm6 9 6 6 6-6' },
  'chevron-right': { d: 'm9 6 6 6-6 6' },
  'chevron-left': { d: 'm15 6-6 6 6 6' },
  close: { d: 'M6 6l12 12M18 6 6 18' },
  plus: { d: 'M12 5v14M5 12h14' },
  minus: { d: 'M5 12h14' },
  check: { d: 'm5 12.5 4.5 4.5L19 7' },
  alert: { d: 'M12 4 2.8 19.5h18.4zM12 10v4M12 17h.01' },
  info: { d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5.5M12 7.8h.01' },
  'panel-left': { d: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9.5 4v16' },
  'panel-right': { d: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM14.5 4v16' },
  pointer: { d: 'm6 4 12 6.5-5.2 1.6L10.2 17.5z' },
  sliders: { d: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4' },
  // panels
  media: { d: 'M7.5 3.5H18a2.5 2.5 0 0 1 2.5 2.5v10.5M5 7.5h10a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9.5a2 2 0 0 1 2-2zM3.5 18l3.8-3.8 2.7 2.7 2-2 4.5 4.5' },
  text: { d: 'M5 7V5h14v2M12 5v14M9 19h6' },
  subtitles: { d: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM7 11.5h5M14.5 11.5H17M7 15h2.5M12 15h5' },
  music: { d: 'M9 17.5V6l11-2v11.5M6.5 15a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM17.5 13a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z' },
  mic: { d: 'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7' },
  effects: { d: 'm11 3 1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z' },
  silence: { d: 'M3 12h1.5M6.5 9v6M9.5 6v12M12.5 12h4M19 8.5v7M21.5 11v2' },
  // edit
  scissors: { d: 'M6 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 15.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM8.1 7.4 20 18M8.1 16.6 20 6' },
  split: { d: 'M12 3v18M9 7H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h4M15 7h4a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-4' },
  trash: { d: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3' },
  'ripple-delete': { d: 'M3.5 7h4v10h-4zM16.5 7h4v10h-4zM14 12h-4.5M11.5 10 9.5 12l2 2' },
  copy: { d: 'M10 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3' },
  duplicate: { d: 'M10 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3M14.5 11.5v6M11.5 14.5h6' },
  paste: { d: 'M8 5H6.5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H16M9.5 3h5a1 1 0 0 1 1 1v1.5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z' },
  link: { d: 'M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1' },
  unlink: { d: 'm9.5 14.5-1.5 1.5a3.5 3.5 0 0 1-5-5l1.5-1.5M14.5 9.5 16 8a3.5 3.5 0 0 1 5 5l-1.5 1.5M8 3v2.5M3 8h2.5M16 21v-2.5M21 16h-2.5' },
  magnet: { d: 'M5 4h4v8a3 3 0 0 0 6 0V4h4v8a7 7 0 0 1-14 0zM5 8h4M15 8h4' },
  'zoom-in': { d: 'M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.4-4.4M11 8.5v5M8.5 11h5' },
  'zoom-out': { d: 'M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.4-4.4M8.5 11h5' },
  fit: { d: 'M3.5 5v14M20.5 5v14M7 12h10M9.5 9.5 7 12l2.5 2.5M14.5 9.5 17 12l-2.5 2.5' },
  'punch-in': { d: 'M4 8.5V5a1 1 0 0 1 1-1h3.5M15.5 4H19a1 1 0 0 1 1 1v3.5M20 15.5V19a1 1 0 0 1-1 1h-3.5M8.5 20H5a1 1 0 0 1-1-1v-3.5M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z' },
  bolt: { d: 'M13 3 5 13.5h6L10 21l8-10.5h-6z' },
  refresh: { d: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v4.5h-4.5' },
  reset: { d: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4.5h4.5' },
  'arrow-up': { d: 'M12 19V5M6 11l6-6 6 6' },
  'arrow-down': { d: 'M12 5v14M6 13l6 6 6-6' },
  // tracks
  film: { d: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM7.5 4v16M16.5 4v16M3 9h4.5M3 15h4.5M16.5 9H21M16.5 15H21' },
  layers: { d: 'm12 3.5 9 5-9 5-9-5zM3 13l9 5 9-5' },
  image: { d: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 8.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM21 15.5l-4.5-4.5L7 20' },
  waveform: { d: 'M4 10v4M8 7v10M12 4v16M16 8v8M20 10.5v3' },
  volume: { d: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18.3 6.3a8 8 0 0 1 0 11.4' },
  'volume-off': { d: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5' },
  eye: { d: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z' },
  'eye-off': { d: 'm3 3 18 18M10.6 6.1Q11.3 6 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-2.6 3.3M6.5 7.6A16 16 0 0 0 2.5 12s3.5 6 9.5 6a9 9 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2' },
  lock: { d: 'M7 10.5h10a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6.5a2 2 0 0 1 2-2zM8 10.5V7.5a4 4 0 0 1 8 0v3' },
  unlock: { d: 'M7 10.5h10a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6.5a2 2 0 0 1 2-2zM8 10.5V7.5a4 4 0 0 1 7.7-1.5' },
  // devices
  monitor: { d: 'M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 20h8M12 16v4' },
  camera: { d: 'M5 7h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM16 10.5l5-3v9l-5-3' },
  // shapes
  'shape-rect': { d: 'M4 6h16v12H4z' },
  'shape-rounded': { d: 'M8 6h8a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-4a4 4 0 0 1 4-4z' },
  'shape-circle': { d: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z' },
  'corner-tl': { d: 'M17 17 7 7M7 14V7h7' },
  'corner-tr': { d: 'M7 17 17 7M10 7h7v7' },
  'corner-bl': { d: 'M17 7 7 17M7 10v7h7' },
  'corner-br': { d: 'M7 7l10 10M17 10v7h-7' },
  // effects
  sun: { d: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8' },
  contrast: { d: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z', fill: 'M12 3.5a8.5 8.5 0 0 1 0 17z' },
  droplet: { d: 'M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5z' },
  thermometer: { d: 'M10 13.5V5a2 2 0 0 1 4 0v8.5a4 4 0 1 1-4 0zM12 9v7' },
  blur: { d: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z' },
  vignette: { d: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM12 7.5c3.3 0 6 2 6 4.5s-2.7 4.5-6 4.5-6-2-6-4.5 2.7-4.5 6-4.5z' },
  grain: { d: 'M7 7h.01M12 6h.01M17 8h.01M6 12h.01M10 11h.01M15 12h.01M18 13h.01M8 16h.01M13 16h.01M17 17h.01M11 19h.01' },
} satisfies Record<string, Glyph>;

export type IconName = keyof typeof G;

export interface IconProps {
  name: IconName;
  /** Rendered size in px (default 16). */
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** Accessible label; when omitted the icon is decorative (aria-hidden). */
  label?: string;
}

/** Line icon from the Erdemcut set. Decorative by default. */
export function Icon({ name, size = 16, className, style, label }: IconProps) {
  const g: Glyph | undefined = G[name];
  if (!g) return null;
  const sw = (1.6 * 24) / size;
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={Math.min(2.4, Math.max(1.4, sw))}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    >
      {g.d && <path d={g.d} />}
      {g.fill && <path d={g.fill} fill="currentColor" stroke="none" />}
      {g.extra}
    </svg>
  );
}

/** Names of every icon in the set (for docs / tests). */
export const ICON_NAMES = Object.keys(G) as IconName[];
