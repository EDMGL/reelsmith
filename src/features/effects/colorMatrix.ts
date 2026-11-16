/**
 * Pixel-level effect primitives (pure, no DOM). Used by the fallback path when
 * `ctx.filter` is unavailable, and always for effects CSS filters cannot
 * express (temperature). The matrices follow the Filter Effects spec
 * definitions of the CSS filter shorthands (sRGB, per-step clamping), so the
 * fallback matches the `ctx.filter` path.
 */

/**
 * RGB affine transform, row-major 3x4: [r', g', b'] = M * [r, g, b, 1] with
 * channels in 0..1. Alpha is left untouched.
 */
export type ColorMatrix = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export const IDENTITY_MATRIX: ColorMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

export function brightnessMatrix(b: number): ColorMatrix {
  return [b, 0, 0, 0, 0, b, 0, 0, 0, 0, b, 0];
}

export function contrastMatrix(c: number): ColorMatrix {
  const o = 0.5 - 0.5 * c;
  return [c, 0, 0, o, 0, c, 0, o, 0, 0, c, o];
}

export function saturateMatrix(s: number): ColorMatrix {
  return [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0,
  ];
}

export function hueRotateMatrix(deg: number): ColorMatrix {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283, 0,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072, 0,
  ];
}

export function grayscaleMatrix(g: number): ColorMatrix {
  const a = 1 - Math.min(1, Math.max(0, g));
  return [
    0.2126 + 0.7874 * a, 0.7152 - 0.7152 * a, 0.0722 - 0.0722 * a, 0,
    0.2126 - 0.2126 * a, 0.7152 + 0.2848 * a, 0.0722 - 0.0722 * a, 0,
    0.2126 - 0.2126 * a, 0.7152 - 0.7152 * a, 0.0722 + 0.9278 * a, 0,
  ];
}

export function sepiaMatrix(v: number): ColorMatrix {
  const a = 1 - Math.min(1, Math.max(0, v));
  return [
    0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a, 0,
    0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a, 0,
    0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a, 0,
  ];
}

export function invertMatrix(v: number): ColorMatrix {
  const i = Math.min(1, Math.max(0, v));
  const s = 1 - 2 * i;
  return [s, 0, 0, i, 0, s, 0, i, 0, 0, s, i];
}

/**
 * White-balance style temperature shift. `t` in -1..1: positive = warmer
 * (more red, less blue), negative = cooler.
 */
export function temperatureMatrix(t: number): ColorMatrix {
  const k = Math.min(1, Math.max(-1, t));
  return [1 + 0.2 * k, 0, 0, 0, 0, 1 + 0.04 * k, 0, 0, 0, 0, 1 - 0.2 * k, 0];
}

/** Applies a 3x4 matrix to one RGB triple (0..1), clamped like a filter primitive. */
export function applyMatrixToRgb(m: ColorMatrix, r: number, g: number, b: number): [number, number, number] {
  const cl = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  return [
    cl(m[0] * r + m[1] * g + m[2] * b + m[3]),
    cl(m[4] * r + m[5] * g + m[6] * b + m[7]),
    cl(m[8] * r + m[9] * g + m[10] * b + m[11]),
  ];
}

/**
 * Applies matrices in sequence to RGBA bytes in place (unpremultiplied, as
 * returned by getImageData), clamping after each step.
 */
export function applyMatricesToPixels(data: Uint8ClampedArray, matrices: readonly ColorMatrix[]): void {
  if (matrices.length === 0) return;
  const inv = 1 / 255;
  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 3] === 0) continue;
    let r = data[p]! * inv;
    let g = data[p + 1]! * inv;
    let b = data[p + 2]! * inv;
    for (const m of matrices) {
      const nr = m[0] * r + m[1] * g + m[2] * b + m[3];
      const ng = m[4] * r + m[5] * g + m[6] * b + m[7];
      const nb = m[8] * r + m[9] * g + m[10] * b + m[11];
      r = nr < 0 ? 0 : nr > 1 ? 1 : nr;
      g = ng < 0 ? 0 : ng > 1 ? 1 : ng;
      b = nb < 0 ? 0 : nb > 1 ? 1 : nb;
    }
    // Uint8ClampedArray rounds to nearest on assignment.
    data[p] = r * 255;
    data[p + 1] = g * 255;
    data[p + 2] = b * 255;
  }
}

/** Box sizes approximating a gaussian of std deviation `sigma` with `n` box passes. */
export function boxesForGauss(sigma: number, n = 3): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes: number[] = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes;
}

function boxBlurH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 4; c++) {
      let acc = 0;
      // Outside the image counts as transparent (0), like CSS blur.
      for (let x = -r; x <= r; x++) if (x >= 0 && x < w) acc += src[(y * w + x) * 4 + c]!;
      for (let x = 0; x < w; x++) {
        dst[(y * w + x) * 4 + c] = acc * iarr;
        const add = x + r + 1;
        const sub = x - r;
        if (add < w) acc += src[(y * w + add) * 4 + c]!;
        if (sub >= 0) acc -= src[(y * w + sub) * 4 + c]!;
      }
    }
  }
}

function boxBlurV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const iarr = 1 / (r + r + 1);
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 4; c++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) if (y >= 0 && y < h) acc += src[(y * w + x) * 4 + c]!;
      for (let y = 0; y < h; y++) {
        dst[(y * w + x) * 4 + c] = acc * iarr;
        const add = y + r + 1;
        const sub = y - r;
        if (add < h) acc += src[(add * w + x) * 4 + c]!;
        if (sub >= 0) acc -= src[(sub * w + x) * 4 + c]!;
      }
    }
  }
}

/**
 * Gaussian blur approximation (3 box passes) on RGBA bytes in place. Works on
 * premultiplied values so transparent surroundings do not darken edges.
 */
export function gaussianBlurPixels(data: Uint8ClampedArray, w: number, h: number, sigma: number): void {
  if (sigma <= 0.25 || w === 0 || h === 0) return;
  const n = w * h * 4;
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let p = 0; p < n; p += 4) {
    const al = data[p + 3]! / 255;
    a[p] = data[p]! * al;
    a[p + 1] = data[p + 1]! * al;
    a[p + 2] = data[p + 2]! * al;
    a[p + 3] = data[p + 3]!;
  }
  for (const size of boxesForGauss(sigma, 3)) {
    const r = (size - 1) / 2;
    boxBlurH(a, b, w, h, r);
    boxBlurV(b, a, w, h, r);
  }
  for (let p = 0; p < n; p += 4) {
    const al = a[p + 3]!;
    data[p + 3] = al;
    if (al <= 0) {
      data[p] = data[p + 1] = data[p + 2] = 0;
      continue;
    }
    const k = 255 / al;
    data[p] = a[p]! * k;
    data[p + 1] = a[p + 1]! * k;
    data[p + 2] = a[p + 2]! * k;
  }
}
