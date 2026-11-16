import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../model';
import { useEditorStore } from '../store';
import { makeAsset } from './fixtures';

const S = () => useEditorStore.getState();

beforeEach(() => {
  S().loadProject(createProject());
  S().addAsset(makeAsset('asset1', 10));
});

describe('store clip actions + undo/redo', () => {
  it('add / move / trim / split / delete are each undoable and redoable', () => {
    const id = S().addAssetClip('asset1')!;
    expect(id).toBeTruthy();
    expect(S().past).toHaveLength(1);

    expect(S().moveClip(id, 2)).toBe(true);
    expect(S().trimClip(id, 'end', 8)).toBe(true);
    const right = S().splitClip(id, 5)!;
    expect(right).toBeTruthy();
    S().removeClips([right]);
    expect(Object.keys(S().project.clips)).toEqual([id]);

    S().undo(); // delete
    expect(S().project.clips[right]).toBeDefined();
    S().undo(); // split
    expect(S().project.clips[right]).toBeUndefined();
    expect(S().project.clips[id]!.duration).toBeCloseTo(6);
    S().undo(); // trim
    expect(S().project.clips[id]!.duration).toBeCloseTo(10);
    S().undo(); // move
    expect(S().project.clips[id]!.start).toBe(0);
    S().undo(); // add
    expect(S().project.clips[id]).toBeUndefined();
    expect(S().canUndo()).toBe(false);

    S().redo();
    S().redo();
    expect(S().project.clips[id]!.start).toBe(2);
    expect(S().canRedo()).toBe(true);
    S().moveClip(id, 3); // new action clears redo stack
    expect(S().canRedo()).toBe(false);
  });

  it('groups a transaction into one undo step', () => {
    const id = S().addAssetClip('asset1')!;
    const before = S().past.length;
    S().beginTransaction('Trim drag');
    for (const t of [9, 8, 7, 6]) S().trimClip(id, 'end', t);
    expect(S().past.length).toBe(before); // nothing pushed yet
    S().commitTransaction();
    expect(S().past.length).toBe(before + 1);
    expect(S().project.clips[id]!.duration).toBeCloseTo(6);
    S().undo();
    expect(S().project.clips[id]!.duration).toBeCloseTo(10);
  });

  it('nested transactions and transact() produce one step; cancel reverts', () => {
    const id = S().addAssetClip('asset1')!;
    const n = S().past.length;
    S().transact('outer', () => {
      S().moveClip(id, 1);
      S().transact('inner', () => S().moveClip(id, 2));
      S().moveClip(id, 3);
    });
    expect(S().past.length).toBe(n + 1);
    S().beginTransaction('x');
    S().moveClip(id, 7);
    S().cancelTransaction();
    expect(S().project.clips[id]!.start).toBe(3);
    expect(S().past.length).toBe(n + 1);
  });

  it('empty transaction pushes nothing', () => {
    const n = S().past.length;
    S().transact('noop', () => undefined);
    expect(S().past.length).toBe(n);
  });

  it('assets survive undo; removeAsset is undoable', () => {
    S().addAssetClip('asset1');
    S().undo();
    expect(S().project.assets.asset1).toBeDefined();
    S().redo();
    S().removeAsset('asset1');
    expect(S().project.assets.asset1).toBeUndefined();
    expect(Object.keys(S().project.clips)).toHaveLength(0);
    S().undo();
    expect(S().project.assets.asset1).toBeDefined();
    expect(Object.keys(S().project.clips)).toHaveLength(1);
  });

  it('rippleDeleteRanges is a single undo step', () => {
    const id = S().addAssetClip('asset1')!;
    const n = S().past.length;
    expect(S().rippleDeleteRanges([{ start: 1, end: 2 }, { start: 4, end: 5 }])).toBe(true);
    expect(S().past.length).toBe(n + 1);
    expect(Object.keys(S().project.clips)).toHaveLength(3);
    S().undo();
    expect(Object.keys(S().project.clips)).toEqual([id]);
  });

  it('splitAtPlayhead splits clips under the playhead and prunes selection on undo', () => {
    const id = S().addAssetClip('asset1')!;
    S().setCurrentTime(4);
    const created = S().splitAtPlayhead();
    expect(created).toHaveLength(1);
    S().selectClips([created[0]!]);
    S().undo();
    expect(S().selectedClipIds).toEqual([]);
    expect(S().project.clips[id]!.duration).toBeCloseTo(10);
  });

  it('aspect presets change canvas size; custom size detects presets', () => {
    S().setAspectPreset('16:9');
    expect([S().project.width, S().project.height]).toEqual([1920, 1080]);
    S().setCanvasSize(1001, 500);
    expect([S().project.width, S().project.height, S().project.aspectPreset]).toEqual([1000, 500, 'custom']);
    S().setCanvasSize(1080, 1080);
    expect(S().project.aspectPreset).toBe('1:1');
    S().undo();
    expect(S().project.width).toBe(1000);
  });

  it('selection modes and playback flags', () => {
    const a = S().addAssetClip('asset1')!;
    const b = S().addAssetClip('asset1')!;
    S().selectClips([a]);
    S().selectClips([b], 'toggle');
    expect(S().selectedClipIds.sort()).toEqual([a, b].sort());
    S().selectClips([a], 'toggle');
    expect(S().selectedClipIds).toEqual([b]);
    const nonce = S().seekNonce;
    S().setCurrentTime(3);
    expect(S().seekNonce).toBe(nonce + 1);
    S().setPlaybackTime(4);
    expect(S().seekNonce).toBe(nonce + 1);
    S().togglePlay();
    expect(S().isPlaying).toBe(true);
    S().togglePlay();
    expect(S().isPlaying).toBe(false);
  });
});

describe('updateSubtitleStyle', () => {
  it('patches a style as one undoable step and keeps the id', () => {
    const n = S().past.length;
    expect(S().updateSubtitleStyle('default', { fontSize: 72, color: '#ff0', id: 'hacked' } as never)).toBe(true);
    const st = S().project.subtitleStyles.default!;
    expect([st.fontSize, st.color, st.id]).toEqual([72, '#ff0', 'default']);
    expect(S().past.length).toBe(n + 1);
    S().undo();
    expect(S().project.subtitleStyles.default!.fontSize).toBe(56);
    S().redo();
    expect(S().project.subtitleStyles.default!.fontSize).toBe(72);
  });

  it('is a no-op for unknown ids and unchanged values', () => {
    const n = S().past.length;
    expect(S().updateSubtitleStyle('nope', { fontSize: 10 })).toBe(false);
    const cur = S().project.subtitleStyles.default!;
    expect(S().updateSubtitleStyle('default', { fontSize: cur.fontSize, stroke: { ...cur.stroke! } })).toBe(false);
    expect(S().past.length).toBe(n);
  });

  it('groups inside a transaction', () => {
    const n = S().past.length;
    S().transact('style drag', () => {
      for (const size of [60, 64, 68]) S().updateSubtitleStyle('default', { fontSize: size });
    });
    expect(S().past.length).toBe(n + 1);
    expect(S().project.subtitleStyles.default!.fontSize).toBe(68);
  });
});
