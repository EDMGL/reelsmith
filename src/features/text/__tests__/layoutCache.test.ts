/** Text layout cache: hits/misses, key sensitivity, bounded size, per-context measure reuse. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultTextStyle, type TextStyle } from '../../../core';
import {
  LruCache,
  TEXT_LAYOUT_CACHE_SIZE,
  clearTextLayoutCache,
  contextMeasure,
  layoutText,
  layoutTextCached,
  textLayoutCacheStats,
  type MeasureFn,
} from '../textLayout';
import { FakeContext, fakeMeasureWidth } from './fakeCanvas';

const style = (patch: Partial<TextStyle> = {}): TextStyle => ({ ...defaultTextStyle(), fontSize: 20, ...patch });

let measure: MeasureFn & { calls: number };
beforeEach(() => {
  clearTextLayoutCache();
  const fn = ((t: string, f: string) => {
    fn.calls++;
    return fakeMeasureWidth(t, f);
  }) as MeasureFn & { calls: number };
  fn.calls = 0;
  measure = fn;
});

describe('layoutTextCached', () => {
  it('returns the same layout object on a hit without measuring again, equal to layoutText', () => {
    const a = layoutTextCached('hello brave new world', style(), 120, measure);
    const calls = measure.calls;
    expect(calls).toBeGreaterThan(0);
    const b = layoutTextCached('hello brave new world', style(), 120, measure);
    expect(b).toBe(a);
    expect(measure.calls).toBe(calls);
    expect(a).toEqual(layoutText('hello brave new world', style(), 120, fakeMeasureWidth));
    expect(textLayoutCacheStats(measure)).toMatchObject({ size: 1, hits: 1, misses: 1 });
  });

  it('misses when anything the layout depends on changes (text, wrap width, font, line height, padding)', () => {
    const base = layoutTextCached('a b c', style(), 100, measure);
    const variants = [
      layoutTextCached('a b c d', style(), 100, measure),
      layoutTextCached('a b c', style(), 50, measure),
      layoutTextCached('a b c', style({ fontSize: 30 }), 100, measure),
      layoutTextCached('a b c', style({ fontWeight: 400 }), 100, measure),
      layoutTextCached('a b c', style({ italic: true }), 100, measure),
      layoutTextCached('a b c', style({ fontFamily: 'Serif' }), 100, measure),
      layoutTextCached('a b c', style({ lineHeight: 2 }), 100, measure),
      layoutTextCached('a b c', style({ background: { color: '#000', padding: 9, radius: 2 } }), 100, measure),
    ];
    for (const v of variants) expect(v).not.toBe(base);
    expect(textLayoutCacheStats(measure)).toMatchObject({ size: 9, hits: 0, misses: 9 });
    // Colors / stroke / shadow / align do not affect layout: hit.
    expect(layoutTextCached('a b c', style({ color: '#f00', align: 'left', stroke: { color: '#000', width: 3 }, shadow: null }), 100, measure)).toBe(base);
  });

  it('is bounded (LRU) and keeps recently used entries', () => {
    const first = layoutTextCached('keep me', style(), 100, measure);
    for (let i = 0; i < TEXT_LAYOUT_CACHE_SIZE * 2; i++) {
      layoutTextCached(`cue ${i}`, style(), 100, measure);
      if (i % 50 === 0) layoutTextCached('keep me', style(), 100, measure); // touch
    }
    expect(textLayoutCacheStats(measure).size).toBe(TEXT_LAYOUT_CACHE_SIZE);
    expect(layoutTextCached('keep me', style(), 100, measure)).toBe(first);
    const before = measure.calls;
    layoutTextCached('cue 0', style(), 100, measure); // evicted long ago
    expect(measure.calls).toBeGreaterThan(before);
  });

  it('LruCache evicts the least recently used key', () => {
    const c = new LruCache<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    expect(c.get('a')).toBe(1);
    c.set('c', 3);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.size).toBe(2);
  });

  it('different measure functions never share entries; contextMeasure is stable per context', () => {
    const other = vi.fn((t: string, f: string) => fakeMeasureWidth(t, f) * 2);
    const a = layoutTextCached('same text', style(), 1000, measure);
    const b = layoutTextCached('same text', style(), 1000, other);
    expect(b).not.toBe(a);
    expect(b.textWidth).toBe(a.textWidth * 2);
    const ctx = new FakeContext();
    expect(contextMeasure(ctx as never)).toBe(contextMeasure(ctx as never));
    expect(contextMeasure(new FakeContext() as never)).not.toBe(contextMeasure(ctx as never));
  });

  it('clearTextLayoutCache drops everything (fonts finished loading)', () => {
    const a = layoutTextCached('x y', style(), 100, measure);
    clearTextLayoutCache();
    expect(layoutTextCached('x y', style(), 100, measure)).not.toBe(a);
  });
});
