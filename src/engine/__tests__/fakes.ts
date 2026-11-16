/** Test doubles for canvas contexts and media elements. */
import type { Canvas2D } from '../../core';

export interface DrawOp {
  op: string;
  args: unknown[];
  alpha: number;
  filter: string;
  transform: number[];
  composite: string;
}

/** Records drawing calls with the state (alpha, filter, transform) at call time. */
export class FakeCtx {
  ops: DrawOp[] = [];
  globalAlpha = 1;
  filter = 'none';
  fillStyle: unknown = '#000';
  globalCompositeOperation = 'source-over';
  imageSmoothingEnabled = true;
  imageSmoothingQuality = 'low';
  canvas: { width: number; height: number };
  private m = [1, 0, 0, 1, 0, 0];
  private stack: { alpha: number; filter: string; m: number[]; fill: unknown; comp: string }[] = [];
  /** Pixel store for getImageData/putImageData. */
  pixels: Uint8ClampedArray;

  constructor(width = 100, height = 100) {
    this.canvas = { width, height };
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }

  private rec(op: string, ...args: unknown[]) {
    this.ops.push({ op, args, alpha: this.globalAlpha, filter: this.filter, transform: [...this.m], composite: this.globalCompositeOperation });
  }

  save() {
    this.stack.push({ alpha: this.globalAlpha, filter: this.filter, m: [...this.m], fill: this.fillStyle, comp: this.globalCompositeOperation });
  }
  restore() {
    const s = this.stack.pop();
    if (!s) return;
    this.globalAlpha = s.alpha;
    this.filter = s.filter;
    this.m = s.m;
    this.fillStyle = s.fill;
    this.globalCompositeOperation = s.comp;
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.m = [a, b, c, d, e, f];
  }
  translate(x: number, y: number) {
    const [a, b, c, d, e, f] = this.m as [number, number, number, number, number, number];
    this.m = [a, b, c, d, e + a * x + c * y, f + b * x + d * y];
  }
  scale(x: number, y: number) {
    const [a, b, c, d, e, f] = this.m as [number, number, number, number, number, number];
    this.m = [a * x, b * x, c * y, d * y, e, f];
  }
  rotate(r: number) {
    const [a, b, c, d, e, f] = this.m as [number, number, number, number, number, number];
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    this.m = [a * cos + c * sin, b * cos + d * sin, -a * sin + c * cos, -b * sin + d * cos, e, f];
  }
  clearRect(...a: number[]) {
    this.rec('clearRect', ...a);
  }
  fillRect(...a: number[]) {
    this.rec('fillRect', this.fillStyle, ...a);
  }
  drawImage(...a: unknown[]) {
    this.rec('drawImage', ...a);
  }
  getImageData(_x: number, _y: number, w: number, h: number) {
    this.rec('getImageData');
    return { data: this.pixels.slice(0, w * h * 4), width: w, height: h };
  }
  putImageData(img: { data: Uint8ClampedArray }) {
    this.rec('putImageData');
    this.pixels.set(img.data);
  }
  createRadialGradient(...a: number[]) {
    this.rec('createRadialGradient', ...a);
    return { stops: [] as [number, string][], addColorStop(o: number, c: string) { this.stops.push([o, c]); } };
  }
  get asCtx(): Canvas2D {
    return this as unknown as Canvas2D;
  }
  draws(): DrawOp[] {
    return this.ops.filter((o) => o.op === 'drawImage');
  }
}

/** Minimal HTMLVideoElement double: seeks complete asynchronously after `seekDelay` ms. */
export class FakeVideo extends EventTarget {
  static created: FakeVideo[] = [];
  readyState = 0;
  paused = true;
  seeking = false;
  playbackRate = 1;
  muted = true;
  volume = 1;
  preload = 'auto';
  duration = 10;
  videoWidth = 160;
  videoHeight = 90;
  error = null;
  src = '';
  seekDelay = 5;
  seekCount = 0;
  playCalls = 0;
  private _t = 0;
  /** currentTime as seen when the last seek completed. */
  presentedTime = -1;

  constructor(public kind: 'video' | 'audio' = 'video') {
    super();
    FakeVideo.created.push(this);
    // Metadata + first frame arrive asynchronously.
    setTimeout(() => {
      this.readyState = 4;
      this.presentedTime = this._t;
      this.dispatchEvent(new Event('loadedmetadata'));
      this.dispatchEvent(new Event('loadeddata'));
    }, 1);
  }
  get currentTime() {
    return this._t;
  }
  set currentTime(v: number) {
    this._t = v;
    this.seeking = true;
    this.seekCount++;
    setTimeout(() => {
      this.seeking = false;
      this.presentedTime = v;
      this.dispatchEvent(new Event('seeked'));
    }, this.seekDelay);
  }
  play() {
    this.playCalls++;
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  load() {}
  removeAttribute() {}
  remove() {}
}

export const fakeElementFactory = (kind: 'video' | 'audio') => new FakeVideo(kind) as unknown as HTMLMediaElement;
