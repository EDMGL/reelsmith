import { describe, expect, it } from 'vitest';
import { createClipFromAsset, createTextClip, type AudioClip, type Clip, type ImageClip, type Project, type VideoClip } from '../../../core';
import { buildTemplate, commitBuild } from '../builder';
import { findBuiltinTemplate } from '../catalogue';
import { loadUserTemplates, readTemplateFile, storeUserTemplates, templateFileName, templateFromProject, templateJson, USER_CATEGORY } from '../userTemplates';
import { asset, ASSETS, projectFor } from './fixtures';

const comparable = (c: Clip) => {
  const { id: _i, trackId: _t, effects, ...rest } = c as Clip & Record<string, unknown>;
  return { ...rest, effects: effects.map((e) => ({ type: e.effectType, params: e.params })) };
};

function sampleProject(): Project {
  const p = projectFor('9:16');
  const main = p.tracks.find((t) => t.kind === 'video')!.id;
  const overlay = 'ov';
  const textTrack = 'tx';
  const tracks = [...p.tracks, { id: overlay, kind: 'overlay' as const, name: 'Overlay', order: 2, muted: false, locked: false, hidden: false }, { id: textTrack, kind: 'text' as const, name: 'Text', order: 3, muted: false, locked: false, hidden: false }];
  const img: ImageClip = {
    ...(createClipFromAsset(ASSETS.tallPhoto, { trackId: main, start: 0 }) as ImageClip),
    id: 'c1',
    duration: 3,
    motion: { preset: 'pan-left', amount: 1.2, duration: 0, focusX: 0.5, focusY: 0.42 },
    effects: [{ id: 'fx1', effectType: 'sepia', params: { amount: 40 }, enabled: true }],
    fadeIn: 0.3,
  };
  const vid: VideoClip = {
    ...(createClipFromAsset(ASSETS.wideVideo, { trackId: main, start: 3 }) as VideoClip),
    id: 'c2',
    sourceIn: 1.5,
    sourceOut: 3.5,
    duration: 2,
    volume: 0.4,
    transform: { x: 0.5, y: 0.5, scale: 1920 / 607.5, rotation: 0, opacity: 1 },
  };
  const pip: ImageClip = {
    ...(createClipFromAsset(ASSETS.squarePhoto, { trackId: overlay, start: 1 }) as ImageClip),
    id: 'c3',
    duration: 3,
    transform: { x: 0.8, y: 0.75, scale: 0.3, rotation: 6, opacity: 0.9 },
    shape: { kind: 'circle', radius: 0.5, border: 6, borderColor: '#ffffff' },
  };
  const txt = { ...createTextClip({ trackId: textTrack, start: 0.5, duration: 2, text: 'Hello', style: { fontSize: 90, color: '#ff0' }, name: 'Greeting' }), id: 'c4' };
  return { ...p, tracks, clips: { c1: img, c2: vid, c3: pip, c4: txt } };
}

describe('save as template', () => {
  it('round-trips: rebuilding the template with the same media gives the same clips', () => {
    const p = sampleProject();
    const saved = templateFromProject(p, { name: 'Mine' });
    expect(saved.error).toBeUndefined();
    const t = saved.template!;
    expect(t.category).toBe(USER_CATEGORY);
    expect(t.slots).toHaveLength(3);
    expect(t.texts).toHaveLength(1);
    expect(t.texts[0]).toMatchObject({ label: 'Greeting', text: 'Hello', editable: true });
    expect(t.slots.map((s) => s.fit)).toEqual(['cover', 'contain', 'cover']);
    expect(saved.notes.some((n) => /trims and speed/.test(n))).toBe(true);

    const empty = projectFor('9:16');
    const r = buildTemplate(t, { s1: 'tall', s2: 'square', s3: 'wide' }, {}, empty);
    const { project: rebuilt, rejected } = commitBuild(empty, r);
    expect(rejected).toEqual([]);
    const before = Object.values(p.clips).map(comparable);
    const after = Object.values(rebuilt.clips).map(comparable);
    const key = (c: { start: number; type: string }) => `${c.type}@${c.start}`;
    const sortBy = <T extends { start: number; type: string }>(xs: T[]) => [...xs].sort((a, b) => key(a).localeCompare(key(b)));
    for (const [a, b] of sortBy(before).map((c, i) => [c, sortBy(after)[i]!] as const)) {
      expect(b.type).toBe(a.type);
      expect(b.start).toBeCloseTo(a.start, 6);
      expect(b.duration).toBeCloseTo(a.duration, 6);
      expect(b.effects).toEqual(a.effects);
      expect(b.fadeIn).toBe(a.fadeIn);
      const ta = (a as { transform?: Record<string, number> }).transform;
      const tb = (b as { transform?: Record<string, number> }).transform;
      if (ta) for (const k of Object.keys(ta)) expect(tb![k], `${a.type} transform.${k}`).toBeCloseTo(ta[k]!, 5);
      expect((b as { motion?: unknown }).motion).toEqual((a as { motion?: unknown }).motion);
      expect((b as { shape?: unknown }).shape).toEqual((a as { shape?: unknown }).shape);
      if (a.type === 'text') expect((b as { text: string }).text).toBe('Hello');
      if (a.type === 'video') expect((b as { volume: number }).volume).toBe(0.4);
    }
    // Overlay stays above the main track.
    const order = (id: string) => rebuilt.tracks.find((tr) => tr.id === id)!.order;
    const pipClip = Object.values(rebuilt.clips).find((c) => c.type === 'image' && 'shape' in c && c.shape)!;
    const mainClip = Object.values(rebuilt.clips).find((c) => c.type === 'video')!;
    expect(order(pipClip.trackId)).toBeGreaterThan(order(mainClip.trackId));
  });

  it('keeps catalogue music as a reference; drops other audio with a note', () => {
    const p = sampleProject();
    const audioTrack = p.tracks.find((t) => t.kind === 'audio')!.id;
    const music = asset('m', 'audio', 0, 0, 30);
    music.name = 'Lazy Sunday (B, 0:30).wav';
    const voice = asset('vo', 'audio', 0, 0, 3);
    const mClip = { ...(createClipFromAsset(music, { trackId: audioTrack, start: 0 }) as AudioClip), id: 'm1', volume: 0.3, fadeOut: 2 };
    const vClip = { ...(createClipFromAsset(voice, { trackId: audioTrack, start: 40 }) as AudioClip), id: 'v1' };
    const proj = { ...p, assets: { ...p.assets, m: music, vo: voice }, clips: { ...p.clips, m1: mClip, v1: vClip } };
    const saved = templateFromProject(proj, { name: 'With music' });
    expect(saved.template!.music).toEqual({ trackId: 'lofi-lazy-sunday', seed: 102, volume: 0.3, fadeOut: 2 });
    expect(saved.notes.some((n) => /1 audio clip/.test(n))).toBe(true);
  });

  it('refuses a timeline without pictures', () => {
    const r = templateFromProject(projectFor(), { name: 'x' });
    expect(r.template).toBeNull();
    expect(r.error).toMatch(/no video or photo/);
  });
});

describe('storage and files', () => {
  it('stores and loads user templates; invalid stored entries are skipped', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const t = templateFromProject(sampleProject(), { name: 'Stored' }).template!;
    expect(storeUserTemplates([t], storage)).toBe(true);
    expect(loadUserTemplates(storage).templates).toEqual([t]);
    mem.set('erdemcut:templates:v1', JSON.stringify([t, { junk: true }]));
    const l = loadUserTemplates(storage);
    expect(l.templates).toHaveLength(1);
    expect(l.skipped).toBe(1);
    mem.set('erdemcut:templates:v1', 'not json');
    expect(loadUserTemplates(storage).templates).toEqual([]);
  });

  it('exports and re-imports a template file with a fresh id', async () => {
    const t = findBuiltinTemplate('featured-postcard-trail')!;
    const json = templateJson(t);
    expect(templateFileName(t)).toBe('postcard-trail.template.json');
    const file = { name: 'x.json', size: json.length, text: async () => json };
    const r = await readTemplateFile(file);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.template.id).not.toBe(t.id);
    expect(r.template.id.startsWith('user-')).toBe(true);
    expect(r.template.category).toBe(USER_CATEGORY);
    expect(r.template.slots).toEqual(t.slots);
    const bad = await readTemplateFile({ name: 'b.json', size: 5, text: async () => '[1,2]' });
    expect(bad.ok).toBe(false);
  });
});
