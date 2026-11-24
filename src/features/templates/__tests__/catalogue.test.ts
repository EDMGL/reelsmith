import { describe, expect, it } from 'vitest';
import { getTrack, type Clip, type MediaAsset } from '../../../core';
import { findTrack, MUSIC_TRACKS } from '../../music/catalogue';
import { buildTemplate, commitBuild, type SlotAssignments } from '../builder';
import { builtinTemplates, FEATURED_CATEGORY, FEATURED_TEMPLATES, filterTemplates, RECIPES, templateCategories } from '../catalogue';
import { BEATS_PER_BAR } from '../recipes';
import type { VideoTemplate } from '../types';
import { validateTemplate } from '../validate';
import { asset, projectFor } from './fixtures';

const all = builtinTemplates();
const media: MediaAsset[] = [asset('v1', 'video', 1920, 1080, 60), asset('p1', 'image', 1080, 1920), asset('p2', 'image', 1200, 900)];

function fillAll(t: VideoTemplate): SlotAssignments {
  // Respect accepted kinds so no mismatch warnings; otherwise cycle all media.
  return Object.fromEntries(
    t.slots.map((s, i) => {
      const pool = media.filter((m) => s.accepts === 'any' || s.accepts === m.kind);
      return [s.id, pool[i % pool.length]!.id];
    }),
  );
}

/** Everything the user would see/hear, without random ids. */
function signature(t: VideoTemplate): string {
  const project = projectFor(t.aspect, media);
  const music = t.music ? asset('music', 'audio', 0, 0, t.duration) : undefined;
  const r = buildTemplate(t, fillAll(t), {}, project, { musicAsset: music });
  const { project: p } = commitBuild(project, r);
  const strip = (c: Clip) => {
    const { id: _id, trackId, effects, ...rest } = c as Clip & Record<string, unknown>;
    return { ...rest, track: getTrack(p, trackId)?.order, effects: effects.map((e) => [e.effectType, e.params]) };
  };
  return JSON.stringify({ aspect: t.aspect, music: t.music, clips: Object.values(p.clips).map(strip).sort((a, b) => a.start - b.start || (a.track ?? 0) - (b.track ?? 0)) });
}

describe('built-in template catalogue', () => {
  it('has at least 100 templates with unique ids and names', () => {
    expect(all.length).toBeGreaterThanOrEqual(100);
    expect(new Set(all.map((t) => t.id)).size).toBe(all.length);
    expect(new Set(all.map((t) => t.name.toLowerCase())).size).toBe(all.length);
    expect(FEATURED_TEMPLATES.length).toBeGreaterThanOrEqual(10);
    expect(RECIPES.length + FEATURED_TEMPLATES.length).toBe(all.length);
  });

  it('spreads over enough categories and all four main aspects', () => {
    const cats = templateCategories();
    expect(cats.length).toBeGreaterThanOrEqual(12);
    for (const c of cats) expect(all.filter((t) => t.category === c).length).toBeGreaterThanOrEqual(3);
    for (const a of ['9:16', '1:1', '16:9', '4:5'] as const) expect(all.filter((t) => t.aspect === a).length).toBeGreaterThanOrEqual(8);
  });

  it('every template passes the validator unchanged', () => {
    for (const t of all) {
      const v = validateTemplate(JSON.parse(JSON.stringify(t)));
      expect(v.ok ? [] : v.errors, t.id).toEqual([]);
      if (v.ok) expect(v.template, t.id).toEqual(JSON.parse(JSON.stringify(t)));
    }
  });

  it('every template builds to valid clips (all accepted by the core) and differs from every other', () => {
    const seen = new Map<string, string>();
    for (const t of all) {
      const project = projectFor(t.aspect, media);
      const r = buildTemplate(t, fillAll(t), {}, project, { musicAsset: t.music ? asset('music', 'audio', 0, 0, t.duration) : undefined });
      expect(r.warnings, t.id).toEqual([]);
      const c = commitBuild(project, r);
      expect(c.rejected, t.id).toEqual([]);
      expect(c.added.length, t.id).toBe(r.clips.length);
      for (const clip of Object.values(c.project.clips)) {
        if (clip.type === 'video') {
          expect(clip.sourceIn).toBeGreaterThanOrEqual(0);
          expect(clip.sourceOut).toBeLessThanOrEqual(60 + 1e-9);
          expect(clip.duration).toBeCloseTo((clip.sourceOut - clip.sourceIn) / clip.speed, 6);
        }
      }
      const sig = signature(t);
      expect(seen.get(sig), `${t.id} builds exactly like ${seen.get(sig)}`).toBeUndefined();
      seen.set(sig, t.id);
    }
  });

  it('music references are real catalogue tracks and every cut lands on a beat of that track', () => {
    for (const t of all) {
      expect(t.music, t.id).toBeDefined();
      const def = findTrack(t.music!.trackId)!;
      expect(def, t.id).toBeDefined();
      expect(def.variations.map((v) => v.seed), t.id).toContain(t.music!.seed);
      // The tempo the cut grid uses is the arrangement's real tempo, in 4/4.
      const arr = def.compose(t.music!.seed);
      expect(arr.bpm).toBe(def.bpm);
      expect(arr.beatsPerBar).toBe(BEATS_PER_BAR);
      const beat = 60 / arr.bpm;
      const onBeat = (x: number) => Math.abs(x / beat - Math.round(x / beat)) < 1e-4;
      for (const s of t.slots) {
        expect(onBeat(s.start), `${t.id} ${s.id} start ${s.start}`).toBe(true);
        expect(onBeat(s.start + s.duration), `${t.id} ${s.id} end`).toBe(true);
      }
      expect(onBeat(t.duration), t.id).toBe(true);
      // Whole bars: the music loop is cut on a bar line.
      expect(Math.abs(t.duration / (beat * BEATS_PER_BAR) - Math.round(t.duration / (beat * BEATS_PER_BAR))) < 1e-4, t.id).toBe(true);
    }
  });

  it('uses most of the music catalogue', () => {
    const used = new Set(all.map((t) => t.music!.trackId));
    expect(used.size).toBe(MUSIC_TRACKS.length);
  });

  it('filters by query, category, featured and aspect', () => {
    expect(filterTemplates(all, {})).toHaveLength(all.length);
    expect(filterTemplates(all, { category: FEATURED_CATEGORY }).every((t) => t.featured)).toBe(true);
    expect(filterTemplates(all, { category: 'Travel' }).every((t) => t.category === 'Travel')).toBe(true);
    expect(filterTemplates(all, { aspect: '16:9' }).every((t) => t.aspect === '16:9')).toBe(true);
    expect(filterTemplates(all, { query: 'beat flip' }).map((t) => t.name)).toContain('Beat Flip');
    expect(filterTemplates(all, { query: 'zzzz nothing' })).toHaveLength(0);
  });
});
