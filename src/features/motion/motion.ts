/** Motion ("zoom & pan") presets and store actions. Every exported action is ONE undo step. */
import { getSortedTracks, getTrackClipsAt, useEditorStore, type Clip, type ClipMotion, type Id, type MotionPreset } from '../../core';

export const MOTION_PRESETS: readonly { preset: MotionPreset; label: string; icon: string; hint: string }[] = [
  { preset: 'none', label: 'None', icon: '○', hint: 'No motion' },
  { preset: 'zoom-in', label: 'Zoom in', icon: '⊕', hint: 'Slowly pushes in toward the focus point' },
  { preset: 'zoom-out', label: 'Zoom out', icon: '⊖', hint: 'Starts close and pulls back' },
  { preset: 'punch-in', label: 'Punch-in', icon: '◎', hint: 'Instantly closer for the whole clip (jump-cut zoom)' },
  { preset: 'pan-left', label: 'Pan ←', icon: '⇠', hint: 'Zoomed in, drifting left (Ken Burns)' },
  { preset: 'pan-right', label: 'Pan →', icon: '⇢', hint: 'Zoomed in, drifting right (Ken Burns)' },
];

const DEFAULT_AMOUNT: Record<MotionPreset, number> = { none: 1, 'zoom-in': 1.15, 'zoom-out': 1.15, 'punch-in': 1.2, 'pan-left': 1.2, 'pan-right': 1.2 };

/** Faces usually sit a bit above the middle of talking-head shots. */
export const DEFAULT_FOCUS = { focusX: 0.5, focusY: 0.42 };

export function motionFor(preset: MotionPreset, prev?: ClipMotion): ClipMotion {
  const keepAmount = prev && prev.preset !== 'none' && prev.amount > 1;
  return {
    preset,
    amount: keepAmount ? prev.amount : DEFAULT_AMOUNT[preset],
    duration: prev?.duration ?? 0,
    focusX: prev?.focusX ?? DEFAULT_FOCUS.focusX,
    focusY: prev?.focusY ?? DEFAULT_FOCUS.focusY,
  };
}

export function supportsMotion(c: Clip | undefined): c is Extract<Clip, { type: 'video' | 'image' }> {
  return !!c && (c.type === 'video' || c.type === 'image');
}

const S = () => useEditorStore.getState();

/** Sets the preset on every clip (keeping each clip's focus/duration, sharing amount if set). */
export function setMotionPreset(ids: readonly Id[], preset: MotionPreset): number {
  return S().updateClips(ids, (c) => (supportsMotion(c) ? { motion: motionFor(preset, c.motion) } : null), preset === 'none' ? 'Remove motion' : 'Motion');
}

/** Patches motion fields on every clip that has a motion. */
export function patchMotion(ids: readonly Id[], patch: Partial<ClipMotion>): number {
  return S().updateClips(ids, (c) => (supportsMotion(c) && c.motion && c.motion.preset !== 'none' ? { motion: { ...c.motion, ...patch } } : null), 'Motion');
}

/**
 * Jump-cut style: in time order, every second clip gets a punch-in (the others
 * none), so consecutive pieces alternate between wide and close.
 */
export function alternatePunchIn(ids: readonly Id[], amount = 1.2): number {
  const clips = ids.map((id) => S().project.clips[id]).filter(supportsMotion).sort((a, b) => a.start - b.start);
  let i = 0;
  const order = new Map(clips.map((c) => [c.id, i++]));
  return S().updateClips(
    clips.map((c) => c.id),
    (c) => {
      if (!supportsMotion(c)) return null;
      const odd = (order.get(c.id) ?? 0) % 2 === 1;
      return { motion: odd ? { ...motionFor('punch-in', c.motion), amount } : motionFor('none', c.motion) };
    },
    'Jump-cut zooms',
  );
}

/** The visual clip at the playhead: the selected one if it covers the playhead, else the topmost. */
export function pictureClipAt(t: number): Extract<Clip, { type: 'video' | 'image' }> | null {
  const p = S().project;
  const covers = (c: Clip) => c.start < t - 1e-6 && c.start + c.duration > t + 1e-6;
  for (const id of S().selectedClipIds) {
    const c = p.clips[id];
    if (supportsMotion(c) && covers(c)) return c;
  }
  // Topmost track first. The indexed lookup keeps this O(tracks x log clips): it runs
  // in a toolbar `isEnabled` selector on every store update (every playback tick).
  const tracks = getSortedTracks(p).reverse();
  for (const tr of tracks) {
    if (tr.hidden || tr.locked) continue;
    const hit = getTrackClipsAt(p, tr.id, t).find((c) => supportsMotion(c) && covers(c));
    if (hit && supportsMotion(hit)) return hit;
  }
  return null;
}

/** Splits the picture clip at the playhead and punches in on the part after it. Returns the new clip id. */
export function punchInAtPlayhead(amount = 1.2): Id | null {
  const t = S().currentTime;
  const clip = pictureClipAt(t);
  if (!clip) return null;
  let created: Id | null = null;
  S().transact('Punch-in', () => {
    created = S().splitClip(clip.id, t);
    if (!created) return;
    const right = S().project.clips[created];
    if (!supportsMotion(right)) return;
    S().updateClip(created, { motion: right.motion?.preset === 'punch-in' ? motionFor('none', right.motion) : { ...motionFor('punch-in', right.motion), amount } });
    S().selectClips([created]);
  });
  return created;
}
