import { describe, expect, it } from 'vitest';
import { createClipFromAsset, getSortedTracks, getTrack, type ImageClip, type VideoClip } from '../../../core';
import { fillScale } from '../../overlays/FitInspector';
import {
  appendStart,
  autoAssign,
  buildTemplate,
  commitBuild,
  MAX_LEAD_IN,
  MIN_TEMPLATE_SPEED,
  resolveAssignments,
  slotTransform,
  TemplateBuildError,
} from '../builder';
import { TEMPLATE_FORMAT_VERSION, type TemplateSlot, type VideoTemplate } from '../types';
import { ASSETS, asset, projectFor } from './fixtures';

function tpl(slots: Partial<TemplateSlot>[], extra: Partial<VideoTemplate> = {}): VideoTemplate {
  let at = 0;
  const full = slots.map((s, i) => {
    const slot: TemplateSlot = { id: `s${i + 1}`, start: at, duration: 2, accepts: 'any', layer: 0, fit: 'cover', ...s };
    if (s.start === undefined) at += slot.duration;
    return slot;
  });
  const duration = Math.max(...full.map((s) => s.start + s.duration));
  return { formatVersion: TEMPLATE_FORMAT_VERSION, id: 't', name: 'T', category: 'Test', description: '', aspect: '9:16', duration, slots: full, texts: [], ...extra };
}

const byStart = <T extends { start: number }>(xs: T[]) => [...xs].sort((a, b) => a.start - b.start);

describe('video trimming', () => {
  it('takes a window that skips a little of the start, not 0..n', () => {
    const p = projectFor();
    const r = buildTemplate(tpl([{ duration: 2 }]), { s1: 'wide' }, {}, p);
    const c = r.clips[0] as VideoClip;
    expect(c.type).toBe('video');
    expect(c.sourceIn).toBeCloseTo(MAX_LEAD_IN, 6);
    expect(c.sourceOut).toBeCloseTo(MAX_LEAD_IN + 2, 6);
    expect(c.speed).toBe(1);
    expect(c.duration).toBe(2);
  });

  it('centers the window when the video is only a bit longer than the slot', () => {
    const p = projectFor('9:16', [asset('v', 'video', 1080, 1920, 3)]);
    const c = buildTemplate(tpl([{ duration: 2 }]), { s1: 'v' }, {}, p).clips[0] as VideoClip;
    expect(c.sourceIn).toBeCloseTo(0.5, 6);
    expect(c.sourceOut).toBeCloseTo(2.5, 6);
  });

  it('the same video in several slots shows different moments', () => {
    const p = projectFor();
    const r = buildTemplate(tpl([{}, {}, {}]), { s1: 'wide', s2: 'wide', s3: 'wide' }, {}, p);
    const ins = byStart(r.clips as VideoClip[]).map((c) => c.sourceIn);
    expect(new Set(ins.map((x) => x.toFixed(3))).size).toBe(3);
    for (const c of r.clips as VideoClip[]) expect(c.sourceOut).toBeLessThanOrEqual(30);
  });

  it('a slightly short video is slowed down to fill the slot', () => {
    const p = projectFor('9:16', [asset('v', 'video', 1080, 1920, 3)]);
    const r = buildTemplate(tpl([{ duration: 4 }]), { s1: 'v' }, {}, p);
    const c = r.clips[0] as VideoClip;
    expect(c.sourceIn).toBe(0);
    expect(c.sourceOut).toBe(3);
    expect(c.speed).toBeCloseTo(0.75, 9);
    expect(c.duration).toBeCloseTo(4, 9);
    expect(r.duration).toBe(4);
    expect(r.warnings).toEqual([]);
  });

  it('a much shorter video shortens its main-layer slot and later clips/texts move up (gap closed)', () => {
    const p = projectFor();
    const t = tpl([{ duration: 4 }, { duration: 2 }], {
      texts: [{ id: 'x', label: 'X', text: 'hello', start: 4, duration: 2, style: {}, x: 0.5, y: 0.5, editable: true }],
    });
    // "short" is 1 s: even at MIN_TEMPLATE_SPEED it lasts only 2 s.
    const r = buildTemplate(t, { s1: 'short', s2: 'tall' }, {}, p);
    const [a, b, text] = byStart(r.clips);
    expect(a!.type).toBe('video');
    expect((a as VideoClip).speed).toBe(MIN_TEMPLATE_SPEED);
    expect(a!.duration).toBeCloseTo(2, 9);
    expect(b!.start).toBeCloseTo(2, 9);
    expect(text!.type).toBe('text');
    expect(text!.start).toBeCloseTo(2, 9);
    expect(r.duration).toBeCloseTo(4, 9);
    expect(r.warnings[0]).toMatch(/shorter than slot 1/);
    // Never outside the source bounds; the core accepts everything.
    expect((a as VideoClip).sourceOut).toBeLessThanOrEqual(1);
    expect(commitBuild(p, r).rejected).toEqual([]);
  });

  it('a short video on an upper layer just ends early', () => {
    const p = projectFor();
    const t = tpl([{ duration: 4 }, { start: 0, duration: 4, layer: 1, frame: { x: 0.8, y: 0.8, w: 0.3, h: 0.2 } }]);
    const r = buildTemplate(t, { s1: 'tall', s2: 'short' }, {}, p);
    expect(r.duration).toBe(4);
    const over = r.clips.find((c) => c.type === 'video') as VideoClip;
    expect(over.duration).toBeCloseTo(2, 9);
    expect(over.speed).toBe(MIN_TEMPLATE_SPEED);
    expect(r.warnings.some((w) => /ends early/.test(w))).toBe(true);
    expect(commitBuild(p, r).rejected).toEqual([]);
  });
});

describe('images', () => {
  it('get the slot duration and the slot motion', () => {
    const p = projectFor();
    const r = buildTemplate(tpl([{ duration: 3.5, motion: { preset: 'zoom-in', amount: 1.3 } }]), { s1: 'tall' }, {}, p);
    const c = r.clips[0] as ImageClip;
    expect(c.type).toBe('image');
    expect(c.duration).toBe(3.5);
    expect(c.motion).toMatchObject({ preset: 'zoom-in', amount: 1.3, duration: 0 });
  });
});

describe('cycling and assignment', () => {
  it('cycles the supplied media when there are fewer than slots', () => {
    const t = tpl([{}, {}, {}, {}, {}]);
    const res = resolveAssignments(t, { s1: 'tall', s3: 'square' }, projectFor());
    expect(res.map((r) => r.assetId)).toEqual(['tall', 'tall', 'square', 'square', 'tall']);
    expect(res.map((r) => r.cycled)).toEqual([false, true, false, true, true]);
  });

  it('prefers fitting media when cycling into typed slots', () => {
    const t = tpl([{ accepts: 'video' }, { accepts: 'image' }, { accepts: 'image' }]);
    const res = resolveAssignments(t, { s1: 'wide', s2: 'tall' }, projectFor());
    expect(res[2]!.assetId).toBe('tall');
  });

  it('autoAssign fills empty slots in order, respects accepted kinds, reports extras', () => {
    const t = tpl([{ accepts: 'video' }, { accepts: 'image' }, {}]);
    const r = autoAssign(t, {}, [ASSETS.tallPhoto, ASSETS.wideVideo, ASSETS.squarePhoto, ASSETS.shortVideo]);
    expect(r.assignments).toEqual({ s1: 'wide', s2: 'tall', s3: 'square' });
    expect(r.unused).toEqual(['short']);
  });

  it('throws a readable error without any media', () => {
    expect(() => buildTemplate(tpl([{}]), {}, {}, projectFor())).toThrow(TemplateBuildError);
  });

  it('warns (but builds) when media does not match the slot kind', () => {
    const r = buildTemplate(tpl([{ accepts: 'video' }]), { s1: 'tall' }, {}, projectFor());
    expect(r.clips).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/meant for a video/);
  });
});

describe('fit', () => {
  it('cover fills the canvas whatever the source aspect (same as the Fill button)', () => {
    for (const [w, h] of [
      [1920, 1080],
      [1080, 1920],
      [1000, 1000],
      [640, 480],
    ]) {
      const tr = slotTransform({ fit: 'cover' }, w, h, 1080, 1920);
      expect(tr.scale).toBeCloseTo(fillScale(w, h, 1080, 1920), 5);
      expect(tr).toMatchObject({ x: 0.5, y: 0.5, rotation: 0, opacity: 1 });
    }
    // A landscape video in a portrait canvas must be scaled up a lot.
    expect(slotTransform({ fit: 'cover' }, 1920, 1080, 1080, 1920).scale).toBeCloseTo(1920 / 607.5, 4);
  });

  it('contain = scale 1 on the full canvas; frames fit inside their region', () => {
    expect(slotTransform({ fit: 'contain' }, 1920, 1080, 1080, 1920).scale).toBe(1);
    // Top half of a portrait canvas: a portrait photo fits by height.
    const tr = slotTransform({ fit: 'contain', frame: { x: 0.5, y: 0.25, w: 1, h: 0.5 } }, 1080, 1920, 1080, 1920);
    expect(tr.scale).toBeCloseTo(0.5, 6);
    expect(tr.y).toBe(0.25);
    // Square frame, cover: the smaller side matches the frame.
    const sq = slotTransform({ fit: 'cover', frame: { x: 0.8, y: 0.8, w: 0.3, h: 0.16875 } }, 1920, 1080, 1080, 1920);
    expect(1080 * sq.scale * (607.5 / 1080)).toBeCloseTo(324, 3);
  });

  it('builds cover by default for every media in a 9:16 template', () => {
    const p = projectFor();
    const r = buildTemplate(tpl([{}, {}, {}]), { s1: 'wide', s2: 'tall', s3: 'square' }, {}, p);
    for (const c of r.clips as (VideoClip | ImageClip)[]) {
      const a = p.assets[c.assetId]!;
      expect(c.transform.scale).toBeCloseTo(fillScale(a.width, a.height, p.width, p.height), 5);
    }
  });
});

describe('tracks, layers and placement', () => {
  it('main slots go to the Main track, background copies to a track right below it, texts on top, music on audio', () => {
    const p = projectFor();
    const t = tpl([{ layer: 1, fit: 'contain', copies: [{ layer: 0, fit: 'cover', effects: [{ effectType: 'blur', params: { amount: 20 } }] }] }], {
      texts: [{ id: 'a', label: 'A', text: 'A', start: 0, duration: 2, style: {}, x: 0.5, y: 0.5, editable: true }],
      music: { trackId: 'lofi-lazy-sunday', seed: 101, volume: 0.5 },
    });
    const r = buildTemplate(t, { s1: 'wide' }, {}, p, { musicAsset: asset('m', 'audio', 0, 0, 2) });
    const { project, rejected } = commitBuild(p, r);
    expect(rejected).toEqual([]);
    const main = p.tracks.find((tr) => tr.kind === 'video')!;
    const clips = Object.values(project.clips);
    const bg = clips.find((c) => c.name.includes('(background)'))!;
    const fg = clips.find((c) => c.type === 'video' && !c.name.includes('(background)'))!;
    const text = clips.find((c) => c.type === 'text')!;
    const music = clips.find((c) => c.type === 'audio')!;
    expect(fg.trackId).toBe(main.id);
    const order = (id: string) => getTrack(project, id)!.order;
    expect(getTrack(project, bg.trackId)!.name).toBe('Background');
    expect(order(bg.trackId)).toBe(order(fg.trackId) - 1);
    expect(order(text.trackId)).toBeGreaterThan(order(fg.trackId));
    expect(getTrack(project, music.trackId)!.kind).toBe('audio');
    expect((bg as VideoClip).volume).toBe(0);
    // Video sound is off by default when the template has music.
    expect((fg as VideoClip).volume).toBe(0);
    expect(music).toMatchObject({ start: 0, duration: 2, volume: 0.5 });

    // Appending the same template again reuses Main, Background and Text. (Music follows the
    // Music panel's rule: it only shares an empty or "Music…" audio track, so it gets one.)
    const again = buildTemplate(t, { s1: 'wide' }, {}, project, { start: 2, musicAsset: asset('m', 'audio', 0, 0, 2) });
    expect(again.newTracks).toEqual([{ key: expect.any(String), kind: 'audio', name: 'Music' }]);
    const c2 = commitBuild(project, again);
    expect(c2.rejected).toEqual([]);
    expect(c2.project.tracks.filter((tr) => tr.kind !== 'audio')).toHaveLength(project.tracks.filter((tr) => tr.kind !== 'audio').length);
  });

  it('appends after the current end, reusing free tracks', () => {
    let p = projectFor();
    const main = p.tracks.find((tr) => tr.kind === 'video')!;
    const existing = { ...(createClipFromAsset(ASSETS.tallPhoto, { trackId: main.id, start: 0 }) as ImageClip), id: 'old', duration: 7 };
    p = { ...p, clips: { old: existing } };
    const start = appendStart(p);
    expect(start).toBe(7);
    const r = buildTemplate(tpl([{}, {}]), { s1: 'tall', s2: 'wide' }, {}, p, { start });
    expect(r.newTracks).toEqual([]);
    const c = commitBuild(p, r);
    expect(c.rejected).toEqual([]);
    expect(byStart(Object.values(c.project.clips)).map((x) => x.start)).toEqual([0, 7, 9]);
    expect(getSortedTracks(c.project)).toHaveLength(p.tracks.length);
  });

  it('text sizes scale with the canvas short side; empty text values drop the layer', () => {
    const t = tpl([{}], {
      texts: [
        { id: 'a', label: 'A', text: 'Hello', start: 0, duration: 2, style: { fontSize: 100 }, x: 0.5, y: 0.2, scale: 1.5, editable: true },
        { id: 'b', label: 'B', text: 'Bye', start: 0, duration: 2, style: {}, x: 0.5, y: 0.8, editable: true },
      ],
    });
    const p = { ...projectFor('16:9'), width: 1280, height: 720 };
    const r = buildTemplate(t, { s1: 'tall' }, { a: 'Custom', b: '' }, p);
    const texts = r.clips.filter((c) => c.type === 'text');
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({ text: 'Custom', transform: { x: 0.5, y: 0.2, scale: 1 } });
  });
});
