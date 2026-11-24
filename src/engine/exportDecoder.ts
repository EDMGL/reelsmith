/**
 * Sequential video decoding for export.
 *
 * Seeking an <video> for every output frame re-decodes from the previous key
 * frame each time (very slow for 4K HEVC). Export reads clips strictly forward,
 * so a per-clip `ForwardReader` keeps ONE WebCodecs decode session (via
 * mediabunny) running and just advances it: each decoded frame is decoded once.
 *
 * The decoded picture is copied (rotation / flip applied) into a private canvas
 * and the VideoSample is closed right away, so no VideoFrame outlives a call
 * (Chrome stalls the decoder when frames are not closed). Only one look-ahead
 * sample is ever held open per reader.
 *
 * Anything that goes wrong (no WebCodecs, unsupported codec, decode error)
 * makes the opener return null / frameAt reject; the engine then falls back to
 * the <video> seek path for that asset.
 */
import type { AssetFrame, MediaAsset } from '../core';

/** One decoded picture, as the reader needs it (adapter over mediabunny's VideoSample). */
export interface DecodedSample {
  /** Presentation time (s). */
  timestamp: number;
  /** Size after rotation / pixel-aspect adjustment. */
  width: number;
  height: number;
  /** Draws the (already rotated) picture at 0,0 on the context. */
  draw(ctx: SampleCtx): void;
  close(): void;
}

export type SampleCtx = Pick<CanvasRenderingContext2D, 'clearRect' | 'drawImage'> & Record<string, unknown>;

/** A decode session factory for one asset; `samples(t)` yields frames in presentation order from the one showing at `t`. */
export interface SampleSource {
  samples(startTime: number): AsyncGenerator<DecodedSample, void, unknown>;
  dispose(): void;
}

export interface PictureCanvas {
  canvas: CanvasImageSource & { width: number; height: number };
  ctx: SampleCtx;
}

export type CanvasFactory = (width: number, height: number) => PictureCanvas | null;

/** Jump (s) ahead of the decoded position beyond which the reader reopens instead of decoding through. */
export const JUMP_REOPEN = 2;
const EPS = 1e-4;

export class ForwardReader {
  private iter: AsyncGenerator<DecodedSample, void, unknown> | null = null;
  /** Newest sample whose timestamp <= requested time (kept open until superseded). */
  private cur: DecodedSample | null = null;
  /** Look-ahead sample with timestamp > requested time. */
  private next: DecodedSample | null = null;
  private done = false;
  private pic: PictureCanvas | null = null;
  private drawn: DecodedSample | null = null;
  private frame: AssetFrame | null = null;
  private closed = false;
  /** Number of times the underlying iterator was (re)opened (tests / diagnostics). */
  opens = 0;

  constructor(
    private readonly source: SampleSource,
    private readonly makeCanvas: CanvasFactory,
    private readonly onDispose?: () => void,
  ) {}

  /** The frame to show at source time `t` (the latest decoded frame <= t). */
  async frameAt(t: number): Promise<AssetFrame> {
    if (this.closed) throw new Error('export reader closed');
    const time = Math.max(0, t);
    const known = this.next?.timestamp ?? this.cur?.timestamp;
    const backwards = this.cur !== null && time < this.cur.timestamp - EPS;
    const jump = known !== undefined && time - known > JUMP_REOPEN;
    if (!this.iter || backwards || jump) await this.reopen(time);

    // Advance until the look-ahead is beyond `time`.
    while (!this.closed) {
      if (!this.next && !this.done) {
        const r = await this.iter!.next();
        if (this.closed) {
          if (!r.done) r.value.close();
          throw new Error('export reader closed');
        }
        if (r.done) this.done = true;
        else this.next = r.value;
      }
      if (!this.next || this.next.timestamp > time + EPS) break;
      this.cur?.close();
      this.cur = this.next;
      this.next = null;
    }
    // Before the first frame (or nothing <= time): show the first available one.
    if (!this.cur && this.next) {
      this.cur = this.next;
      this.next = null;
    }
    // Never hand back a stale picture for a new time: no frame, or the stream
    // ended long before `time`, is an error (the engine then uses the seek path).
    if (!this.cur) throw new Error('no decodable video frame at ' + time.toFixed(3) + 's');
    if (this.done && !this.next && time - this.cur.timestamp > JUMP_REOPEN) throw new Error('video stream ended before ' + time.toFixed(3) + 's');
    return this.picture();
  }

  private async reopen(time: number): Promise<void> {
    await this.iter?.return(undefined).catch(() => undefined);
    this.cur?.close();
    this.next?.close();
    this.cur = this.next = null;
    this.drawn = null;
    this.done = false;
    this.opens++;
    this.iter = this.source.samples(time);
  }

  private picture(): AssetFrame {
    const s = this.cur!;
    if (this.drawn === s && this.frame) return this.frame;
    const w = Math.max(1, Math.round(s.width));
    const h = Math.max(1, Math.round(s.height));
    if (!this.pic || this.pic.canvas.width !== w || this.pic.canvas.height !== h) {
      this.pic = this.makeCanvas(w, h);
      if (!this.pic) throw new Error('no canvas for export decoding');
    }
    this.pic.ctx.clearRect(0, 0, w, h);
    s.draw(this.pic.ctx);
    this.drawn = s;
    this.frame = { source: this.pic.canvas, width: w, height: h };
    return this.frame;
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    const it = this.iter;
    this.iter = null;
    this.cur?.close();
    this.next?.close();
    this.cur = this.next = null;
    this.pic = null;
    this.frame = null;
    void it?.return(undefined).catch(() => undefined);
    this.onDispose?.();
  }
}

export type SourceOpener = (asset: MediaAsset) => Promise<SampleSource | null>;

interface Entry {
  source: Promise<SampleSource | null>;
  refs: number;
}

/** Owns the decode sources (one per asset) and readers (one per clip) of an export. */
export class ExportDecoders {
  private readonly entries = new Map<string, Entry>();
  private readonly readers = new Map<string, { assetId: string; reader: ForwardReader }>();
  private readonly failed = new Set<string>();

  constructor(
    private readonly open: SourceOpener,
    private readonly makeCanvas: CanvasFactory,
  ) {}

  /** Reader for a clip, or null if this asset can't be decoded sequentially (use the <video> path). */
  async reader(clipId: string, asset: MediaAsset): Promise<ForwardReader | null> {
    if (this.failed.has(asset.id)) return null;
    const own = this.readers.get(clipId);
    if (own && own.assetId === asset.id) return own.reader;
    if (own) this.release(clipId);
    let entry = this.entries.get(asset.id);
    if (!entry) {
      entry = { source: this.open(asset).catch(() => null), refs: 0 };
      this.entries.set(asset.id, entry);
    }
    entry.refs++;
    const source = await entry.source;
    if (!source) {
      entry.refs--;
      this.markFailed(asset.id);
      return null;
    }
    const reader = new ForwardReader(source, this.makeCanvas, () => this.unref(asset.id));
    this.readers.set(clipId, { assetId: asset.id, reader });
    return reader;
  }

  /** The asset can't be decoded sequentially (e.g. a decode error mid-stream): fall back for good. */
  markFailed(assetId: string): void {
    this.failed.add(assetId);
    for (const [clipId, r] of [...this.readers]) if (r.assetId === assetId) this.release(clipId);
    const e = this.entries.get(assetId);
    if (e && e.refs <= 0) this.dropEntry(assetId);
  }

  release(clipId: string): void {
    const r = this.readers.get(clipId);
    if (!r) return;
    this.readers.delete(clipId);
    r.reader.dispose();
  }

  /** Releases every reader whose clip is not in `keep`. */
  trim(keep: ReadonlySet<string>): void {
    for (const id of [...this.readers.keys()]) if (!keep.has(id)) this.release(id);
  }

  get size(): number {
    return this.readers.size;
  }

  dispose(): void {
    for (const id of [...this.readers.keys()]) this.release(id);
    for (const id of [...this.entries.keys()]) this.dropEntry(id);
    this.failed.clear();
  }

  private unref(assetId: string): void {
    const e = this.entries.get(assetId);
    if (!e) return;
    if (--e.refs <= 0) this.dropEntry(assetId);
  }

  private dropEntry(assetId: string): void {
    const e = this.entries.get(assetId);
    if (!e) return;
    this.entries.delete(assetId);
    void e.source.then((s) => s?.dispose()).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Default (browser) implementations
// ---------------------------------------------------------------------------

export function defaultPictureCanvas(width: number, height: number): PictureCanvas | null {
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      return ctx ? { canvas, ctx: ctx as unknown as SampleCtx } : null;
    }
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      return ctx ? { canvas, ctx: ctx as unknown as SampleCtx } : null;
    }
  } catch {
    /* no canvas */
  }
  return null;
}

/** Opens an asset blob with mediabunny + WebCodecs; null when unsupported. */
export function mediabunnyOpener(loadBlob: (asset: MediaAsset) => Promise<Blob | undefined>): SourceOpener {
  return async (asset) => {
    if (typeof VideoDecoder === 'undefined') return null;
    const blob = await loadBlob(asset);
    if (!blob) return null;
    const { ALL_FORMATS, BlobSource, Input, VideoSampleSink } = await import('mediabunny');
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) {
        input.dispose();
        return null;
      }
      const sink = new VideoSampleSink(track);
      return {
        async *samples(startTime: number) {
          for await (const s of sink.samples(Math.max(0, startTime))) {
            yield {
              timestamp: s.timestamp,
              width: s.displayWidth,
              height: s.displayHeight,
              draw: (ctx: SampleCtx) => s.draw(ctx as unknown as CanvasRenderingContext2D, 0, 0),
              close: () => s.close(),
            };
          }
        },
        dispose: () => input.dispose(),
      };
    } catch (e) {
      input.dispose();
      throw e;
    }
  };
}
