/**
 * Recording fake of a 2D canvas context for renderer tests: tracks the
 * transform matrix (translate/rotate/scale + save/restore), records draw calls
 * with the matrix and style state at call time, and measures text as
 * `chars * fontSize * 0.5` (font size parsed from `ctx.font`).
 */
import type { Canvas2D } from '../../../core';

export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface DrawCall {
  op: string;
  args: unknown[];
  matrix: Matrix;
  state: Record<string, unknown>;
}

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function mul(m: Matrix, n: Matrix): Matrix {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

export function fakeMeasureWidth(text: string, font: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  return text.length * (m ? Number(m[1]) : 10) * 0.5;
}

const STATE_KEYS = [
  'font',
  'fillStyle',
  'strokeStyle',
  'lineWidth',
  'textAlign',
  'textBaseline',
  'shadowColor',
  'shadowBlur',
  'shadowOffsetX',
  'shadowOffsetY',
  'globalAlpha',
] as const;

export class FakeContext {
  calls: DrawCall[] = [];
  font = '10px sans-serif';
  fillStyle: unknown = '#000';
  strokeStyle: unknown = '#000';
  lineWidth = 1;
  lineJoin = 'miter';
  miterLimit = 10;
  textAlign = 'start';
  textBaseline = 'alphabetic';
  shadowColor = 'rgba(0,0,0,0)';
  shadowBlur = 0;
  shadowOffsetX = 0;
  shadowOffsetY = 0;
  globalAlpha = 1;
  private m: Matrix = { ...IDENTITY };
  private stack: { m: Matrix; s: Record<string, unknown> }[] = [];

  private snapshot(): Record<string, unknown> {
    const s: Record<string, unknown> = {};
    for (const k of STATE_KEYS) s[k] = (this as unknown as Record<string, unknown>)[k];
    return s;
  }
  private rec(op: string, args: unknown[]) {
    this.calls.push({ op, args, matrix: { ...this.m }, state: this.snapshot() });
  }

  save() {
    this.stack.push({ m: { ...this.m }, s: this.snapshot() });
  }
  restore() {
    const top = this.stack.pop();
    if (!top) return;
    this.m = top.m;
    Object.assign(this, top.s);
  }
  translate(x: number, y: number) {
    this.m = mul(this.m, { a: 1, b: 0, c: 0, d: 1, e: x, f: y });
  }
  rotate(r: number) {
    const c = Math.cos(r);
    const s = Math.sin(r);
    this.m = mul(this.m, { a: c, b: s, c: -s, d: c, e: 0, f: 0 });
  }
  scale(x: number, y: number) {
    this.m = mul(this.m, { a: x, b: 0, c: 0, d: y, e: 0, f: 0 });
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.m = { a, b, c, d, e, f };
  }
  getTransform() {
    return { ...this.m } as unknown as DOMMatrix;
  }
  measureText(text: string) {
    return { width: fakeMeasureWidth(text, this.font) } as TextMetrics;
  }
  fillText(...args: unknown[]) {
    this.rec('fillText', args);
  }
  strokeText(...args: unknown[]) {
    this.rec('strokeText', args);
  }
  drawImage(...args: unknown[]) {
    this.rec('drawImage', args);
  }
  fill(...args: unknown[]) {
    this.rec('fill', args);
  }
  stroke(...args: unknown[]) {
    this.rec('stroke', args);
  }
  fillRect(...args: unknown[]) {
    this.rec('fillRect', args);
  }
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  arcTo() {}
  rect() {}
  clip(...args: unknown[]) {
    this.rec('clip', args);
  }

  ops(op: string): DrawCall[] {
    return this.calls.filter((c) => c.op === op);
  }
  asCanvas(): Canvas2D {
    return this as unknown as Canvas2D;
  }
}

/** Applies a matrix to a point. */
export function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/** Minimal RenderEnv for renderer tests. */
export function makeEnv(
  project: import('../../../core').Project,
  overrides: Partial<import('../../../core').RenderEnv> = {},
): import('../../../core').RenderEnv {
  return {
    project,
    track: project.tracks[0]!,
    canvasWidth: project.width,
    canvasHeight: project.height,
    time: 0,
    isExport: false,
    getAsset: (id) => project.assets[id],
    getAssetFrame: () => null,
    ...overrides,
  };
}
