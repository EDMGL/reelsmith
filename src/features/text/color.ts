/** Minimal CSS color helpers for `<input type="color">` (hex only) + an alpha slider. */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  transparent: 'rgba(0,0,0,0)',
};

/** Parses #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() and a few names. Null if unknown. */
export function parseColor(input: string): Rgba | null {
  const s = (NAMED[input.trim().toLowerCase()] ?? input).trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4})$/.exec(s);
  if (m) {
    const h = m[1]!;
    const v = (i: number) => parseInt(h[i]! + h[i]!, 16);
    return { r: v(0), g: v(1), b: v(2), a: h.length === 4 ? v(3) / 255 : 1 };
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) {
    const h = m[1]!;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: m[2] ? parseInt(m[2], 16) / 255 : 1,
    };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    const c = (x: string) => Math.max(0, Math.min(255, Math.round(parseFloat(x))));
    return { r: c(m[1]!), g: c(m[2]!), b: c(m[3]!), a: Math.max(0, Math.min(1, a)) };
  }
  return null;
}

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');

export function toHex({ r, g, b }: Rgba): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

/** `#rrggbb` when opaque, else `rgba(r,g,b,a)`. */
export function toCss(c: Rgba): string {
  if (c.a >= 1) return toHex(c);
  return `rgba(${c.r},${c.g},${c.b},${Math.round(c.a * 1000) / 1000})`;
}
