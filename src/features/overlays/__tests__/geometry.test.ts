import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createClipFromAsset,
  createProject,
  createTextClip,
  defaultTextStyle,
  drawClip,
  getClipRenderer,
  ops,
  resetRegistries,
  type ImageClip,
  type MediaAsset,
  type Project,
  type TextClip,
} from '../../../core';
import { FakeContext, apply, fakeMeasureWidth, makeEnv } from '../../text/__tests__/fakeCanvas';
import { boxAabb, boxCorners, clipBox, hitTestBox, hitTestClips, toLocal, type ClipBox } from '../geometry';
import { register } from '../index';
import { fillScale } from '../FitInspector';
import { moveTransform, normalizeAngle, nudgeTransform, rotationFromDrag, scaleFromDrag, snapMove, MIN_SCALE } from '../transformMath';

const imageAsset = (id: string, w: number, h: number): MediaAsset => ({
  id,
  kind: 'image',
  name: `${id}.png`,
  mimeType: 'image/png',
  size: 1,
  duration: null,
  width: w,
  height: h,
  hasAudio: false,
  status: 'ready',
  objectURL: `blob:${id}`,
});

/** 1000x500 canvas, an overlay track with a 200x100 image (contain → 1000x500) and a text track. */
function setup() {
  let p: Project = { ...createProject(), width: 1000, height: 500 };
  p = { ...p, assets: { img: imageAsset('img', 200, 100) } };
  const ov = ops.addTrack(p, 'overlay');
  p = ov.project;
  const tx = ops.addTrack(p, 'text');
  p = tx.project;
  const image = { ...(createClipFromAsset(p.assets.img!, { trackId: ov.trackId, start: 0 }) as ImageClip), id: 'image' };
  image.transform = { x: 0.5, y: 0.5, scale: 0.2, rotation: 0, opacity: 1 }; // 200x100 box at center
  const text: TextClip = {
    ...createTextClip({ trackId: tx.trackId, start: 0, text: 'abcd', style: { ...defaultTextStyle(), fontSize: 20, lineHeight: 1, shadow: null } }),
    id: 'text',
  };
  text.transform = { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 }; // 40x20 box at center
  p = ops.addClip(p, image)!;
  p = ops.addClip(p, text)!;
  return { p, ov: ov.trackId, tx: tx.trackId };
}

describe('clip boxes match renderer geometry', () => {
  it('image: contain size x scale, centered at transform', () => {
    const { p } = setup();
    const b = clipBox(p.clips.image as ImageClip, p, fakeMeasureWidth)!;
    expect(b).toMatchObject({ cx: 500, cy: 250, width: 1000, height: 500, scale: 0.2 });
    const aabb = boxAabb(b);
    expect(aabb.left).toBeCloseTo(400);
    expect(aabb.right).toBeCloseTo(600);
  });

  it('text: box equals the text layout (fake measure)', () => {
    const { p } = setup();
    const b = clipBox(p.clips.text as TextClip, p, fakeMeasureWidth)!;
    expect(b.width).toBe(40);
    expect(b.height).toBe(20);
  });

  it('missing asset → no box', () => {
    const { p } = setup();
    const q = { ...p, assets: {} };
    expect(clipBox(q.clips.image as ImageClip, q, fakeMeasureWidth)).toBeNull();
  });
});

describe('hit testing with rotation and scale', () => {
  const box: ClipBox = { cx: 100, cy: 100, width: 100, height: 20, scale: 2, rotation: 90 };
  it('maps points into local space', () => {
    const l = toLocal(box, { x: 100, y: 180 });
    expect(l.x).toBeCloseTo(40);
    expect(l.y).toBeCloseTo(0);
  });
  it('rotated box: vertical extent is the scaled width', () => {
    expect(hitTestBox(box, { x: 100, y: 195 })).toBe(true); // 95 px below center, half-length 100
    expect(hitTestBox(box, { x: 100, y: 205 })).toBe(false);
    expect(hitTestBox(box, { x: 115, y: 100 })).toBe(true); // half-thickness 20
    expect(hitTestBox(box, { x: 125, y: 100 })).toBe(false);
    expect(hitTestBox(box, { x: 125, y: 100 }, 6)).toBe(true); // tolerance in canvas px
  });
  it('corners follow rotation', () => {
    const c = boxCorners({ cx: 0, cy: 0, width: 10, height: 4, scale: 1, rotation: 90 });
    expect(c[0].x).toBeCloseTo(2); // top-left (-5,-2) → (2,-5)
    expect(c[0].y).toBeCloseTo(-5);
  });

  it('topmost clip wins; selected clip is preferred; locked/hidden tracks are skipped', () => {
    const { p, tx, ov } = setup();
    // text track is above the overlay track → text on top at the center
    expect(hitTestClips(p, 1, { x: 500, y: 250 }, fakeMeasureWidth)!.clip.id).toBe('text');
    expect(hitTestClips(p, 1, { x: 450, y: 210 }, fakeMeasureWidth)!.clip.id).toBe('image');
    expect(hitTestClips(p, 1, { x: 500, y: 250 }, fakeMeasureWidth, 'image')!.clip.id).toBe('image');
    expect(hitTestClips(p, 1, { x: 50, y: 50 }, fakeMeasureWidth)).toBeNull();
    expect(hitTestClips(p, 99, { x: 500, y: 250 }, fakeMeasureWidth)).toBeNull(); // not active
    const locked = ops.updateTrack(p, tx, { locked: true })!;
    expect(hitTestClips(locked, 1, { x: 500, y: 250 }, fakeMeasureWidth)!.clip.id).toBe('image');
    const hidden = ops.updateTrack(p, ov, { hidden: true })!;
    expect(hitTestClips(hidden, 1, { x: 450, y: 210 }, fakeMeasureWidth)).toBeNull();
  });
});

describe('transform handle math', () => {
  it('scales about the center by distance ratio and clamps', () => {
    const c = { x: 0, y: 0 };
    expect(scaleFromDrag(1, c, { x: 10, y: 0 }, { x: 20, y: 0 })).toBe(2);
    expect(scaleFromDrag(2, c, { x: 3, y: 4 }, { x: 6, y: 8 })).toBe(4);
    expect(scaleFromDrag(1, c, { x: 10, y: 0 }, { x: 0, y: 0 })).toBe(MIN_SCALE);
  });

  it('rotation is the swept angle, with Shift steps and 90° magnet', () => {
    const c = { x: 0, y: 0 };
    expect(rotationFromDrag(0, c, { x: 10, y: 0 }, { x: 0, y: 10 }, 0, 0)).toBeCloseTo(90);
    expect(rotationFromDrag(10, c, { x: 10, y: 0 }, { x: 10, y: 10 }, 0, 0)).toBeCloseTo(55);
    expect(rotationFromDrag(0, c, { x: 10, y: 0 }, { x: 10, y: 3 }, 15)).toBe(15); // 16.7° → 15
    expect(rotationFromDrag(0, c, { x: 10, y: 0 }, { x: 0.3, y: 10 })).toBe(90); // 88.3° → magnet 90
    expect(rotationFromDrag(170, c, { x: 10, y: 0 }, { x: 0, y: 10 }, 0, 0)).toBeCloseTo(-100);
    expect(normalizeAngle(540)).toBe(180);
    expect(normalizeAngle(-180)).toBe(180);
  });

  it('move snaps center and edges to the canvas with guides', () => {
    const start = { x: 0.2, y: 0.2, scale: 1, rotation: 0, opacity: 1 };
    const size = { width: 100, height: 50 };
    // center 200,100 → drag to 497,103 → snaps x to 500 (center guide)
    const r = moveTransform(start, size, 297, 3, 1000, 500, 6);
    expect(r.transform.x).toBeCloseTo(0.5);
    expect(r.transform.y).toBeCloseTo(103 / 500);
    expect(r.guides).toEqual([{ axis: 'x', pos: 500 }]);
    // left edge near 0: center 53 → snaps to 50 (edge guide at 0); bottom edge near 500
    const r2 = moveTransform(start, size, -147, 372, 1000, 500, 6);
    expect(r2.transform.x * 1000).toBeCloseTo(50);
    expect(r2.transform.y * 500).toBeCloseTo(475);
    expect(r2.guides).toEqual([
      { axis: 'x', pos: 0 },
      { axis: 'y', pos: 500 },
    ]);
    // threshold 0 disables snapping
    expect(moveTransform(start, size, 297, 3, 1000, 500, 0).guides).toEqual([]);
  });

  it('snapping uses the rotated axis-aligned bounds', () => {
    // Rotated 90°: the AABB half-width is 10 (not 50), so a center at 14 puts the left edge at 4 → snaps to 0.
    const r = snapMove({ cx: 14, cy: 250, width: 100, height: 20, scale: 1, rotation: 90 }, 1000, 500, 6);
    expect(r.cx).toBeCloseTo(10);
    expect(r.cy).toBe(250);
    expect(r.guides).toEqual([
      { axis: 'x', pos: 0 },
      { axis: 'y', pos: 250 },
    ]);
    const unrotated = snapMove({ cx: 14, cy: 250, width: 100, height: 20, scale: 1, rotation: 0 }, 1000, 500, 6);
    expect(unrotated.cx).toBe(14);
  });

  it('nudge moves by project pixels', () => {
    const t = nudgeTransform({ x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 }, 1, -1, 10, 1000, 500);
    expect(t.x).toBeCloseTo(0.51);
    expect(t.y).toBeCloseTo(0.48);
  });

  it('fill scale covers the canvas', () => {
    expect(fillScale(200, 100, 1000, 1000)).toBeCloseTo(2);
    expect(fillScale(100, 100, 1000, 500)).toBeCloseTo(2);
  });
});

describe('image renderer via core registry', () => {
  beforeEach(() => {
    resetRegistries();
    register();
  });
  afterEach(() => resetRegistries());

  it('draws the frame contain-fit with the transform', () => {
    const { p } = setup();
    const clip = { ...(p.clips.image as ImageClip), transform: { x: 0.25, y: 0.5, scale: 0.5, rotation: 0, opacity: 1 } };
    const src = {} as CanvasImageSource;
    const ctx = new FakeContext();
    const env = makeEnv(p, { getAssetFrame: (id) => (id === 'img' ? { source: src, width: 200, height: 100 } : null) });
    expect(drawClip(ctx.asCanvas(), clip, env)).toBe(true);
    const call = ctx.ops('drawImage')[0]!;
    expect(call.args).toEqual([src, -500, -250, 1000, 500]);
    const tl = apply(call.matrix, -500, -250);
    expect(tl.x).toBeCloseTo(0);
    expect(tl.y).toBeCloseTo(125);
  });

  it('draws nothing while the frame is not decoded', () => {
    const { p } = setup();
    const ctx = new FakeContext();
    getClipRenderer('image')!(ctx.asCanvas(), p.clips.image as ImageClip, 0, makeEnv(p));
    expect(ctx.calls).toHaveLength(0);
  });
});
