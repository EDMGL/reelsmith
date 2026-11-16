import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createProject,
  createTextClip,
  defaultTextStyle,
  drawClip,
  getClipRenderer,
  resetRegistries,
  useEditorStore,
  type TextStyle,
} from '../../../core';
import { register } from '../index';
import { parseColor, toCss } from '../color';
import { addTextAtPlayhead, TEXT_PRESETS } from '../presets';
import { fontString, layoutText, lineCenterY, wrapText, TEXT_WRAP_FRACTION } from '../textLayout';
import { layoutTextClip } from '../renderText';
import { FakeContext, apply, fakeMeasureWidth, makeEnv } from './fakeCanvas';

const style = (patch: Partial<TextStyle> = {}): TextStyle => ({ ...defaultTextStyle(), fontFamily: 'Test', fontSize: 20, lineHeight: 1.5, shadow: null, ...patch });

describe('wrapText', () => {
  const m = (s: string) => s.length * 10; // 10 px per char
  it('wraps greedily at word boundaries', () => {
    expect(wrapText('aaa bbb ccc', 75, m)).toEqual(['aaa bbb', 'ccc']);
    expect(wrapText('aaa bbb ccc', 200, m)).toEqual(['aaa bbb ccc']);
  });
  it('keeps explicit newlines and empty lines, normalizes CRLF', () => {
    expect(wrapText('one\r\n\r\ntwo', 1000, m)).toEqual(['one', '', 'two']);
  });
  it('breaks words longer than the max width by characters', () => {
    expect(wrapText('abcdefghij', 40, m)).toEqual(['abcd', 'efgh', 'ij']);
  });
  it('collapses whitespace runs and drops trailing spaces at breaks', () => {
    expect(wrapText('a   b    c', 30, m)).toEqual(['a b', 'c']);
  });
  it('maxWidth <= 0 disables wrapping', () => {
    expect(wrapText('aaa bbb', 0, m)).toEqual(['aaa bbb']);
  });
});

describe('layoutText', () => {
  it('computes line metrics with a fake measureText', () => {
    const l = layoutText('hello world\nhi', style(), 1000, fakeMeasureWidth);
    expect(l.font).toBe('700 20px Test');
    expect(l.lines.map((x) => x.text)).toEqual(['hello world', 'hi']);
    expect(l.lines[0]!.width).toBe(110); // 11 chars * 20 * 0.5
    expect(l.textWidth).toBe(110);
    expect(l.lineAdvance).toBe(30);
    expect(l.textHeight).toBe(60);
    expect(l.boxWidth).toBe(110);
    expect(l.boxHeight).toBe(60);
    expect(lineCenterY(l, 0)).toBe(-15);
    expect(lineCenterY(l, 1)).toBe(15);
  });
  it('adds background padding to the box', () => {
    const l = layoutText('abc', style({ background: { color: '#000', padding: 8, radius: 4 } }), 1000, fakeMeasureWidth);
    expect(l.boxWidth).toBe(30 + 16);
    expect(l.boxHeight).toBe(30 + 16);
  });
  it('font string includes italic and weight', () => {
    expect(fontString({ fontFamily: 'X, sans-serif', fontSize: 12, fontWeight: 400, italic: true })).toBe('italic 400 12px X, sans-serif');
  });
  it('text clips wrap at a fixed fraction of the canvas width, independent of scale', () => {
    const clip = createTextClip({ trackId: 't', start: 0, text: 'word '.repeat(40).trim(), style: style() });
    const l = layoutTextClip(clip, 1000, fakeMeasureWidth);
    expect(l.textWidth).toBeLessThanOrEqual(1000 * TEXT_WRAP_FRACTION);
    expect(l.lines.length).toBeGreaterThan(1);
  });
});

describe('text renderer via core registry', () => {
  beforeEach(() => {
    resetRegistries();
    register();
  });
  afterEach(() => resetRegistries());

  it('registers the text renderer and draws lines at the transformed position', () => {
    const project = { ...createProject(), width: 1000, height: 500 };
    const clip = {
      ...createTextClip({ trackId: project.tracks[0]!.id, start: 0, text: 'ab\ncd', style: style({ align: 'left' }) }),
      transform: { x: 0.25, y: 0.5, scale: 2, rotation: 90, opacity: 1 },
    };
    expect(getClipRenderer('text')).toBeTypeOf('function');
    const ctx = new FakeContext();
    expect(drawClip(ctx.asCanvas(), clip, makeEnv(project, { time: 1 }))).toBe(true);
    const fills = ctx.ops('fillText');
    expect(fills.map((c) => c.args[0])).toEqual(['ab', 'cd']);
    // local layout: width 20, lineAdvance 30 → line 0 anchored at (-10, -15)
    expect(fills[0]!.args.slice(1)).toEqual([-10, -15]);
    expect(fills[0]!.state.textAlign).toBe('left');
    expect(fills[0]!.state.textBaseline).toBe('middle');
    // Canvas position: center (250, 250); rotate 90° then scale 2: (-10,-15) → (250 + 30, 250 - 20)
    const p = apply(fills[0]!.matrix, -10, -15);
    expect(p.x).toBeCloseTo(280);
    expect(p.y).toBeCloseTo(230);
    expect(ctx.ops('strokeText')).toHaveLength(0);
  });

  it('draws background, outline under fill, and scales shadows with the transform', () => {
    const project = createProject();
    const clip = {
      ...createTextClip({
        trackId: project.tracks[0]!.id,
        start: 0,
        text: 'Hi',
        style: style({ stroke: { color: '#111', width: 3 }, shadow: { color: 'red', blur: 4, offsetX: 2, offsetY: 0 } }),
      }),
      transform: { x: 0.5, y: 0.5, scale: 3, rotation: 0, opacity: 1 },
    };
    const ctx = new FakeContext();
    ctx.scale(0.5, 0.5); // e.g. preview at half resolution
    getClipRenderer('text')!(ctx.asCanvas(), clip, 0, makeEnv(project));
    const order = ctx.calls.map((c) => c.op);
    expect(order).toEqual(['strokeText', 'fillText']);
    const stroke = ctx.ops('strokeText')[0]!;
    expect(stroke.state.lineWidth).toBe(6);
    expect(stroke.state.shadowBlur).toBeCloseTo(4 * 1.5); // 3 (clip) * 0.5 (base)
    expect(stroke.state.shadowOffsetX).toBeCloseTo(3);
    expect(ctx.ops('fillText')[0]!.state.shadowColor).toBe('rgba(0,0,0,0)'); // shadow only once
  });

  it('draws the background box before text and carries the shadow on it', () => {
    const project = createProject();
    const clip = createTextClip({
      trackId: project.tracks[0]!.id,
      start: 0,
      text: 'Box',
      style: style({ background: { color: '#fff', padding: 10, radius: 5 }, shadow: { color: 'black', blur: 2, offsetX: 0, offsetY: 1 } }),
    });
    const ctx = new FakeContext();
    getClipRenderer('text')!(ctx.asCanvas(), clip, 0, makeEnv(project));
    expect(ctx.calls.map((c) => c.op)).toEqual(['fill', 'fillText']);
    expect(ctx.calls[0]!.state.fillStyle).toBe('#fff');
    expect(ctx.calls[0]!.state.shadowColor).toBe('black');
    expect(ctx.calls[1]!.state.shadowColor).toBe('rgba(0,0,0,0)');
  });

  it('empty text draws nothing', () => {
    const project = createProject();
    const ctx = new FakeContext();
    getClipRenderer('text')!(ctx.asCanvas(), createTextClip({ trackId: 'x', start: 0, text: '' }), 0, makeEnv(project));
    expect(ctx.calls).toHaveLength(0);
  });
});

describe('presets / add text', () => {
  beforeEach(() => useEditorStore.getState().loadProject(createProject()));

  it('adds a preset at the playhead on a new text track, then reuses it', () => {
    const s = () => useEditorStore.getState();
    s().setCurrentTime(2);
    const id = addTextAtPlayhead(TEXT_PRESETS[0]);
    expect(id).toBeTruthy();
    const clip = s().project.clips[id!]!;
    expect(clip.start).toBe(2);
    expect(s().project.tracks.find((t) => t.id === clip.trackId)!.kind).toBe('text');
    s().setCurrentTime(10);
    const id2 = addTextAtPlayhead();
    expect(s().project.clips[id2!]!.trackId).toBe(clip.trackId);
    expect(s().selectedClipIds).toEqual([id2]);
  });

  it('prefers a selected overlay track', () => {
    const s = () => useEditorStore.getState();
    const ov = s().addTrack('overlay');
    s().selectTrack(ov);
    const id = addTextAtPlayhead();
    expect(s().project.clips[id!]!.trackId).toBe(ov);
  });
});

describe('color helpers', () => {
  it('parses hex / rgba and serializes', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('rgba(0,0,0,0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseColor('#11223380')!.a).toBeCloseTo(0.502, 2);
    expect(toCss({ r: 1, g: 2, b: 3, a: 1 })).toBe('#010203');
    expect(toCss({ r: 1, g: 2, b: 3, a: 0.25 })).toBe('rgba(1,2,3,0.25)');
    expect(parseColor('nonsense')).toBeNull();
  });
});
