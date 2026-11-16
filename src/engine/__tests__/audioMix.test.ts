import { describe, expect, it } from 'vitest';
import { createClipFromAsset, createProject, type AudioClip, type Project, type VideoClip } from '../../core';
import { makeAsset } from '../../core/__tests__/fixtures';
import { gainBreakpoints, planAudioMix, renderAudioMix } from '../audioMix';

function setup(): { project: Project; v: string; a: string } {
  const p = createProject();
  const v = p.tracks.find((t) => t.kind === 'video')!.id;
  const a = p.tracks.find((t) => t.kind === 'audio')!.id;
  return { project: { ...p, assets: { vid: makeAsset('vid', 20), aud: makeAsset('aud', 30, 'audio') } }, v, a };
}

const add = (p: Project, ...clips: (VideoClip | AudioClip)[]): Project => ({
  ...p,
  clips: { ...p.clips, ...Object.fromEntries(clips.map((c) => [c.id, c])) },
});

describe('gain envelope math', () => {
  it('produces breakpoints at range edges and fade corners', () => {
    expect(gainBreakpoints({ duration: 10, fadeIn: 1, fadeOut: 2 }, 0, 10)).toEqual([0, 1, 8, 10]);
    expect(gainBreakpoints({ duration: 10, fadeIn: 1, fadeOut: 2 }, 0.5, 9)).toEqual([0.5, 1, 8, 9]);
    expect(gainBreakpoints({ duration: 10, fadeIn: 0, fadeOut: 0 }, 2, 4)).toEqual([2, 4]);
    // Overlapping fades: the min() kink where the ramps cross is a breakpoint.
    expect(gainBreakpoints({ duration: 2, fadeIn: 2, fadeOut: 2 }, 0, 2)).toEqual([0, 1, 2]);
  });

  it('plans volume x fades, trims and speed for a range', () => {
    const { project: p0, v, a } = setup();
    const video: VideoClip = {
      ...(createClipFromAsset(p0.assets.vid!, { trackId: v, start: 2 }) as VideoClip),
      id: 'v',
      sourceIn: 4,
      sourceOut: 12,
      speed: 2,
      duration: 4,
      volume: 0.5,
      fadeIn: 1,
      fadeOut: 1,
    };
    const music: AudioClip = { ...(createClipFromAsset(p0.assets.aud!, { trackId: a, start: 0 }) as AudioClip), id: 'm', volume: 2 };
    const plan = planAudioMix(add(p0, video, music), 3, 8);
    expect(plan.map((s) => s.clipId).sort()).toEqual(['m', 'v']);
    const m = plan.find((s) => s.clipId === 'm')!;
    expect(m).toMatchObject({ when: 0, offset: 3, duration: 5, playbackRate: 1 });
    expect(m.gains).toEqual([
      { time: 0, value: 2 },
      { time: 5, value: 2 },
    ]);
    const s = plan.find((x) => x.clipId === 'v')!;
    // Range starts 1s into the clip: output 0, source 4 + 1 * 2 = 6.
    expect(s).toMatchObject({ when: 0, offset: 6, duration: 3, playbackRate: 2 });
    // local 1 (fade-in done) .. local 3 (fade-out starts) .. local 4 (end).
    expect(s.gains.map((g) => [g.time, g.value])).toEqual([
      [0, 0.5],
      [2, 0.5],
      [3, 0],
    ]);
  });

  it('starts a clip later in the output when it begins inside the range', () => {
    const { project: p0, v } = setup();
    const video: VideoClip = { ...(createClipFromAsset(p0.assets.vid!, { trackId: v, start: 5 }) as VideoClip), id: 'v', fadeIn: 2, sourceOut: 4, duration: 4 };
    const [s] = planAudioMix(add(p0, video), 4, 20);
    expect(s).toMatchObject({ when: 1, offset: 0, duration: 4 });
    expect(s!.gains.map((g) => [g.time, g.value])).toEqual([
      [1, 0],
      [3, 1],
      [5, 1],
    ]);
  });

  it('skips muted tracks, silent clips, video without audio and clips outside the range', () => {
    const { project: p0, v, a } = setup();
    const video = { ...(createClipFromAsset(p0.assets.vid!, { trackId: v, start: 0 }) as VideoClip), id: 'v' };
    const music = { ...(createClipFromAsset(p0.assets.aud!, { trackId: a, start: 0 }) as AudioClip), id: 'm' };
    let project = add(p0, video, music);
    expect(planAudioMix(project, 0, 1)).toHaveLength(2);
    expect(planAudioMix(project, 40, 41)).toHaveLength(0);
    project = { ...project, tracks: project.tracks.map((t) => (t.id === a ? { ...t, muted: true } : t)) };
    expect(planAudioMix(project, 0, 1).map((s) => s.clipId)).toEqual(['v']);
    project = add(project, { ...video, volume: 0 });
    expect(planAudioMix(project, 0, 1)).toHaveLength(0);
    project = add({ ...project, assets: { ...project.assets, vid: { ...project.assets.vid!, hasAudio: false } } }, { ...video, volume: 1 });
    expect(planAudioMix(project, 0, 1)).toHaveLength(0);
  });
});

describe('renderAudioMix', () => {
  class FakeParam {
    calls: [string, number, number][] = [];
    value = 1;
    setValueAtTime(v: number, t: number) {
      this.calls.push(['set', v, t]);
    }
    linearRampToValueAtTime(v: number, t: number) {
      this.calls.push(['ramp', v, t]);
    }
  }
  function fakeContext(log: string[]) {
    return (channels: number, length: number, sampleRate: number) => {
      const ctx = {
        sampleRate,
        destination: {},
        createBuffer: (c: number, l: number, r: number) => ({ numberOfChannels: c, length: l, sampleRate: r, silent: true }),
        createBufferSource: () => {
          const src = {
            buffer: null as unknown,
            playbackRate: new FakeParam(),
            connect: () => undefined,
            start: (w: number, o: number) => log.push(`start ${w} ${o}`),
            stop: (t: number) => log.push(`stop ${t}`),
          };
          return src;
        },
        createGain: () => {
          const g = { gain: new FakeParam(), connect: () => undefined };
          setTimeout(() => log.push(`gain ${JSON.stringify(g.gain.calls)}`));
          return g;
        },
        startRendering: async () => ({ numberOfChannels: channels, length, sampleRate, silent: false }),
      };
      return ctx as unknown as OfflineAudioContext;
    };
  }

  it('returns silence of the exact length when nothing is audible', async () => {
    const { project } = setup();
    const log: string[] = [];
    const buf = (await renderAudioMix(project, { start: 0, end: 2.5, sampleRate: 48000, channels: 2 }, fakeContext(log), async () => null)) as unknown as {
      length: number;
      numberOfChannels: number;
      silent: boolean;
    };
    expect(buf).toMatchObject({ length: 120000, numberOfChannels: 2, silent: true });
  });

  it('schedules sources with offsets, rates, stop times and gain ramps', async () => {
    const { project: p0, v } = setup();
    const video = { ...(createClipFromAsset(p0.assets.vid!, { trackId: v, start: 1 }) as VideoClip), id: 'v', sourceIn: 2, sourceOut: 6, duration: 4, fadeOut: 1 };
    const log: string[] = [];
    const buf = (await renderAudioMix(add(p0, video), { start: 0, end: 10, sampleRate: 1000, channels: 1 }, fakeContext(log), async () =>
      ({ duration: 20 }) as AudioBuffer,
    )) as unknown as { length: number; silent: boolean };
    await new Promise((r) => setTimeout(r));
    expect(buf).toMatchObject({ length: 10000, silent: false });
    expect(log).toContain('start 1 2');
    expect(log).toContain('stop 5');
    expect(log).toContain('gain [["set",1,1],["ramp",1,4],["ramp",0,5]]');
  });
});
